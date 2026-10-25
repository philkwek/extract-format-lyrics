import { describe, it, expect, vi } from 'vitest'
import type { lookup as dnsLookup } from 'node:dns/promises'
import {
  isPrivateOrReservedIp,
  safeFetchHtml,
  assertSafeDns,
  usesImpitTransport,
} from '../src/safeFetch.js'

type DnsLookupFn = typeof dnsLookup

describe('isPrivateOrReservedIp', () => {
  it('identifies private IPv4 addresses', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true)
    expect(isPrivateOrReservedIp('10.0.0.1')).toBe(true)
    expect(isPrivateOrReservedIp('192.168.1.10')).toBe(true)
    expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true)
    expect(isPrivateOrReservedIp('172.31.255.255')).toBe(true)
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true) // AWS/GCP metadata
    expect(isPrivateOrReservedIp('0.0.0.0')).toBe(true)
    expect(isPrivateOrReservedIp('100.64.0.1')).toBe(true) // CGNAT
  })

  it('allows public IPv4 addresses', () => {
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false)
    expect(isPrivateOrReservedIp('1.1.1.1')).toBe(false)
    expect(isPrivateOrReservedIp('172.15.255.255')).toBe(false)
    expect(isPrivateOrReservedIp('172.32.0.1')).toBe(false)
  })

  it('identifies private/reserved IPv6 addresses', () => {
    expect(isPrivateOrReservedIp('::1')).toBe(true)
    expect(isPrivateOrReservedIp('::')).toBe(true)
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true)
    expect(isPrivateOrReservedIp('fc00::1')).toBe(true)
    expect(isPrivateOrReservedIp('fd12:3456:789a::1')).toBe(true)
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true)
  })

  it('rejects malformed IPs', () => {
    expect(isPrivateOrReservedIp('999.999.999.999')).toBe(true)
    expect(isPrivateOrReservedIp('127.0.0.999')).toBe(true)
  })
})

describe('assertSafeDns', () => {
  it('blocks DNS resolving to private IP', async () => {
    const mockLookup = vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    await expect(assertSafeDns('tabs.ultimate-guitar.com', mockLookup as unknown as DnsLookupFn)).rejects.toThrow(
      /blocked \(SSRF guard\)/
    )
  })

  it('passes DNS resolving to public IP', async () => {
    const mockLookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    await expect(assertSafeDns('tabs.ultimate-guitar.com', mockLookup as unknown as DnsLookupFn)).resolves.toBeUndefined()
  })
})

describe('usesImpitTransport', () => {
  it('selects Impit for both Worship Chords domains and their subdomains', () => {
    expect(usesImpitTransport('worshipchords.com')).toBe(true)
    expect(usesImpitTransport('www.worshipchords.net')).toBe(true)
    expect(usesImpitTransport('pnwchords.com')).toBe(false)
    expect(usesImpitTransport('worshipchords.com.evil.com')).toBe(false)
  })
})

