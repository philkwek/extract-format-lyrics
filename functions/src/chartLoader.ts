import type { Song } from './types.js'
import { FetchError, safeFetchHtml } from './safeFetch.js'
import { checkUrl, siteForHost } from './urls.js'
import { scrapeSingleUrl } from './scraper.js'
import { canonicalChartUrl, chartCache, type ChartCache } from './chartCache.js'
import { elapsedMs, recordTiming } from './metrics.js'

export interface ChartLoaderDeps {
  fetchFn?: typeof safeFetchHtml
  cache?: ChartCache
}

const inFlight = new Map<string, Promise<Song>>()

/**
 * Loads a validated source chart through the shared cache.
 *
 * Identical concurrent loads coalesce within this instance; the cache itself
 * is shared across instances. Failures are never cached as valid charts.
 */
export async function loadSourceChart(
  url: string,
  deps: ChartLoaderDeps = {}
): Promise<Song> {
  const check = checkUrl(url)
  if (!check.ok) {
    throw new FetchError(`Invalid or disallowed URL: ${check.reason}`, 'INVALID_URL')
  }
  const canonical = canonicalChartUrl(check.url)
  const cache = deps.cache ?? chartCache
  const site = siteForHost(new URL(check.url).hostname) ?? 'unknown'

  const active = inFlight.get(canonical)
  if (active) return active

  const lookupStartedAt = Date.now()
  // Validation happens before every cache read, including alias targets.
  const cached = await cache.get(canonical)
  recordTiming({
    operation: 'cache.lookup',
    site,
    durationMs: elapsedMs(lookupStartedAt),
    outcome: cached ? 'hit' : 'miss',
    cacheStatus: cached ? 'hit' : 'miss',
  })
  if (cached) return cached

  const raced = inFlight.get(canonical)
  if (raced) return raced

  const task = (async () => {
    const song = await scrapeSingleUrl(check.url, deps.fetchFn)
    await cache.save(check.url, song)
    return song
  })()
  inFlight.set(canonical, task)
  try {
    return await task
  } finally {
    inFlight.delete(canonical)
  }
}
