import { lookup as dnsLookup } from 'node:dns/promises'
import { checkUrl, siteForHost } from './urls.js'
import { elapsedMs, recordTiming } from './metrics.js'

export class FetchError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_URL' | 'SSRF_BLOCKED' | 'TIMEOUT' | 'PAYLOAD_TOO_LARGE' | 'INVALID_CONTENT_TYPE' | 'HTTP_ERROR' | 'NETWORK_ERROR',
    public readonly status?: number,
    public readonly retryAfterSeconds?: number
  ) {
    super(message)
    this.name = 'FetchError'
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined
  const seconds = /^\d+$/.test(value)
    ? Number(value)
    : Number.isNaN(Number(value))
      ? Math.ceil((Date.parse(value) - Date.now()) / 1000)
      : NaN
  return Number.isFinite(seconds) ? Math.max(0, seconds) : undefined
}

/**
 * Checks if an IPv4 or IPv6 address belongs to private, loopback, link-local,
 * CGNAT, unspecified, or cloud metadata addresses.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  // Normalize IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  const targetIp = v4Mapped ? v4Mapped[1] : ip

  if (targetIp.includes('.')) {
    // IPv4 parsing
    const parts = targetIp.split('.').map((p) => Number.parseInt(p, 10))
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
      return true // Malformed -> reject
    }
    const [a, b] = parts

    // 0.0.0.0/8 (current network)
    if (a === 0) return true
    // 10.0.0.0/8 (private)
    if (a === 10) return true
    // 127.0.0.0/8 (loopback)
    if (a === 127) return true
    // 100.64.0.0/10 (CGNAT)
    if (a === 100 && b >= 64 && b <= 127) return true
    // 169.254.0.0/16 (link-local, cloud metadata 169.254.169.254)
    if (a === 169 && b === 254) return true
    // 172.16.0.0/12 (private: 172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true
    // 192.168.0.0/16 (private)
    if (a === 192 && b === 168) return true
    // 224.0.0.0/4 (multicast) & 240.0.0.0/4 (reserved)
    if (a >= 224) return true

    return false
  }

  // IPv6 checks
  const lower = targetIp.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  // Unique local fc00::/7 (fc00:: - fdff::)
  if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true
  // Link-local unicast fe80::/10 (fe80:: - febf::)
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true

  return false
}

export interface SafeFetchOptions {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  lookupFn?: typeof dnsLookup
  fetchFn?: typeof fetch
  userAgent?: string
}

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 // 2 MB
const DEFAULT_MAX_REDIRECTS = 3
const RETRY_DELAY_MS = 300
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

interface FetchDeadline {
  signal: AbortSignal
  controller: AbortController
  remainingMs(): number
  dispose(): void
}

function timeoutError(timeoutMs: number): FetchError {
  return new FetchError(`Request timed out after ${timeoutMs}ms`, 'TIMEOUT')
}

function createDeadline(timeoutMs: number): FetchDeadline {
  const controller = new AbortController()
  const budgetMs = Number.isFinite(timeoutMs) ? Math.max(1, timeoutMs) : DEFAULT_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(timeoutError(budgetMs)), budgetMs)
  // Never keep a serverless process alive solely for a timeout timer.
  timer.unref?.()
  const expiresAt = Date.now() + budgetMs
  return {
    controller,
    signal: controller.signal,
    remainingMs: () => Math.max(0, expiresAt - Date.now()),
    dispose: () => clearTimeout(timer),
  }
}

function throwIfExpired(deadline: FetchDeadline, timeoutMs: number): void {
  if (deadline.signal.aborted || deadline.remainingMs() <= 0) {
    throw timeoutError(timeoutMs)
  }
}

/**
 * Stops awaiting work at the overall deadline. The source promise keeps its
 * own rejection handler attached, so a late DNS/fetch/body settlement cannot
 * surface as an unhandled rejection.
 */
function withinDeadline<T>(promise: Promise<T>, deadline: FetchDeadline, timeoutMs: number): Promise<T> {
  if (deadline.signal.aborted) {
    promise.catch(() => {})
    return Promise.reject(timeoutError(timeoutMs))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(timeoutError(timeoutMs))
    }
    const cleanup = () => deadline.signal.removeEventListener('abort', onAbort)
    deadline.signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (err) => {
        cleanup()
        reject(err)
      }
    )
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms))
    timer.unref?.()
  })
}

/**
 * Validates the hostname via DNS and checks for SSRF targets.
 */
