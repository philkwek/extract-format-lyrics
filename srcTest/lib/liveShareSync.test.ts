import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildLivePayload,
  createLiveShareSync,
  getLiveShare,
  hashLiveSongContent,
  LIVE_SHARE_MAX_SONGS,
  startLiveShare,
  stopLiveShare,
  subscribeLiveShareStatus,
  type LiveIdentityRecord,
  type LiveShareSyncDeps,
} from '../../src/lib/liveShareSync'
import { trackEvent } from '../../src/lib/analytics'
import {
  deleteLiveSetApi,
  LiveSetMissingContentError,
  putLiveSetManifestApi,
  putLiveSetSongApi,
  resumeLiveSetApi,
  ShareApiError,
} from '../../src/lib/api'
import {
  resetSetLinkIdentityStore,
  setSetLinkIdentityStoreForTesting,
} from '../../src/lib/setLinkIdentity'
import { sessionStore, type Session } from '../../src/lib/sessionStore'
import type { Song } from '../../src/types/song'

vi.mock('../../src/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('../../src/lib/api', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/api')>()),
  deleteLiveSetApi: vi.fn(async () => {}),
  resumeLiveSetApi: vi.fn(async () => {}),
  putLiveSetSongApi: vi.fn(async () => ({})),
  putLiveSetManifestApi: vi.fn(async () => ({ expiresAt: '' })),
}))
vi.mock('../../src/lib/songCache', () => ({
  songCache: {
    getSong: vi.fn(async (url: string) => ({
      id: url,
      title: 'Demo',
      artist: 'Nobody',
      sourceUrl: url,
      sourceSite: 'test',
      originalKey: 'C',
      sections: [],
    })),
  },
}))

type Listener = Parameters<LiveShareSyncDeps['store']['subscribe']>[0]

const song = (n: string): Song => ({
  id: n,
  title: `Song ${n}`,
  artist: 'Nobody',
  sourceUrl: `https://x.test/${n}`,
  sourceSite: 'test',
  originalKey: 'C',
  sections: [
    {
      type: 'Verse',
      label: 'Verse 1',
      lines: [{ kind: 'lyric', text: 'la la la', chords: [{ pos: 3, chord: 'G' }] }],
    },
  ],
  flow: [0],
})

const item = (n: string, over: Record<string, unknown> = {}) => ({
  entryId: `e-${n}`,
  url: `https://x.test/${n}`,
  ...over,
})

const makeSession = (songs = [item('a'), item('b')]): Session => ({
  id: 's1',
  createdAt: 0,
  name: 'Set',
  songs,
})

function setup(opts: { identity?: boolean; id?: string } = {}) {
  const id = opts.id ?? 's1'
  const identities = new Map<string, LiveIdentityRecord>()
  if (opts.identity !== false) {
    identities.set(id, { sessionId: id, publicId: 'p'.repeat(22), secret: 'k' })
  }
  const listeners = new Set<Listener>()
  const expiresAt = () => new Date(Date.now() + 7 * 86400_000).toISOString()
  const putSong = vi.fn(async () => ({}))
  const putManifest = vi.fn(async () => ({ expiresAt: expiresAt() }))
  const onStatus = vi.fn()
  const deps: LiveShareSyncDeps = {
    store: { subscribe: (l) => (listeners.add(l), () => listeners.delete(l)) },
    identity: {
      get: async (id) => identities.get(id) ?? null,
      update: async (id, patch) => {
        const r = identities.get(id)
        if (r) identities.set(id, { ...r, ...patch })
      },
      remove: async (id) => void identities.delete(id),
    },
    api: { putSong, putManifest },
    getSong: async (url) => song(url.split('/').pop()!),
    now: () => Date.now(),
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    },
    random: () => 0,
    withLock: async (_n, fn) => fn(),
    onStatus,
  }
  const sync = createLiveShareSync(deps)
  sync.start()
  const emit = (type: 'created' | 'updated', session: Session) =>
    listeners.forEach((l) => l({ type, sessionId: session.id, session }))
  // Real SHA-256 resolves outside fake timers, so also wait for the engine to go idle.
  const settle = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms)
    await sync.idle()
  }
  return { settle, sync, putSong, putManifest, identities, emit, onStatus }
}

describe('buildLivePayload', () => {
  const getSong = async (url: string) => song(url.split('/').pop()!)

  it('reports empty and too many songs', async () => {
    expect(await buildLivePayload(makeSession([]), getSong)).toEqual({
      payload: null,
      reason: 'empty',
    })
    const many = Array.from({ length: LIVE_SHARE_MAX_SONGS + 1 }, (_, i) => item(`s${i}`))
    expect(await buildLivePayload(makeSession(many), getSong)).toEqual({
      payload: null,
      reason: 'too_many',
    })
  })
})

