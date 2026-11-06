import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response } from 'express'

const m = vi.hoisted(() => ({ publish: vi.fn(), putSong: vi.fn(), stop: vi.fn(), get: vi.fn() }))
vi.mock('../src/liveSetStore.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/liveSetStore.js')>()
  return { ...actual, liveSetStore: m }
})

import { api } from '../src/index.js'
import { deriveLiveSetId, LiveSetError, LiveSetThrottledError } from '../src/liveSetStore.js'

const secret = 'e'.repeat(64)
const id = deriveLiveSetId(secret)
const hash = 'a'.repeat(64)
const manifest = { v: 1, name: 'Set', entries: [{ entryId: 'e', contentHash: hash }] }
const body = { manifest }
const auth = { authorization: `Bearer ${secret}` }

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
    path: opts.path ?? `/api/live-set/${id}`,
    headers: { 'x-forwarded-for': `203.0.113.${(ipCounter++ % 250) + 1}`, ...opts.headers },
    body: opts.body,
  }
  await api(req as unknown as Request, res as unknown as Response)
  return { res, headers }
}
const songPath = `/api/live-set/${id}/song/${hash}`

describe('live-set manifest routes', () => {
  beforeEach(() => Object.values(m).forEach((fn) => fn.mockReset()))

  it('PUT 401 without secret, 403 with wrong secret, also without the /api prefix', async () => {
    expect((await call('PUT', { body })).res.status).toHaveBeenCalledWith(401)
    expect((await call('PUT', { body, headers: { authorization: 'Bearer nope' } })).res.status).toHaveBeenCalledWith(403)
    m.publish.mockResolvedValue({ id, rev: 1, expiresAt: new Date('2026-01-08T00:00:00Z'), unchanged: false })
    expect((await call('PUT', { body, headers: auth, path: `/live-set/${id}` })).res.status).toHaveBeenCalledWith(200)
  })

  it('PUT 413 on oversized content-length', async () => {
    const { res } = await call('PUT', { body, headers: { ...auth, 'content-length': String(65 * 1024) } })
    expect(res.status).toHaveBeenCalledWith(413)
  })

  it('PUT 400 for an invalid manifest and the song limit', async () => {
    expect((await call('PUT', { body: { manifest: { v: 1, name: 'x', entries: [{ entryId: 'e', contentHash: 'bad' }] } }, headers: auth })).res.status).toHaveBeenCalledWith(400)
    const entries = Array.from({ length: 31 }, () => manifest.entries[0])
    const { res } = await call('PUT', { body: { manifest: { ...manifest, entries } }, headers: auth })
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'SONG_LIMIT_EXCEEDED', message: expect.any(String) } })
  })

  it('PUT 200 on success', async () => {
    m.publish.mockResolvedValue({ id, rev: 4, expiresAt: new Date('2026-01-08T00:00:00Z'), unchanged: true })
    const { res } = await call('PUT', { body, headers: auth })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ id, rev: 4, expiresAt: '2026-01-08T00:00:00.000Z', unchanged: true })
  })

  it('PUT 409 lists missing content, 410 when stopped, 429 with Retry-After, 500 on failure', async () => {
    m.publish.mockRejectedValueOnce(new LiveSetError(409, 'MISSING_CONTENT', 'missing', { missing: [hash] }))
    const missing = await call('PUT', { body, headers: auth })
    expect(missing.res.status).toHaveBeenCalledWith(409)
    expect(missing.res.json).toHaveBeenCalledWith({ error: { code: 'MISSING_CONTENT', message: 'missing', missing: [hash] } })
    m.publish.mockRejectedValueOnce(new LiveSetError(410, 'STOPPED', 'stopped'))
    expect((await call('PUT', { body, headers: auth })).res.status).toHaveBeenCalledWith(410)
    m.publish.mockRejectedValueOnce(new LiveSetThrottledError(3))
    const throttled = await call('PUT', { body, headers: auth })
    expect(throttled.res.status).toHaveBeenCalledWith(429)
    expect(throttled.headers['Retry-After']).toBe('3')
    m.publish.mockRejectedValueOnce(new Error('boom'))
    const failed = await call('PUT', { body, headers: auth })
    expect(failed.res.status).toHaveBeenCalledWith(500)
    expect(failed.res.json).toHaveBeenCalledWith({ error: { code: 'LIVE_SET_SAVE_FAILED', message: 'boom' } })
  })

  it('DELETE needs the secret and stops the share', async () => {
    expect((await call('DELETE')).res.status).toHaveBeenCalledWith(401)
    expect((await call('DELETE', { headers: { authorization: 'Bearer nope' } })).res.status).toHaveBeenCalledWith(403)
    m.stop.mockResolvedValue({ id, rev: 5 })
    const { res } = await call('DELETE', { headers: auth })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ id, rev: 5, status: 'stopped' })
  })

  it('GET 200 / 404 / 410 / 500 with no-store', async () => {
    const found = { kind: 'found', manifest: { ...manifest, status: 'live', rev: 1 }, contents: { [hash]: { song: {} } }, expiresAt: new Date('2026-01-08T00:00:00Z') }
    m.get.mockResolvedValueOnce(found)
    const ok = await call('GET')
    expect(ok.res.status).toHaveBeenCalledWith(200)
    expect(ok.headers['Cache-Control']).toBe('no-store')
    expect(ok.res.json).toHaveBeenCalledWith({ id, manifest: found.manifest, contents: found.contents, expiresAt: '2026-01-08T00:00:00.000Z' })
    m.get.mockResolvedValueOnce({ kind: 'missing' })
    expect((await call('GET')).res.status).toHaveBeenCalledWith(404)
    m.get.mockResolvedValueOnce({ kind: 'expired' })
    expect((await call('GET')).res.status).toHaveBeenCalledWith(410)
    m.get.mockRejectedValueOnce(new Error('x'))
    expect((await call('GET')).res.json).toHaveBeenCalledWith({ error: { code: 'LIVE_SET_LOOKUP_FAILED', message: 'x' } })
  })

  it('other methods 405; malformed id falls through to 404', async () => {
    expect((await call('POST')).res.status).toHaveBeenCalledWith(405)
    expect((await call('GET', { path: '/api/live-set/short' })).res.status).toHaveBeenCalledWith(404)
  })
})