describe('safeFetchHtml', () => {
  const publicLookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])

  it('allows an injected fetch for worshipchords.net without loading Impit', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('<html><body>Song</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    )
    const result = await safeFetchHtml(
      'https://www.worshipchords.net/guitar/artist/song',
      {
        lookupFn: publicLookup as unknown as DnsLookupFn,
        fetchFn: mockFetch as unknown as typeof fetch,
      }
    )
    expect(result.text).toContain('Song')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['600', 600],
    ['0', 0],
    [null, undefined],
    ['invalid', undefined],
    ['-1', undefined],
    ['1.5', undefined],
    ['Infinity', undefined],
  ])('preserves status and parses Retry-After %s without retrying', async (header, expected) => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('private upstream content', {
      status: 429,
      headers: header === null ? {} : { 'Retry-After': header },
    }))
    await expect(safeFetchHtml('https://pnwchords.com/?s=private-query', {
      lookupFn: publicLookup as unknown as DnsLookupFn,
      fetchFn: mockFetch as unknown as typeof fetch,
    })).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 429, retryAfterSeconds: expected })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it.each([60, -60])('parses a Retry-After HTTP date %s seconds from now', async (offset) => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 20, 4, 0, 0))
    try {
      const mockFetch = vi.fn().mockResolvedValue(new Response('Forbidden', {
        status: 403,
        headers: { 'Retry-After': new Date(Date.now() + offset * 1000).toUTCString() },
      }))
      await expect(safeFetchHtml('https://pnwchords.com/', {
        lookupFn: publicLookup as unknown as DnsLookupFn,
        fetchFn: mockFetch as unknown as typeof fetch,
      })).rejects.toMatchObject({ status: 403, retryAfterSeconds: Math.max(0, offset) })
    } finally {
      now.mockRestore()
    }
  })

  it('rejects non-allowlisted domains before fetch', async () => {
    await expect(safeFetchHtml('https://evil.com/song')).rejects.toThrow(/not supported/)
  })

  it('rejects payload exceeding maxBytes', async () => {
    const largeBody = 'a'.repeat(200)
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(largeBody, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    )

    await expect(
      safeFetchHtml('https://pnwchords.com/song', {
        maxBytes: 100,
        lookupFn: publicLookup as unknown as DnsLookupFn,
        fetchFn: mockFetch as unknown as typeof fetch,
      })
    ).rejects.toThrow(/exceeded limit/)
  })

  it('rejects non-HTML responses', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{"data": 123}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    await expect(
      safeFetchHtml('https://pnwchords.com/song', {
        lookupFn: publicLookup as unknown as DnsLookupFn,
        fetchFn: mockFetch as unknown as typeof fetch,
      })
    ).rejects.toThrow(/expected HTML/)
  })

  it('does NOT retry on 403 or 404', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('Forbidden', {
        status: 403,
        statusText: 'Forbidden',
      })
    )

    await expect(
      safeFetchHtml('https://pnwchords.com/song', {
        lookupFn: publicLookup as unknown as DnsLookupFn,
        fetchFn: mockFetch as unknown as typeof fetch,
      })
    ).rejects.toThrow(/HTTP error 403/)

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('retries once on 503 and succeeds on second attempt', async () => {
    let callCount = 0
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return new Response('Unavailable', { status: 503, statusText: 'Service Unavailable' })
      }
      return new Response('<html><body>Success</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    })

    const res = await safeFetchHtml('https://pnwchords.com/song', {
      lookupFn: publicLookup as unknown as DnsLookupFn,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(callCount).toBe(2)
    expect(res.text).toContain('Success')
  })

  it('validates redirect destinations against allow-list and SSRF', async () => {
    let callCount = 0
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://attacker.com/steal' },
        })
      }
      return new Response('OK', { status: 200 })
    })

    await expect(
      safeFetchHtml('https://pnwchords.com/song', {
        lookupFn: publicLookup as unknown as DnsLookupFn,
        fetchFn: mockFetch as unknown as typeof fetch,
      })
    ).rejects.toThrow(/not supported/)
  })

  it('times out stalled response headers within the overall budget', async () => {
    const mockFetch = vi.fn(() => new Promise<Response>(() => {}))
    const startedAt = Date.now()

    await expect(
      safeFetchHtml('https://pnwchords.com/song', {
        timeoutMs: 40,
        lookupFn: publicLookup as unknown as DnsLookupFn,
        fetchFn: mockFetch as unknown as typeof fetch,
      })
    ).rejects.toMatchObject({ code: 'TIMEOUT' })

    expect(Date.now() - startedAt).toBeLessThan(500)
  })

  it('times out a stalled response body and cancels the reader', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('<html><body>partial'))
      },
      cancel,
    })
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    )

    await expect(
      safeFetchHtml('https://pnwchords.com/song', {
        timeoutMs: 40,
        lookupFn: publicLookup as unknown as DnsLookupFn,
        fetchFn: mockFetch as unknown as typeof fetch,
      })
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(cancel).toHaveBeenCalled()
  })

  it('stops awaiting delayed DNS at the deadline without an unhandled rejection', async () => {
    let resolveDns!: (value: Array<{ address: string; family: number }>) => void
    const slowLookup = vi.fn(
      () =>
        new Promise<Array<{ address: string; family: number }>>((resolve) => {
          resolveDns = resolve
        })
    )

    await expect(
      safeFetchHtml('https://pnwchords.com/song', {
        timeoutMs: 30,
        lookupFn: slowLookup as unknown as DnsLookupFn,
        fetchFn: vi.fn() as unknown as typeof fetch,
      })
    ).rejects.toMatchObject({ code: 'TIMEOUT' })

    // Late DNS settlement is handled safely.
    resolveDns([{ address: '93.184.216.34', family: 4 }])
    await Promise.resolve()
  })

  it('applies one deadline across redirect chains', async () => {
    let calls = 0
    const mockFetch = vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return new Response(null, {
          status: 302,
          headers: { location: 'https://pnwchords.com/final' },
        })
      }
      return new Promise<Response>(() => {})
    })
    const startedAt = Date.now()

    await expect(
      safeFetchHtml('https://pnwchords.com/song', {
        timeoutMs: 200,
        lookupFn: publicLookup as unknown as DnsLookupFn,
        fetchFn: mockFetch as unknown as typeof fetch,
      })
    ).rejects.toMatchObject({ code: 'TIMEOUT' })

    expect(calls).toBe(2)
    // A per-request timer would take ~300ms; one overall budget takes ~200ms.
    expect(Date.now() - startedAt).toBeLessThan(275)
  })

  it('retries a 5xx once and reports retry exhaustion', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('Unavailable', { status: 503, statusText: 'Service Unavailable' })
    )

    await expect(
      safeFetchHtml('https://pnwchords.com/song', {
        timeoutMs: 2_000,
        lookupFn: publicLookup as unknown as DnsLookupFn,
        fetchFn: mockFetch as unknown as typeof fetch,
      })
    ).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 503 })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('does not start a retry that cannot fit in the remaining budget', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('Unavailable', { status: 503, statusText: 'Service Unavailable' })
    )
    const startedAt = Date.now()

    await expect(
      safeFetchHtml('https://pnwchords.com/song', {
        timeoutMs: 80,
        lookupFn: publicLookup as unknown as DnsLookupFn,
        fetchFn: mockFetch as unknown as typeof fetch,
      })
    ).rejects.toMatchObject({ code: 'HTTP_ERROR' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(Date.now() - startedAt).toBeLessThan(250)
  })

  it('does not retry invalid content types or oversized bodies', async () => {
    const invalidTypeFetch = vi.fn().mockResolvedValue(
      new Response('{"data":1}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    await expect(
      safeFetchHtml('https://pnwchords.com/song', {
        lookupFn: publicLookup as unknown as DnsLookupFn,
        fetchFn: invalidTypeFetch as unknown as typeof fetch,
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONTENT_TYPE' })
    expect(invalidTypeFetch).toHaveBeenCalledTimes(1)

    const oversizedFetch = vi.fn().mockResolvedValue(
      new Response('a'.repeat(200), {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    )
    await expect(
      safeFetchHtml('https://pnwchords.com/song', {
        maxBytes: 100,
        lookupFn: publicLookup as unknown as DnsLookupFn,
        fetchFn: oversizedFetch as unknown as typeof fetch,
      })
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' })
    expect(oversizedFetch).toHaveBeenCalledTimes(1)
  })
})