export async function assertSafeDns(
  hostname: string,
  lookupFn: typeof dnsLookup = dnsLookup
): Promise<void> {
  let addresses: Array<{ address: string }>
  try {
    const res = await lookupFn(hostname, { all: true })
    addresses = Array.isArray(res) ? res : [res]
  } catch (err) {
    throw new FetchError(`DNS lookup failed for ${hostname}: ${(err as Error).message}`, 'NETWORK_ERROR')
  }

  if (addresses.length === 0) {
    throw new FetchError(`No DNS records found for ${hostname}`, 'NETWORK_ERROR')
  }

  for (const { address } of addresses) {
    if (isPrivateOrReservedIp(address)) {
      throw new FetchError(`Resolved IP ${address} for ${hostname} is blocked (SSRF guard)`, 'SSRF_BLOCKED')
    }
  }
}

async function fetchWithLimits(
  url: string,
  options: SafeFetchOptions,
  deadline: FetchDeadline,
  timeoutMs: number,
  redirectCount = 0
): Promise<{ text: string; finalUrl: string }> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const lookup = options.lookupFn ?? dnsLookup
  const customFetch = options.fetchFn ?? fetch

  throwIfExpired(deadline, timeoutMs)

  // 1. Validate URL and allow-list. These failures are never retried.
  const check = checkUrl(url)
  if (!check.ok) {
    throw new FetchError(`Invalid or disallowed URL: ${check.reason}`, 'INVALID_URL')
  }

  const parsed = new URL(check.url)

  // 2. SSRF check on DNS. Node's resolver cannot be cancelled, so stop awaiting
  // at the deadline while leaving a rejection handler on the eventual result.
  await withinDeadline(assertSafeDns(parsed.hostname, lookup), deadline, timeoutMs)
  throwIfExpired(deadline, timeoutMs)

  // 3. Perform fetch with manual redirects. One signal covers the whole request,
  // including redirects and body streaming.
  let res: Response
  try {
    res = await withinDeadline(
      customFetch(check.url, {
        method: 'GET',
        headers: {
          'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'manual',
        signal: deadline.signal,
      }),
      deadline,
      timeoutMs
    )
  } catch (err: unknown) {
    if (deadline.signal.aborted || (err as Error)?.name === 'AbortError' || (err as FetchError)?.code === 'TIMEOUT') {
      throw timeoutError(timeoutMs)
    }
    throw new FetchError(`Network error: ${(err as Error).message}`, 'NETWORK_ERROR')
  }

  // 4. Handle redirects, re-validating every destination.
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    try {
      await res.body?.cancel()
    } catch {
      // The redirect body is not needed.
    }
    if (redirectCount >= maxRedirects) {
      throw new FetchError(`Too many redirects (max ${maxRedirects})`, 'HTTP_ERROR', res.status)
    }
    const location = res.headers.get('location')
    if (!location) {
      throw new FetchError('Redirect without Location header', 'HTTP_ERROR', res.status)
    }
    const resolvedRedirect = new URL(location, check.url).toString()
    return fetchWithLimits(resolvedRedirect, options, deadline, timeoutMs, redirectCount + 1)
  }

  // 5. Handle HTTP status. Only 5xx is retryable; this rejects 403/429 and
  // invalid destinations without spending the retry budget.
  if (!res.ok) {
    throw new FetchError(
      `HTTP error ${res.status}: ${res.statusText}`,
      'HTTP_ERROR',
      res.status,
      parseRetryAfter(res.headers.get('retry-after'))
    )
  }

  // 6. Check content-type. Invalid content is never retried.
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    throw new FetchError(`Unexpected content-type "${contentType}", expected HTML`, 'INVALID_CONTENT_TYPE')
  }

  // 7. Stream and enforce size and deadline limits.
  if (!res.body) {
    return { text: '', finalUrl: check.url }
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      throwIfExpired(deadline, timeoutMs)
      const { done, value } = await withinDeadline(reader.read(), deadline, timeoutMs)
      if (done) break
      if (value) {
        totalBytes += value.length
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel()
          } catch {
            // ignore
          }
          throw new FetchError(`Response body exceeded limit of ${maxBytes} bytes`, 'PAYLOAD_TOO_LARGE')
        }
        chunks.push(value)
      }
    }
  } catch (err) {
    if (err instanceof FetchError) throw err
    if (deadline.signal.aborted) throw timeoutError(timeoutMs)
    throw new FetchError(`Stream reading error: ${(err as Error).message}`, 'NETWORK_ERROR')
  } finally {
    if (deadline.signal.aborted) {
      try {
        await reader.cancel()
      } catch {
        // Best effort cancellation on timeout.
      }
    }
    try {
      reader.releaseLock()
    } catch {
      // The stream may already be closed or cancelled.
    }
  }

  const totalBuffer = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    totalBuffer.set(chunk, offset)
    offset += chunk.length
  }

  const text = new TextDecoder('utf-8').decode(totalBuffer)
  return { text, finalUrl: check.url }
}

