import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Request, Response } from 'express'
import { api, extractSheet } from '../src/index.js'

function callApi(req: Partial<Request>, handler: typeof api = api) {
  const headers: Record<string, string> = {}
  const res = {
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value
    }),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  }
  const done = handler(req as Request, res as unknown as Response)
  return { res, headers, done }
}

describe('api rate limit', () => {
  it('answers 429 with Retry-After once an IP exceeds the per-minute limit', async () => {
    const request = {
      method: 'POST',
      path: '/api/share',
      headers: { 'x-forwarded-for': '203.0.113.7' },
      body: {},
    }

    for (let i = 0; i < 30; i++) {
      const { res, done } = callApi(request)
      await done
      expect(res.status).toHaveBeenCalledWith(400)
    }

    const { res, headers, done } = callApi(request)
    await done
    expect(res.status).toHaveBeenCalledWith(429)
    expect(headers['Retry-After']).toMatch(/^\d+$/)
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'RATE_LIMITED', message: expect.stringContaining('Rate limit exceeded') },
    })
  })
})

describe('extract-sheet split', () => {
  it('extractSheet answers 405 to GET', async () => {
    const { res, done } = callApi(
      { method: 'GET', path: '/', headers: {} },
      extractSheet as unknown as typeof api,
    )
    await done
    expect(res.status).toHaveBeenCalledWith(405)
  })

  it('api no longer serves POST /api/extract-sheet', async () => {
    const { res, done } = callApi({
      method: 'POST',
      path: '/api/extract-sheet',
      headers: {},
      body: {},
    })
    await done
    expect(res.status).toHaveBeenCalledWith(404)
  })
})

describe('client IP header logging', () => {
  const original = process.env.LOG_CLIENT_IP_HEADERS

  afterEach(() => {
    vi.restoreAllMocks()
    if (original === undefined) delete process.env.LOG_CLIENT_IP_HEADERS
    else process.env.LOG_CLIENT_IP_HEADERS = original
  })

  it('logs the client IP headers once on GET /api/health when LOG_CLIENT_IP_HEADERS is 1', async () => {
    process.env.LOG_CLIENT_IP_HEADERS = '1'
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { res, done } = callApi({
      method: 'GET',
      path: '/api/health',
      headers: { 'x-forwarded-for': '198.51.100.7, 35.191.0.1' },
    })
    await done
    expect(res.status).toHaveBeenCalledWith(200)
    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(
      '[client-ip]',
      expect.objectContaining({
        xff: '198.51.100.7, 35.191.0.1',
      }),
    )
  })

  it('does not log on GET /api/health when LOG_CLIENT_IP_HEADERS is unset', async () => {
    delete process.env.LOG_CLIENT_IP_HEADERS
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { res, done } = callApi({
      method: 'GET',
      path: '/api/health',
      headers: { 'x-forwarded-for': '198.51.100.7, 35.191.0.1' },
    })
    await done
    expect(res.status).toHaveBeenCalledWith(200)
    expect(info).not.toHaveBeenCalled()
  })
})
