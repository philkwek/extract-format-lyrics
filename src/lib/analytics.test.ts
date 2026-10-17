// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  initialize: vi.fn(() => ({ name: 'analytics' })),
  logEvent: vi.fn(),
  supported: vi.fn(async () => true),
  defaults: vi.fn(),
  collection: vi.fn(),
  app: vi.fn(() => ({ name: 'usage-analytics' })),
}))
vi.mock('firebase/analytics', () => ({
  initializeAnalytics: mock.initialize,
  logEvent: mock.logEvent,
  isSupported: mock.supported,
  setDefaultEventParameters: mock.defaults,
  setAnalyticsCollectionEnabled: mock.collection,
}))
vi.mock('firebase/app', () => ({ getApps: () => [], initializeApp: mock.app }))

async function flush() {
  await vi.waitFor(() => expect(mock.initialize).toHaveBeenCalledTimes(1))
}
async function module() {
  return import('./analytics')
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  localStorage.clear()
  vi.stubEnv('PROD', true)
  vi.stubEnv('VITE_ANALYTICS_ENABLED', 'true')
  vi.stubEnv('VITE_ANALYTICS_HOSTNAMES', window.location.hostname)
  vi.stubEnv('VITE_FIREBASE_MEASUREMENT_ID', 'G-TEST123')
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'public-key')
  vi.stubEnv('VITE_FIREBASE_APP_ID', 'public-app')
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'test-project')
  mock.supported.mockResolvedValue(true)
  Object.defineProperty(document, 'referrer', {
    configurable: true,
    value: 'https://example.com/private?q=secret',
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('optional Analytics', () => {
  it.each([
    ['/session/private?secret=abc#token', '/session'],
    ['/lyrics/private', '/lyrics'],
    ['/s/private', '/s'],
    ['/search?session=private', '/search'],
    ['/unexpected-secret/path', '/other'],
    ['/', '/'],
    ['/privacy', '/privacy'],
  ])('sanitizes %s', async (path, group) => {
    expect((await module()).pageGroup(path)).toBe(group)
  })

  it('initializes once and deduplicates Strict Mode and song-selection page effects', async () => {
    const analytics = await module()
    analytics.trackPage('/session/private? song=1')
    analytics.trackPage('/session/private?song=2')
    analytics.trackPage('/session/another-private')
    await flush()
    await vi.waitFor(() => expect(mock.logEvent).toHaveBeenCalledTimes(1))
    expect(mock.logEvent.mock.calls[0]).toEqual([
      expect.anything(),
      'page_view',
      {
        page_location: `${window.location.origin}/session`,
        page_title: 'Setlist',
        page_referrer: 'https://example.com',
      },
    ])
    analytics.trackPage('/search?session=private')
    analytics.trackPage('/session/private')
    await vi.waitFor(() => expect(mock.logEvent).toHaveBeenCalledTimes(3))
    expect(mock.initialize).toHaveBeenCalledTimes(1)
    expect(mock.initialize).toHaveBeenCalledWith(expect.anything(), {
      config: expect.objectContaining({
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        page_referrer: 'https://example.com',
      }),
    })
  })

  it('allowlists parameters and gives every event sanitized page context', async () => {
    const analytics = await module()
    analytics.trackEvent('song_search', {
      entry_page: 'home',
      outcome: 'success',
      result_count: 2,
      secret: 'never send',
    } as never)
    await vi.waitFor(() => expect(mock.logEvent).toHaveBeenCalledTimes(1))
    const params = mock.logEvent.mock.calls[0][2]
    expect(params).toEqual(
      expect.objectContaining({
        entry_page: 'home',
        result_count: 2,
        page_referrer: 'https://example.com',
      }),
    )
    expect(params).not.toHaveProperty('secret')
    analytics.trackEvent('song_import', {
      method: 'upload',
      outcome: 'success',
      imported_count: -1,
    })
    expect(mock.logEvent).toHaveBeenCalledTimes(1)
  })

  it('drops queued events on opt-out and persists the preference before the next initialization', async () => {
    let resolve!: (value: boolean) => void
    mock.supported.mockReturnValueOnce(
      new Promise<boolean>((done) => {
        resolve = done
      }),
    )
    const analytics = await module()
    analytics.trackPage('/')
    await vi.waitFor(() => expect(mock.supported).toHaveBeenCalled())
    analytics.setTrackingEnabled(false)
    resolve(true)
    await new Promise((done) => setTimeout(done, 20))
    expect(mock.initialize).not.toHaveBeenCalled()
    expect(mock.logEvent).not.toHaveBeenCalled()
    expect(localStorage.getItem('usage-tracking-disabled')).toBe('true')
    vi.resetModules()
    const reloaded = await module()
    reloaded.trackPage('/')
    expect(reloaded.trackingEnabled()).toBe(false)
    expect(mock.initialize).not.toHaveBeenCalled()
    reloaded.setTrackingEnabled(true)
    await vi.waitFor(() => expect(mock.logEvent).toHaveBeenCalledTimes(1))
  })

  it('stops collection immediately and permits re-enabling an initialized instance', async () => {
    const analytics = await module()
    analytics.trackPage('/')
    await flush()
    await vi.waitFor(() => expect(mock.logEvent).toHaveBeenCalledTimes(1))
    analytics.setTrackingEnabled(false)
    analytics.trackEvent('set_shared', { song_count: 1 })
    expect((window as unknown as Record<string, unknown>)['ga-disable-G-TEST123']).toBe(true)
    await vi.waitFor(() => expect(mock.collection).toHaveBeenCalledWith(expect.anything(), false))
    expect(mock.logEvent).toHaveBeenCalledTimes(1)
    analytics.setTrackingEnabled(true)
    await vi.waitFor(() => expect(mock.logEvent).toHaveBeenCalledTimes(2))
    expect(mock.initialize).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['PROD', false],
    ['VITE_ANALYTICS_ENABLED', 'false'],
    ['VITE_ANALYTICS_HOSTNAMES', 'production.example.com'],
    ['VITE_FIREBASE_APP_ID', ''],
    ['VITE_FIREBASE_MEASUREMENT_ID', ''],
  ])('does not initialize when %s disallows collection', async (key, value) => {
    if (key === 'PROD') vi.stubEnv('PROD', false)
    else vi.stubEnv(key, String(value))
    ;(await module()).trackPage('/')
    await new Promise((done) => setTimeout(done, 10))
    expect(mock.initialize).not.toHaveBeenCalled()
  })

  it('tolerates unsupported browsers, blocked storage, and SDK exceptions', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    mock.supported.mockRejectedValueOnce(new Error('unsupported'))
    const analytics = await module()
    expect(() => analytics.trackPage('/')).not.toThrow()
    await new Promise((done) => setTimeout(done, 10))
    expect(() => analytics.setTrackingEnabled(false)).not.toThrow()
    expect(analytics.trackingEnabled()).toBe(false)
    expect(mock.logEvent).not.toHaveBeenCalled()
  })

  it('reports cached successes, mixed batch imports, and complete failures', async () => {
    const analytics = await module()
    analytics.trackSongImport('pasted_link', 2, 3)
    analytics.trackSongImport('search', 1, 1)
    analytics.trackSongImport('upload', 0, 2)
    await vi.waitFor(() => expect(mock.logEvent).toHaveBeenCalledTimes(3))
    expect(mock.logEvent.mock.calls.map((call) => call[2].outcome)).toEqual([
      'partial',
      'success',
      'error',
    ])
  })
})