/**
 * Fetches an HTML page with safety checks, SSRF guards, timeouts, and 1 retry on 5xx/timeout.
 */
function fetchOutcome(code: string | undefined): 'timeout' | 'blocked' | 'error' {
  if (code === 'TIMEOUT') return 'timeout'
  if (code === 'SSRF_BLOCKED' || code === 'INVALID_URL') return 'blocked'
  return 'error'
}

export async function safeFetchHtml(
  url: string,
  options: SafeFetchOptions = {}
): Promise<{ text: string; finalUrl: string }> {
  const startedAt = Date.now()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const deadline = createDeadline(timeoutMs)
  let site = 'unknown'
  try {
    site = siteForHost(new URL(url).hostname) ?? 'unknown'
  } catch {
    // checkUrl will report the malformed URL.
  }

  try {
    const result = await fetchWithLimits(url, options, deadline, timeoutMs)
    recordTiming({
      operation: 'fetch.attempts',
      site,
      durationMs: elapsedMs(startedAt),
      outcome: 'ok',
      attempts: 1,
      retryOutcome: 'not_retried',
    })
    return result
  } catch (err) {
    const fetchErr = err as FetchError
    const isRetryable =
      fetchErr.code === 'TIMEOUT' ||
      (fetchErr.code === 'HTTP_ERROR' && fetchErr.status !== undefined && fetchErr.status >= 500)

    // URL validation, blocked destinations, content-type and payload errors are
    // never retried. Retry work must fit inside the one overall deadline.
    const remaining = deadline.remainingMs()
    if (!isRetryable || remaining <= 0 || deadline.signal.aborted) {
      const outcome = deadline.signal.aborted ? 'timeout' : fetchOutcome(fetchErr.code)
      recordTiming({
        operation: 'fetch.attempts',
        site,
        durationMs: elapsedMs(startedAt),
        outcome,
        attempts: 1,
        retryOutcome: 'not_retried',
      })
      if (deadline.signal.aborted) throw timeoutError(timeoutMs)
      throw err
    }

    // Keep the backoff bounded by the remaining budget. If the whole budget
    // cannot cover the delay plus another attempt, fail predictably instead.
    const backoffMs = Math.min(RETRY_DELAY_MS, remaining)
    if (remaining <= backoffMs + 1) {
      recordTiming({
        operation: 'fetch.attempts',
        site,
        durationMs: elapsedMs(startedAt),
        outcome: fetchOutcome(fetchErr.code),
        attempts: 1,
        retryOutcome: 'not_retried',
      })
      throw err
    }

    try {
      await withinDeadline(delay(backoffMs), deadline, timeoutMs)
    } catch {
      recordTiming({
        operation: 'fetch.attempts',
        site,
        durationMs: elapsedMs(startedAt),
        outcome: 'timeout',
        attempts: 1,
        retryOutcome: 'failed',
      })
      throw timeoutError(timeoutMs)
    }

    try {
      const result = await fetchWithLimits(url, options, deadline, timeoutMs)
      recordTiming({
        operation: 'fetch.attempts',
        site,
        durationMs: elapsedMs(startedAt),
        outcome: 'ok',
        attempts: 2,
        retryOutcome: 'succeeded',
      })
      return result
    } catch (retryErr) {
      const retryFetchErr = retryErr as FetchError
      const timedOut = deadline.signal.aborted || retryFetchErr.code === 'TIMEOUT'
      recordTiming({
        operation: 'fetch.attempts',
        site,
        durationMs: elapsedMs(startedAt),
        outcome: timedOut ? 'timeout' : fetchOutcome(retryFetchErr.code),
        attempts: 2,
        retryOutcome: 'failed',
      })
      if (timedOut) throw timeoutError(timeoutMs)
      throw retryErr
    }
  } finally {
    deadline.dispose()
  }
}
