import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response } from 'express'

const { publish, get } = vi.hoisted(() => ({ publish: vi.fn(), get: vi.fn() }))
vi.mock('../src/setLinkStore.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/setLinkStore.js')>()
  return { ...actual, setLinkStore: { publish, get } }
})

import { api } from '../src/index.js'
import { derivePublicId, SetLinkThrottledError } from '../src/setLinkStore.js'

const secret = 'c'.repeat(64)
const id = derivePublicId(secret)
const body = { payload: { v: 1, name: 'Set', songs: [{ entryId: 'e', url: 'https://a.example.com/x' }] } }

let ipCounter = 0
async function call(method: string, opts: { path?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  const res = {
    setHeader: vi.fn((n: string, v: string) => { headers[n] = v }),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  }
  const req = {
    method,
    path: opts.path ?? `/api/set-link/${id}`,
    headers: { 'x-forwarded-for': `198.51.100.${(ipCounter++ % 250) + 1}`, ...opts.headers },
    body: opts.body,
  }
  await api(req as unknown as Request, res as unknown as Response)
  return { res, headers }
}
const auth = { authorization: `Bearer ${secret}` }

describe('set-link routes', () => {
  beforeEach(() => { publish.mockReset(); get.mockReset() })

  it('PUT 401 without secret, 403 with wrong secret', async () => {
    expect((await call('PUT', { body })).res.status).toHaveBeenCalledWith(401)
    expect((await call('PUT', { body, headers: { authorization: 'Bearer nope' } })).res.status).toHaveBeenCalledWith(403)
  })

  it('PUT 413 on oversized content-length', async () => {
    const { res } = await call('PUT', { body, headers: { ...auth, 'content-length': String(65 * 1024) } })
    expect(res.status).toHaveBeenCalledWith(413)
  })

  it('PUT 400 for invalid payload and song limit', async () => {
    expect((await call('PUT', { body: { payload: { v: 1, name: 'x', songs: [{ entryId: 'e', url: 'upload://x' }] } }, headers: auth })).res.status).toHaveBeenCalledWith(400)
    const songs = Array.from({ length: 31 }, () => ({ entryId: 'e', url: 'https://a.example.com/x' }))
    const { res } = await call('PUT', { body: { payload: { v: 1, name: 'x', songs } }, headers: auth })
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'SONG_LIMIT_EXCEEDED', message: expect.any(String) } })
  })

  it('PUT 200 on success', async () => {
    publish.mockResolvedValue({ id, expiresAt: new Date('2026-01-08T00:00:00Z'), unchanged: false })
    const { res } = await call('PUT', { body, headers: auth })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ id, expiresAt: '2026-01-08T00:00:00.000Z', unchanged: false })
  })

  it('PUT 429 with Retry-After when throttled, 500 on storage failure', async () => {
    publish.mockRejectedValueOnce(new SetLinkThrottledError(3))
    const throttled = await call('PUT', { body, headers: auth })
    expect(throttled.res.status).toHaveBeenCalledWith(429)
    expect(throttled.headers['Retry-After']).toBe('3')
    publish.mockRejectedValueOnce(new Error('boom'))
    const failed = await call('PUT', { body, headers: auth })
    expect(failed.res.status).toHaveBeenCalledWith(500)
    expect(failed.res.json).toHaveBeenCalledWith({ error: { code: 'SET_LINK_SAVE_FAILED', message: 'boom' } })
  })

  it('GET 200 / 404 / 410 / 500', async () => {
    get.mockResolvedValueOnce({ kind: 'found', payload: body.payload, expiresAt: new Date('2026-01-08T00:00:00Z') })
    const ok = await call('GET')
    expect(ok.res.status).toHaveBeenCalledWith(200)
    expect(ok.headers['Cache-Control']).toBe('no-store')
    expect(ok.res.json).toHaveBeenCalledWith({ id, payload: body.payload, expiresAt: '2026-01-08T00:00:00.000Z' })
    get.mockResolvedValueOnce({ kind: 'missing' })
    expect((await call('GET')).res.status).toHaveBeenCalledWith(404)
    get.mockResolvedValueOnce({ kind: 'expired' })
    expect((await call('GET')).res.status).toHaveBeenCalledWith(410)
    get.mockRejectedValueOnce(new Error('x'))
    const failed = await call('GET')
    expect(failed.res.json).toHaveBeenCalledWith({ error: { code: 'SET_LINK_LOOKUP_FAILED', message: 'x' } })
  })

  it('other methods 405; malformed id falls through to 404', async () => {
    expect((await call('DELETE')).res.status).toHaveBeenCalledWith(405)
    expect((await call('GET', { path: '/api/set-link/short' })).res.status).toHaveBeenCalledWith(404)
  })
})
