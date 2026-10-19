import { FetchError } from '../safeFetch.js'
import { RateLimiterAndCircuitBreaker, rateLimiter } from '../rateLimit.js'
import { elapsedMs, recordTiming } from '../metrics.js'
import type { SearchAdapter, SearchCandidate, SearchFailureReason, SearchSiteOutcome } from './types.js'
import { SearchParseError } from './types.js'

export const SEARCH_HOSTS: Record<string, string> = {
  'ultimate-guitar': 'www.ultimate-guitar.com',
  pnwchords: 'pnwchords.com',
  worshiptogether: 'www.worshiptogether.com',
}

export interface SearchSiteDeps {
  limiter?: RateLimiterAndCircuitBreaker
}

export function classifySearchError(err: unknown): { failure: SearchFailureReason; message: string } {
  if (err instanceof SearchParseError) {
    return { failure: 'parser', message: err.message }
  }
  if (err instanceof FetchError) {
    if (err.code === 'TIMEOUT') return { failure: 'timeout', message: err.message }
    if (err.code === 'SSRF_BLOCKED' || err.code === 'INVALID_URL' || err.code === 'INVALID_CONTENT_TYPE') {
      return { failure: 'fetch', message: err.message }
    }
    if (err.code === 'HTTP_ERROR' && (err.status === 403 || err.status === 429)) {
      return { failure: 'blocked', message: err.message }
    }
    return { failure: 'fetch', message: err.message }
  }
  const status = (err as { status?: number })?.status
  if (status === 403 || status === 429) {
    return { failure: 'blocked', message: (err as Error).message || 'Search source blocked the request' }
  }
  return { failure: 'fetch', message: (err as Error)?.message || 'Search source failed' }
}

/**
 * Runs one site search and converts every failure into a typed outcome.
 * "No matches" stays distinct from "site unavailable".
 */
export async function searchSite(
  adapter: SearchAdapter,
  query: string,
  deps: SearchSiteDeps = {}
): Promise<SearchSiteOutcome> {
  const limiter = deps.limiter ?? rateLimiter
  const host = SEARCH_HOSTS[adapter.site] ?? adapter.site
  const startedAt = Date.now()

  const paused = limiter.isHostPaused(host)
  if (paused.paused) {
    const durationMs = elapsedMs(startedAt)
    recordTiming({ operation: 'search.site', site: adapter.site, durationMs, outcome: 'blocked' })
    return {
      site: adapter.site,
      status: 'failed',
      candidates: [],
      durationMs,
      failure: 'blocked',
      message: `Search for ${adapter.site} is temporarily paused after repeated upstream errors`,
    }
  }

  try {
    const candidates = await adapter.search(query)
    const durationMs = elapsedMs(startedAt)
    limiter.recordHostSuccess(host)
    recordTiming({
      operation: 'search.site',
      site: adapter.site,
      durationMs,
      outcome: candidates.length > 0 ? 'ok' : 'empty',
    })
    return {
      site: adapter.site,
      status: candidates.length > 0 ? 'ok' : 'empty',
      candidates,
      durationMs,
    }
  } catch (err) {
    const durationMs = elapsedMs(startedAt)
    const { failure, message } = classifySearchError(err)
    const status = (err as FetchError)?.status
    if (failure === 'blocked') {
      limiter.recordHostFailure(host, status ?? 429)
    }
    recordTiming({
      operation: 'search.site',
      site: adapter.site,
      durationMs,
      outcome: failure === 'timeout' ? 'timeout' : failure === 'blocked' ? 'blocked' : 'error',
    })
    return { site: adapter.site, status: 'failed', candidates: [], durationMs, failure, message }
  }
}

export interface SearchSitesResult {
  candidates: SearchCandidate[]
  outcomes: SearchSiteOutcome[]
}

/** Starts every site search immediately; one failed site cannot hide another. */
export async function searchSites(
  adapters: SearchAdapter[],
  query: string,
  deps: SearchSiteDeps = {},
  onOutcome?: (outcome: SearchSiteOutcome) => void
): Promise<SearchSitesResult> {
  const outcomes = await Promise.all(
    adapters.map(async (adapter) => {
      const outcome = await searchSite(adapter, query, deps)
      onOutcome?.(outcome)
      return outcome
    })
  )
  const candidates = outcomes.flatMap((outcome) => outcome.candidates)
  return { candidates, outcomes }
}