describe('live-set song routes', () => {
  beforeEach(() => Object.values(m).forEach((fn) => fn.mockReset()))
  const content = { song: { id: 's' } }

  it('PUT 401 / 403 / 413', async () => {
    expect((await call('PUT', { path: songPath, body: { content } })).res.status).toHaveBeenCalledWith(401)
    expect((await call('PUT', { path: songPath, body: { content }, headers: { authorization: 'Bearer nope' } })).res.status).toHaveBeenCalledWith(403)
    const big = await call('PUT', { path: songPath, body: { content }, headers: { ...auth, 'content-length': String(300 * 1024) } })
    expect(big.res.status).toHaveBeenCalledWith(413)
  })

  it('PUT 200 passes the content to the store', async () => {
    m.putSong.mockResolvedValue({ created: true, expiresAt: new Date('2026-01-08T00:00:00Z') })
    const { res } = await call('PUT', { path: songPath, body: { content }, headers: auth })
    expect(m.putSong).toHaveBeenCalledWith(id, hash, content)
    expect(res.json).toHaveBeenCalledWith({ id, hash, created: true, expiresAt: '2026-01-08T00:00:00.000Z' })
  })

  it('PUT maps store errors: 400 mismatch, 410 stopped, 429 throttled', async () => {
    m.putSong.mockRejectedValueOnce(new LiveSetError(400, 'HASH_MISMATCH', 'no'))
    expect((await call('PUT', { path: songPath, body: { content }, headers: auth })).res.status).toHaveBeenCalledWith(400)
    m.putSong.mockRejectedValueOnce(new LiveSetError(410, 'STOPPED', 'no'))
    expect((await call('PUT', { path: songPath, body: { content }, headers: auth })).res.status).toHaveBeenCalledWith(410)
    m.putSong.mockRejectedValueOnce(new LiveSetThrottledError(9))
    const throttled = await call('PUT', { path: songPath, body: { content }, headers: auth })
    expect(throttled.res.status).toHaveBeenCalledWith(429)
    expect(throttled.headers['Retry-After']).toBe('9')
  })

  it('other methods 405; a hash that is not 64 lowercase hex falls through to 404', async () => {
    expect((await call('GET', { path: songPath })).res.status).toHaveBeenCalledWith(405)
    expect((await call('PUT', { path: `/api/live-set/${id}/song/${'A'.repeat(64)}`, headers: auth })).res.status).toHaveBeenCalledWith(404)
  })
})
