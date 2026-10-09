import { describe, it, expect } from 'vitest'
import { RateLimiterAndCircuitBreaker } from './rateLimit.js'

describe('RateLimiterAndCircuitBreaker', () => {
  it('enforces per-minute IP limit and returns retryAfter', () => {
    let mockTime = 1000
    const limiter = new RateLimiterAndCircuitBreaker(
      { perMinute: 2, perDay: 10, consecutiveFailuresToPause: 3, pauseDurationSeconds: 60 },
      () => mockTime
    )

    expect(limiter.checkIp('1.2.3.4').allowed).toBe(true)
    expect(limiter.checkIp('1.2.3.4').allowed).toBe(true)
    const blocked = limiter.checkIp('1.2.3.4')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)

    // Advance time past minute window
    mockTime += 61_000
    expect(limiter.checkIp('1.2.3.4').allowed).toBe(true)
  })

  it('trips circuit breaker after consecutive 403/429 failures', () => {
    let mockTime = 1000
    const limiter = new RateLimiterAndCircuitBreaker(
      { perMinute: 10, perDay: 50, consecutiveFailuresToPause: 3, pauseDurationSeconds: 600 },
      () => mockTime
    )

    expect(limiter.isHostPaused('tabs.ultimate-guitar.com').paused).toBe(false)

    limiter.recordHostFailure('tabs.ultimate-guitar.com', 403)
    limiter.recordHostFailure('tabs.ultimate-guitar.com', 429)
    expect(limiter.isHostPaused('tabs.ultimate-guitar.com').paused).toBe(false)

    limiter.recordHostFailure('tabs.ultimate-guitar.com', 403)
    const pausedStatus = limiter.isHostPaused('tabs.ultimate-guitar.com')
    expect(pausedStatus.paused).toBe(true)
    expect(pausedStatus.retryAfterSeconds).toBe(600)

    // Fast-forward past 10 minutes
    mockTime += 601_000
    expect(limiter.isHostPaused('tabs.ultimate-guitar.com').paused).toBe(false)
  })

  it('resets consecutive failures upon success', () => {
    const limiter = new RateLimiterAndCircuitBreaker()
    limiter.recordHostFailure('pnwchords.com', 403)
    limiter.recordHostFailure('pnwchords.com', 403)
    limiter.recordHostSuccess('pnwchords.com')
    limiter.recordHostFailure('pnwchords.com', 403)

    // Only 1 failure recorded since reset -> not paused
    expect(limiter.isHostPaused('pnwchords.com').paused).toBe(false)
  })
})
