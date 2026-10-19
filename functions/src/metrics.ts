/**
 * Lightweight, privacy-safe performance measurements.
 *
 * Events intentionally contain only bounded metadata: supported site id,
 * operation, duration, outcome, cache status and attempt counts. Queries,
 * titles, URLs, lyrics and identifiers must never be passed here.
 */

export type MetricSite =
  | 'ultimate-guitar'
  | 'pnwchords'
  | 'worshipchords'
  | 'worshiptogether'
  | 'generic'
  | 'unknown'

export type MetricOutcome =
  | 'ok'
  | 'empty'
  | 'partial'
  | 'error'
  | 'timeout'
  | 'blocked'
  | 'hit'
  | 'miss'
  | 'skipped'

export type MetricOperation =
  | 'search.site'
  | 'search.total'
  | 'chart.fetch'
  | 'chart.parse'
  | 'chart.simplify'
  | 'chart.scrape'
  | 'fetch.attempts'
  | 'cache.lookup'

export interface TimingMetric {
  operation: MetricOperation
  outcome: MetricOutcome
  durationMs: number
  site?: MetricSite | string
  cacheStatus?: 'hit' | 'miss' | 'stale' | 'bypass' | 'unavailable'
  attempts?: number
  retryOutcome?: 'not_retried' | 'succeeded' | 'failed'
}

const DISABLED = process.env.PERF_METRICS === '0'

/** Rounds and bounds numeric fields so log payloads stay small and predictable. */
export function recordTiming(metric: TimingMetric): void {
  if (DISABLED) return
  const event: Record<string, string | number> = {
    type: 'perf',
    operation: metric.operation,
    outcome: metric.outcome,
    duration_ms: Math.max(0, Math.min(600_000, Math.round(metric.durationMs))),
  }
  if (metric.site) event.site = metric.site
  if (metric.cacheStatus) event.cache_status = metric.cacheStatus
  if (metric.attempts !== undefined) event.attempts = Math.max(0, Math.min(10, Math.round(metric.attempts)))
  if (metric.retryOutcome) event.retry_outcome = metric.retryOutcome
  // Cloud Logging captures structured stdout lines; no monitoring platform is added.
  console.info(JSON.stringify(event))
}

export function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt
}
