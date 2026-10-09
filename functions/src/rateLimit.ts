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

export class RateLimiterAndCircuitBreaker {
  private ipRecords = new Map<string, IpRecord>()
  private hostRecords = new Map<string, HostRecord>()

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
    let rec = this.ipRecords.get(ip)

    if (!rec) {
      rec = {
        minuteCount: 0,
        minuteResetAt: now + 60_000,
        dayCount: 0,
        dayResetAt: now + 24 * 60 * 60_000,
      }
      this.ipRecords.set(ip, rec)
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