describe('liveShareSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('uploads each content hash once, and a key change sends only the manifest', async () => {
    const env = setup()
    env.emit('created', makeSession())
    await env.settle(0)
    expect(env.putSong).toHaveBeenCalledTimes(2)
    expect(env.putManifest).toHaveBeenCalledTimes(1)
    expect(env.identities.get('s1')?.knownContentHashes).toHaveLength(2)

    await env.settle(10_000)
    env.emit('updated', makeSession([item('a', { targetKey: 'D' }), item('b')]))
    await env.settle(2_000)
    expect(env.putSong).toHaveBeenCalledTimes(2)
    expect(env.putManifest).toHaveBeenCalledTimes(2)
  })

  it('a section change uploads one new content doc and the manifest', async () => {
    const env = setup()
    env.emit('created', makeSession())
    await env.settle(0)
    await env.settle(10_000)
    env.putSong.mockClear()
    env.emit('updated', makeSession([item('a', { customFlow: [0, 0] }), item('b')]))
    await env.settle(2_000)
    expect(env.putSong).toHaveBeenCalledTimes(1)
    expect(env.putManifest).toHaveBeenCalledTimes(2)
    expect(env.identities.get('s1')?.knownContentHashes).toHaveLength(2)
  })

  it('re-uploads on a 409 and retries the manifest once', async () => {
    const env = setup()
    env.emit('created', makeSession([item('a')]))
    await env.settle(0)
    const hash = env.identities.get('s1')!.knownContentHashes![0]
    env.putSong.mockClear()
    env.putManifest.mockClear()
    env.putManifest.mockRejectedValueOnce(new LiveSetMissingContentError([hash]))
    await env.settle(10_000)
    env.emit('updated', makeSession([item('a', { targetKey: 'D' })]))
    await env.settle(2_000)
    expect(env.putSong).toHaveBeenCalledTimes(1)
    expect(env.putManifest).toHaveBeenCalledTimes(2)
  })

  it('does not publish without a live identity', async () => {
    const env = setup({ identity: false })
    env.emit('created', makeSession())
    await env.settle(0)
    await env.settle(10_000)
    expect(env.putSong).not.toHaveBeenCalled()
    expect(env.putManifest).not.toHaveBeenCalled()
  })

  it('does not publish while the share is paused', async () => {
    const env = setup()
    env.identities.set('s1', { ...env.identities.get('s1')!, paused: true })
    env.emit('created', makeSession())
    await env.settle(0)
    await env.settle(10_000)
    expect(env.putSong).not.toHaveBeenCalled()
    expect(env.putManifest).not.toHaveBeenCalled()
  })

  it('does not publish a set opened from a live link', async () => {
    const env = setup()
    env.emit('created', { ...makeSession(), liveSourceId: 'live-abc' })
    await env.settle(0)
    await env.settle(10_000)
    expect(env.putSong).not.toHaveBeenCalled()
    expect(env.putManifest).not.toHaveBeenCalled()
  })

  it('stops at 30 songs', async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => item(`s${i}`))
    const env = setup()
    env.emit('created', makeSession(many(LIVE_SHARE_MAX_SONGS + 1)))
    await env.settle(0)
    expect(env.putManifest).not.toHaveBeenCalled()
    await env.settle(10_000)
    env.emit('updated', makeSession(many(LIVE_SHARE_MAX_SONGS)))
    await env.settle(2_000)
    expect(env.putManifest).toHaveBeenCalledTimes(1)
  })

  it('reports failing when the server refuses, and ok after a publish', async () => {
    const env = setup()
    env.putManifest.mockRejectedValueOnce(new ShareApiError('no', 'FORBIDDEN', 403))
    env.emit('created', makeSession([item('a')]))
    await env.settle(0)
    expect(env.onStatus).toHaveBeenLastCalledWith('s1', 'failing')
    await env.settle(10_000)
    env.emit('updated', makeSession([item('a', { targetKey: 'D' })]))
    await env.settle(2_000)
    expect(env.onStatus).toHaveBeenLastCalledWith('s1', 'ok')
  })

  it('reports failing when a live set cannot build a payload', async () => {
    const env = setup({ id: 'no-payload' })
    env.emit('created', { ...makeSession([]), id: 'no-payload' })
    await env.settle(0)
    expect(env.onStatus).toHaveBeenLastCalledWith('no-payload', 'failing')
  })

  it('removes the identity when the session is deleted', async () => {
    const env = setup()
    env.sync.handleEvent({ type: 'deleted', sessionId: 's1' })
    await env.settle(0)
    expect(env.identities.has('s1')).toBe(false)
  })

  describe('subscribeLiveShareStatus', () => {
    it('replays ok when the set has no status yet', () => {
      const cb = vi.fn()
      const unsubscribe = subscribeLiveShareStatus('never-seen', cb)
      expect(cb).toHaveBeenCalledWith('ok')
      unsubscribe()
    })
  })
})

