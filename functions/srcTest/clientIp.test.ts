import { describe, expect, it } from 'vitest'
import { clientIpFromRequest } from '../src/clientIp.js'

describe('clientIpFromRequest', () => {
  it('ignores a caller-supplied prefix on the direct functions path', () => {
    const ip = clientIpFromRequest({
      headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.9' },
      ip: '10.0.0.1',
    })
    expect(ip).toBe('203.0.113.9')
  })

  it('ignores Fastly-Client-IP on the direct functions path', () => {
    const ip = clientIpFromRequest({
      headers: {
        'fastly-client-ip': '198.51.100.7',
        'x-forwarded-for': '1.2.3.4, 203.0.113.9',
      },
    })
    expect(ip).toBe('203.0.113.9')
  })

  it('handles array header values', () => {
    const ip = clientIpFromRequest({
      headers: { 'x-forwarded-for': ['1.2.3.4', '203.0.113.9'] },
      ip: '10.0.0.1',
    })
    expect(ip).toBe('203.0.113.9')
  })

  it('uses a single header value as-is', () => {
    expect(clientIpFromRequest({ headers: { 'x-forwarded-for': '198.51.100.7' } })).toBe(
      '198.51.100.7'
    )
  })

  it('falls back to req.ip when the header is missing', () => {
    expect(clientIpFromRequest({ headers: {}, ip: '10.0.0.1' })).toBe('10.0.0.1')
  })

  it('falls back to unknown when no address is available', () => {
    expect(clientIpFromRequest({ headers: {} })).toBe('unknown')
  })
})
