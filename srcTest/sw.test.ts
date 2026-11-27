// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { NavigationRoute } from 'workbox-routing'

const registered = vi.hoisted(
  () => [] as Array<{ capture: unknown; handler: unknown }>,
)

vi.mock('workbox-precaching', () => ({
  precacheAndRoute: vi.fn(),
  cleanupOutdatedCaches: vi.fn(),
  createHandlerBoundToURL: vi.fn(() => vi.fn()),
}))

vi.mock('workbox-routing', async () => {
  const actual = await vi.importActual<typeof import('workbox-routing')>('workbox-routing')
  return {
    ...actual,
    registerRoute: vi.fn((capture: unknown, handler?: unknown) => {
      registered.push({ capture, handler })
    }),
  }
})

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).__WB_MANIFEST = []
  await import('../src/sw')
})

function navigationMatch(urlString: string) {
  const entry = registered.find((item) => item.handler === undefined)
  if (!entry) throw new Error('NavigationRoute was not registered')
  const route = entry.capture as NavigationRoute
  return route.match({
    url: new URL(urlString),
    sameOrigin: true,
    request: { mode: 'navigate' } as Request,
    event: {} as Parameters<NavigationRoute['match']>[0]['event'],
  })
}

function networkOnlyMatches(urlString: string) {
  const entry = registered.find((item) => typeof item.capture === 'function')
  if (!entry) throw new Error('NetworkOnly route was not registered')
  const matcher = entry.capture as (context: { url: URL }) => boolean
  return matcher({ url: new URL(urlString) })
}

describe('service worker routing', () => {
  it('serves the app shell for normal navigations', () => {
    expect(navigationMatch('https://setsandsheets.com/sets/123')).toBeTruthy()
  })

  it('does not intercept Firebase Auth or API navigations with the app shell', () => {
    expect(navigationMatch('https://setsandsheets.com/__/auth/handler?apiKey=demo')).toBeFalsy()
    expect(navigationMatch('https://setsandsheets.com/__/auth/iframe')).toBeFalsy()
    expect(navigationMatch('https://setsandsheets.com/api/search')).toBeFalsy()
  })

  it('routes Firebase Auth and API requests as NetworkOnly', () => {
    expect(networkOnlyMatches('https://setsandsheets.com/__/auth/handler?apiKey=demo')).toBe(true)
    expect(networkOnlyMatches('https://setsandsheets.com/__/auth/iframe')).toBe(true)
    expect(networkOnlyMatches('https://setsandsheets.com/api/search')).toBe(true)
    expect(networkOnlyMatches('https://setsandsheets.com/sets/123')).toBe(false)
  })
})