describe('stopLiveShare', () => {
  const memory = new Map<string, unknown>()
  beforeEach(() => {
    memory.clear()
    memory.set('live:s1', { sessionId: 's1', publicId: 'p'.repeat(22), secret: 'k' })
    setSetLinkIdentityStoreForTesting({
      get: async <T,>(k: string) => memory.get(k) as T | undefined,
      set: async (k, v) => void memory.set(k, v),
      del: async (k) => void memory.delete(k),
    })
    vi.mocked(deleteLiveSetApi).mockReset()
    vi.mocked(trackEvent).mockClear()
  })
  afterEach(() => {
    resetSetLinkIdentityStore()
    vi.unstubAllGlobals()
  })

  it('sends DELETE and pauses the identity so the link can be reused', async () => {
    vi.mocked(deleteLiveSetApi).mockResolvedValue()
    await stopLiveShare('s1')
    expect(deleteLiveSetApi).toHaveBeenCalledWith('p'.repeat(22), 'k')
    const stopped = memory.get('live:s1') as LiveIdentityRecord
    expect(stopped).toMatchObject({ publicId: 'p'.repeat(22), secret: 'k', paused: true })
    expect(trackEvent).toHaveBeenCalledWith('live_share_stopped', {})
  })

  it('keeps the identity untouched when the network fails', async () => {
    vi.mocked(deleteLiveSetApi).mockRejectedValue(new TypeError('offline'))
    await expect(stopLiveShare('s1')).rejects.toThrow('offline')
    expect(memory.get('live:s1')).toMatchObject({ publicId: 'p'.repeat(22), secret: 'k' })
    expect((memory.get('live:s1') as LiveIdentityRecord).paused).toBeUndefined()
    expect(trackEvent).not.toHaveBeenCalledWith('live_share_stopped', {})
  })

  it('reports a paused share as not live', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://example.test' } })
    memory.set('live:s1', {
      sessionId: 's1',
      publicId: 'p'.repeat(22),
      secret: 'k',
      expiresAt: '2026-12-01T00:00:00Z',
      paused: true,
    })
    expect(await getLiveShare('s1')).toBeNull()
  })

  it('returns the url and expiry for a live set', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://example.test' } })
    memory.set('live:s1', {
      sessionId: 's1',
      publicId: 'p'.repeat(22),
      secret: 'k',
      expiresAt: '2026-12-01T00:00:00Z',
    })
    expect(await getLiveShare('s1')).toEqual({
      url: `https://example.test/live/${'p'.repeat(22)}`,
      expiresAt: '2026-12-01T00:00:00Z',
    })
  })
})

