import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordTiming } from '../src/metrics.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('recordTiming', () => {
  it('logs only bounded metadata fields', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    recordTiming({
      operation: 'search.site',
      site: 'ultimate-guitar',
      durationMs: 123.6,
      outcome: 'ok',
      cacheStatus: 'miss',
      attempts: 2,
      retryOutcome: 'succeeded',
    })

    expect(info).toHaveBeenCalledTimes(1)
    expect(JSON.parse(info.mock.calls[0][0] as string)).toEqual({
      type: 'perf',
      operation: 'search.site',
      site: 'ultimate-guitar',
      duration_ms: 124,
      outcome: 'ok',
      cache_status: 'miss',
      attempts: 2,
      retry_outcome: 'succeeded',
    })
  })

  it('clamps anomalous durations and attempts', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    recordTiming({
      operation: 'search.total',
      durationMs: Number.MAX_SAFE_INTEGER,
      outcome: 'timeout',
      attempts: 500,
    })
    const event = JSON.parse(info.mock.calls[0][0] as string)
    expect(event.duration_ms).toBe(600_000)
    expect(event.attempts).toBe(10)
    expect(event).not.toHaveProperty('query')
  })
})
