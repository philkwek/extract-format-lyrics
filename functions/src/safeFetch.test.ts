import { describe, it, expect, vi } from 'vitest'
import type { lookup as dnsLookup } from 'node:dns/promises'
import { isPrivateOrReservedIp, safeFetchHtml, assertSafeDns } from './safeFetch.js'

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

describe('safeFetchHtml', () => {
  const publicLookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])

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
})
