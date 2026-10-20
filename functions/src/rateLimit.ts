export interface RateLimitStatus {
  allowed: boolean
  retryAfterSeconds?: number
}

interface IpRecord {
  minuteCount: number
  minuteResetAt: number
  dayCount: number
  dayResetAt: number
}

interface HostRecord {
  consecutiveFailures: number
  pausedUntil: number
}

const IP_SWEEP_INTERVAL_MS = 60_000
export const MAX_IP_RECORDS = 10_000

export class RateLimiterAndCircuitBreaker {
  private ipRecords = new Map<string, IpRecord>()
  private hostRecords = new Map<string, HostRecord>()
  private lastIpSweepAt = 0

  constructor(
    private readonly limits = {
      perMinute: 30,
      perDay: 300,
      consecutiveFailuresToPause: 3,
      pauseDurationSeconds: 10 * 60, // 10 minutes
    },
    private readonly nowFn: () => number = () => Date.now()
  ) {}

  checkIp(ip: string): RateLimitStatus {
    const now = this.nowFn()
    this.evictExpiredIpRecords(now)
    let rec = this.ipRecords.get(ip)

    if (!rec) {
      rec = {
        minuteCount: 0,
        minuteResetAt: now + 60_000,
        dayCount: 0,
        dayResetAt: now + 24 * 60 * 60_000,
      }
      this.ipRecords.set(ip, rec)
      this.enforceIpBound()
    }

    // Reset minute window
    if (now >= rec.minuteResetAt) {
      rec.minuteCount = 0
      rec.minuteResetAt = now + 60_000
    }

    // Reset day window
    if (now >= rec.dayResetAt) {
      rec.dayCount = 0
      rec.dayResetAt = now + 24 * 60 * 60_000
    }

    if (rec.minuteCount >= this.limits.perMinute) {
      const retryAfter = Math.ceil((rec.minuteResetAt - now) / 1000)
      return { allowed: false, retryAfterSeconds: Math.max(1, retryAfter) }
    }

    if (rec.dayCount >= this.limits.perDay) {
      const retryAfter = Math.ceil((rec.dayResetAt - now) / 1000)
      return { allowed: false, retryAfterSeconds: Math.max(1, retryAfter) }
    }

    rec.minuteCount++
    rec.dayCount++
    return { allowed: true }
  }

  /** Number of tracked IPs, exposed for diagnostics and tests. */
  get trackedIpCount(): number {
    return this.ipRecords.size
  }

  /** Opportunistic sweep keeps idle records from accumulating indefinitely. */
  private evictExpiredIpRecords(now: number): void {
    if (now - this.lastIpSweepAt < IP_SWEEP_INTERVAL_MS) return
    this.lastIpSweepAt = now
    for (const [key, rec] of this.ipRecords) {
      if (now >= rec.dayResetAt) this.ipRecords.delete(key)
    }
  }

  private enforceIpBound(): void {
    while (this.ipRecords.size > MAX_IP_RECORDS) {
      const oldest = this.ipRecords.keys().next().value
      if (oldest === undefined) return
      this.ipRecords.delete(oldest)
    }
  }

  isHostPaused(hostname: string): { paused: boolean; retryAfterSeconds?: number } {
    const now = this.nowFn()
    const rec = this.hostRecords.get(hostname.toLowerCase())
    if (!rec || now >= rec.pausedUntil) {
      return { paused: false }
    }
    const retryAfter = Math.ceil((rec.pausedUntil - now) / 1000)
    return { paused: true, retryAfterSeconds: Math.max(1, retryAfter) }
  }

  recordHostFailure(hostname: string, status?: number): void {
    if (status !== 403 && status !== 429) {
      return
    }
    const host = hostname.toLowerCase()
    let rec = this.hostRecords.get(host)
    if (!rec) {
      rec = { consecutiveFailures: 0, pausedUntil: 0 }
      this.hostRecords.set(host, rec)
    }

    rec.consecutiveFailures++
    if (rec.consecutiveFailures >= this.limits.consecutiveFailuresToPause) {
      const now = this.nowFn()
      rec.pausedUntil = now + this.limits.pauseDurationSeconds * 1000
    }
  }

  recordHostSuccess(hostname: string): void {
    const host = hostname.toLowerCase()
    const rec = this.hostRecords.get(host)
    if (rec) {
      rec.consecutiveFailures = 0
    }
  }
}

export const rateLimiter = new RateLimiterAndCircuitBreaker()

/**
 * Instance-wide per-host concurrency gate. A per-request limit alone is not a
 * global limit when several API requests run concurrently in one instance.
 */
export class HostConcurrencyGate {
  private active = new Map<string, number>()
  private waiters = new Map<string, Array<() => void>>()

  async acquire(hostname: string, limit = 2): Promise<() => void> {
    const host = hostname.toLowerCase()
    const current = this.active.get(host) ?? 0
    if (current < Math.max(1, limit)) {
      this.active.set(host, current + 1)
      return this.releaseFn(host)
    }

    return new Promise((resolve) => {
      const queue = this.waiters.get(host) ?? []
      queue.push(() => {
        this.active.set(host, (this.active.get(host) ?? 0) + 1)
        resolve(this.releaseFn(host))
      })
      this.waiters.set(host, queue)
    })
  }

  private releaseFn(host: string): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      const current = this.active.get(host) ?? 1
      this.active.set(host, Math.max(0, current - 1))
      const queue = this.waiters.get(host)
      if (queue?.length) {
        const next = queue.shift()!
        if (queue.length === 0) this.waiters.delete(host)
        next()
      }
    }
  }

  activeCount(hostname: string): number {
    return this.active.get(hostname.toLowerCase()) ?? 0
  }
}

export const hostGate = new HostConcurrencyGate()