describe('startLiveShare', () => {
  const memory = new Map<string, unknown>()
  const expiresAt = '2026-12-01T00:00:00Z'
  const sessionFor = (id: string): Session => ({ ...makeSession(), id })
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    memory.clear()
    setSetLinkIdentityStoreForTesting({
      get: async <T,>(k: string) => memory.get(k) as T | undefined,
      set: async (k, v) => void memory.set(k, v),
      del: async (k) => void memory.delete(k),
    })
    vi.mocked(trackEvent).mockClear()
    vi.mocked(deleteLiveSetApi).mockReset()
    vi.mocked(deleteLiveSetApi).mockResolvedValue()
    vi.mocked(resumeLiveSetApi).mockReset()
    vi.mocked(resumeLiveSetApi).mockResolvedValue()
    vi.mocked(putLiveSetSongApi).mockReset()
    vi.mocked(putLiveSetSongApi).mockResolvedValue({ id: 'x', hash: 'h', created: true, expiresAt })
    vi.mocked(putLiveSetManifestApi).mockReset()
    vi.mocked(putLiveSetManifestApi).mockResolvedValue({
      id: 'x',
      rev: 1,
      expiresAt,
      unchanged: false,
    })
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    resetSetLinkIdentityStore()
  })

  it('throws a clear error when a live set has more than 30 songs', async () => {
    const songs = Array.from({ length: LIVE_SHARE_MAX_SONGS + 1 }, (_, i) => item(`m${i}`))
    vi.spyOn(sessionStore, 'getSession').mockResolvedValue({
      id: 'too-many',
      createdAt: 0,
      name: 'Big set',
      songs,
    })
    await expect(startLiveShare('too-many')).rejects.toThrow(
      'A live share holds up to 30 songs.',
    )
    expect(memory.has('live:too-many')).toBe(false)
  })

  it('reuses the same link after a stop, without a new secret', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://example.test' } })
    vi.spyOn(sessionStore, 'getSession').mockResolvedValue(sessionFor('restart'))

    const first = await startLiveShare('restart')
    const created = memory.get('live:restart') as LiveIdentityRecord
    expect(resumeLiveSetApi).not.toHaveBeenCalled()

    await stopLiveShare('restart')
    expect((memory.get('live:restart') as LiveIdentityRecord).paused).toBe(true)

    vi.mocked(putLiveSetManifestApi).mockClear()
    const second = await startLiveShare('restart')
    const resumed = memory.get('live:restart') as LiveIdentityRecord
    expect(second.url).toBe(first.url)
    expect(resumed.publicId).toBe(created.publicId)
    expect(resumed.secret).toBe(created.secret)
    expect(resumed.paused).toBe(false)
    expect(resumeLiveSetApi).toHaveBeenCalledWith(created.publicId, created.secret)
    for (const [id, secret] of vi.mocked(putLiveSetManifestApi).mock.calls) {
      expect(id).toBe(created.publicId)
      expect(secret).toBe(created.secret)
    }
  })

  it('treats an expired share as not live and starts it again on the same id', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://example.test' } })
    vi.spyOn(sessionStore, 'getSession').mockResolvedValue(sessionFor('expired'))
    memory.set('live:expired', {
      sessionId: 'expired',
      publicId: 'q'.repeat(22),
      secret: 'old-secret',
      expiresAt: '2025-12-01T00:00:00Z',
    })

    expect(await getLiveShare('expired')).toBeNull()

    const result = await startLiveShare('expired')
    const record = memory.get('live:expired') as LiveIdentityRecord
    expect(result.url).toBe(`https://example.test/live/${'q'.repeat(22)}`)
    expect(record.publicId).toBe('q'.repeat(22))
    expect(record.secret).toBe('old-secret')
    expect(resumeLiveSetApi).not.toHaveBeenCalled()
    expect(putLiveSetManifestApi).toHaveBeenCalled()
  })

  it('removes a brand-new identity when the first start fails', async () => {
    vi.spyOn(sessionStore, 'getSession').mockResolvedValue(sessionFor('new-fail'))
    vi.mocked(putLiveSetManifestApi).mockRejectedValue(new ShareApiError('no', 'FORBIDDEN', 403))

    await expect(startLiveShare('new-fail')).rejects.toThrow('Could not start the live share')
    expect(memory.has('live:new-fail')).toBe(false)
  })

  it('keeps an existing identity when a start fails', async () => {
    vi.spyOn(sessionStore, 'getSession').mockResolvedValue(sessionFor('keep-fail'))
    memory.set('live:keep-fail', {
      sessionId: 'keep-fail',
      publicId: 'k'.repeat(22),
      secret: 'keep-secret',
    })
    vi.mocked(putLiveSetManifestApi).mockRejectedValue(
      new ShareApiError('no', 'FORBIDDEN', 403),
    )

    await expect(startLiveShare('keep-fail')).rejects.toThrow('Could not start the live share')
    expect(memory.get('live:keep-fail')).toMatchObject({
      publicId: 'k'.repeat(22),
      secret: 'keep-secret',
    })
  })
})

describe('content hash', () => {
  it('equals the server hash for the same content', async () => {
    // The same fixture and value are pinned against the server's hashLiveSongContent
    // in functions/srcTest/liveSetStore.test.ts.
    const demo: Song = {
      id: 'demo',
      title: 'Demo',
      artist: 'Nobody',
      sourceUrl: 'https://example.test/demo',
      sourceSite: 'test',
      originalKey: 'C',
      sections: [
        {
          type: 'Verse',
          label: 'Verse 1',
          lines: [{ kind: 'lyric', text: 'la la la', chords: [{ pos: 3, chord: 'G' }] }],
        },
      ],
      flow: [0],
    }
    expect(await hashLiveSongContent({ song: demo, customFlow: [0, 0] })).toBe(
      'ead3f44b931987e257aa7b2dda593bc2f1c8c7893eee3ab8571958d682598b80'
    )
  })
})
