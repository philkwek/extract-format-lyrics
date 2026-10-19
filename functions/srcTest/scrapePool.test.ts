import { describe, expect, it, vi } from 'vitest'
import { HostConcurrencyGate, RateLimiterAndCircuitBreaker } from '../src/rateLimit.js'
import { scrapeUrls } from '../src/scrapePool.js'
import type { Song } from '../src/types.js'

function song(url: string): Song {
  return {
    id: url,
    title: 'Song',
    artist: 'Artist',
    sourceUrl: url,
    sourceSite: 'pnwchords',
    originalKey: null,
    sections: [],
  }
}

describe('scrapeUrls', () => {
  it('keeps input order when a slow first song blocks the queue head', async () => {
    const results = await scrapeUrls(
      [
        'https://pnwchords.com/slow',
        'https://pnwchords.com/fast',
        'https://pnwchords.com/third',
      ],
      {
        concurrency: 2,
        gate: new HostConcurrencyGate(),
        limiter: new RateLimiterAndCircuitBreaker(),
        scrape: async (url) => {
          if (url.endsWith('/slow')) await new Promise((resolve) => setTimeout(resolve, 30))
          return song(url)
        },
      }
    )

    expect(results.map((result) => result.url)).toEqual([
      'https://pnwchords.com/slow',
      'https://pnwchords.com/fast',
      'https://pnwchords.com/third',
    ])
    expect(results.every((result) => result.status === 'ok')).toBe(true)
  })

  it('honours a host pause without calling the scraper', async () => {
    const limiter = new RateLimiterAndCircuitBreaker()
    const url = 'https://tabs.ultimate-guitar.com/tab/song'
    const host = new URL(url).hostname
    limiter.recordHostFailure(host, 429)
    limiter.recordHostFailure(host, 429)
    limiter.recordHostFailure(host, 429)
    const scrape = vi.fn(async () => song(url))

    const [result] = await scrapeUrls([url], {
      limiter,
      gate: new HostConcurrencyGate(),
      scrape,
    })

    expect(result).toMatchObject({ status: 'error', code: 'HOST_PAUSED' })
    expect(scrape).not.toHaveBeenCalled()
  })

  it('isolates individual scrape failures', async () => {
    const results = await scrapeUrls(
      ['https://pnwchords.com/a', 'https://pnwchords.com/b'],
      {
        limiter: new RateLimiterAndCircuitBreaker(),
        gate: new HostConcurrencyGate(),
        scrape: async (url) => {
          if (url.endsWith('/b')) throw new Error('parser failed')
          return song(url)
        },
      }
    )
    expect(results[0].status).toBe('ok')
    expect(results[1]).toMatchObject({ status: 'error', message: 'parser failed' })
  })

  it('shares a per-host concurrency limit across overlapping calls', async () => {
    const gate = new HostConcurrencyGate()
    let active = 0
    let maximum = 0
    const scrape = async (url: string) => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active -= 1
      return song(url)
    }
    const limiter = new RateLimiterAndCircuitBreaker()

    await Promise.all([
      scrapeUrls(['https://pnwchords.com/a', 'https://pnwchords.com/b'], {
        gate,
        limiter,
        hostLimit: 1,
        scrape,
      }),
      scrapeUrls(['https://pnwchords.com/c'], { gate, limiter, hostLimit: 1, scrape }),
    ])

    expect(maximum).toBe(1)
    expect(gate.activeCount('pnwchords.com')).toBe(0)
  })

  it('records upstream failures for the existing circuit breaker', async () => {
    const limiter = new RateLimiterAndCircuitBreaker()
    const record = vi.spyOn(limiter, 'recordHostFailure')
    const error = Object.assign(new Error('blocked'), { status: 429 })

    await scrapeUrls(['https://pnwchords.com/a'], {
      limiter,
      gate: new HostConcurrencyGate(),
      scrape: async () => {
        throw error
      },
    })

    expect(record).toHaveBeenCalledWith('pnwchords.com', 429)
  })
})
