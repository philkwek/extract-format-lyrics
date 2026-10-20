import { afterEach, describe, expect, it, vi } from 'vitest'
import { FetchError } from '../../src/safeFetch.js'
import { RateLimiterAndCircuitBreaker } from '../../src/rateLimit.js'
import { classifySearchError, searchSite, searchSites } from '../../src/search/searchSites.js'
import { SearchParseError, type SearchAdapter, type SearchCandidate } from '../../src/search/types.js'

afterEach(() => vi.restoreAllMocks())

function candidate(site: string, url = `https://${site}.example/song`): SearchCandidate {
  return { site, title: 'Song', artist: 'Artist', url }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('searchSites', () => {
  it('starts every adapter before any request settles', async () => {
    const started: string[] = []
    const pending = new Map<string, ReturnType<typeof deferred<SearchCandidate[]>>>()
    const adapters: SearchAdapter[] = ['ultimate-guitar', 'pnwchords', 'worshiptogether'].map((site) => ({
      site,
      search: vi.fn(() => {
        started.push(site)
        const request = deferred<SearchCandidate[]>()
        pending.set(site, request)
        return request.promise
      }),
    }))

    const running = searchSites(adapters, 'good grace')
    await Promise.resolve()
    expect(started).toEqual(['ultimate-guitar', 'pnwchords', 'worshiptogether'])

    pending.get('ultimate-guitar')!.resolve([candidate('ultimate-guitar')])
    pending.get('pnwchords')!.resolve([candidate('pnwchords')])
    pending.get('worshiptogether')!.resolve([])

    const result = await running
    expect(result.candidates).toHaveLength(2)
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(['ok', 'ok', 'empty'])
  })

  it('reports each outcome as it settles, independent of source order', async () => {
    const requests = {
      'ultimate-guitar': deferred<SearchCandidate[]>(),
      pnwchords: deferred<SearchCandidate[]>(),
    }
    const adapters: SearchAdapter[] = Object.entries(requests).map(([site, request]) => ({
      site,
      search: () => request.promise,
    }))
    const seen: string[] = []

    const running = searchSites(adapters, 'song', {}, (outcome) => seen.push(outcome.site))
    requests.pnwchords.resolve([candidate('pnwchords')])
    await vi.waitFor(() => expect(seen).toEqual(['pnwchords']))

    requests['ultimate-guitar'].resolve([])
    await running
    expect(seen).toEqual(['pnwchords', 'ultimate-guitar'])
  })

  it('keeps successful results when another site fails', async () => {
    const adapters: SearchAdapter[] = [
      { site: 'ultimate-guitar', search: async () => [candidate('ultimate-guitar')] },
      {
        site: 'pnwchords',
        search: async () => {
          throw new FetchError('upstream timed out', 'TIMEOUT')
        },
      },
      { site: 'worshiptogether', search: async () => [] },
    ]

    const result = await searchSites(adapters, 'song', {
      limiter: new RateLimiterAndCircuitBreaker(),
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.outcomes[1]).toMatchObject({
      status: 'failed',
      failure: 'timeout',
    })
    expect(result.outcomes[2].status).toBe('empty')
  })

  it('distinguishes parser failure from a valid empty result', async () => {
    const adapters: SearchAdapter[] = [
      {
        site: 'ultimate-guitar',
        search: async () => {
          throw new SearchParseError('search data shape changed')
        },
      },
      { site: 'pnwchords', search: async () => [] },
    ]

    const result = await searchSites(adapters, 'song', {
      limiter: new RateLimiterAndCircuitBreaker(),
    })
    expect(result.outcomes[0]).toMatchObject({ status: 'failed', failure: 'parser' })
    expect(result.outcomes[1]).toMatchObject({ status: 'empty', candidates: [] })
  })

  it('opens the existing host pause after repeated blocked responses', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    let now = 0
    const limiter = new RateLimiterAndCircuitBreaker(undefined, () => now)
    const blocked = vi.fn(async () => {
      throw new FetchError('HTTP error 429: private upstream content', 'HTTP_ERROR', 429, 120)
    })

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const outcome = await searchSite(
        { site: 'ultimate-guitar', search: blocked },
        'song',
        { limiter }
      )
      expect(outcome).toMatchObject({ status: 'failed', failure: 'blocked' })
    }

    expect(JSON.parse(info.mock.calls[2][0] as string)).toMatchObject({
      block_reason: 'upstream_rejected', upstream_status: 429, retry_after_seconds: 120,
    })

    now = 10_000
    const paused = await searchSite(
      { site: 'ultimate-guitar', search: blocked },
      'song',
      { limiter }
    )
    expect(paused).toMatchObject({ status: 'failed', failure: 'blocked' })
    expect(paused.message).toMatch(/paused/i)
    expect(blocked).toHaveBeenCalledTimes(3)
    const event = JSON.parse(info.mock.calls[3][0] as string)
    expect(event).toMatchObject({ block_reason: 'host_paused', cooldown_remaining_seconds: 590 })
    expect(event).not.toHaveProperty('upstream_status')
    expect(event).not.toHaveProperty('retry_after_seconds')
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/private upstream content|song/)
  })

  it('logs a 403 without inventing a source retry delay', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await searchSite({ site: 'pnwchords', search: async () => {
      throw new FetchError('Forbidden', 'HTTP_ERROR', 403)
    } }, 'private-query', { limiter: new RateLimiterAndCircuitBreaker() })
    const event = JSON.parse(info.mock.calls[0][0] as string)
    expect(event).toMatchObject({ block_reason: 'upstream_rejected', upstream_status: 403 })
    expect(event).not.toHaveProperty('retry_after_seconds')
    expect(event).not.toHaveProperty('cooldown_remaining_seconds')
    expect(JSON.stringify(event)).not.toContain('private-query')
  })
})

describe('classifySearchError', () => {
  it.each([
    [new FetchError('slow', 'TIMEOUT'), 'timeout'],
    [new FetchError('forbidden', 'HTTP_ERROR', 403), 'blocked'],
    [new FetchError('missing', 'HTTP_ERROR', 404), 'fetch'],
    [new SearchParseError('bad schema'), 'parser'],
    [new Error('socket closed'), 'fetch'],
  ])('classifies %s as %s', (error, expected) => {
    expect(classifySearchError(error).failure).toBe(expected)
  })
})
