import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response } from 'express'

const { setCurrent } = vi.hoisted(() => ({ setCurrent: vi.fn() }))
vi.mock('../src/sharedLyricsStore.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/sharedLyricsStore.js')>()
  return { ...actual, sharedLyricsStore: { setCurrent } }
})

import { api } from '../src/index.js'
import { derivePublicationId } from '../src/sharedLyricsStore.js'

const secret = 'd'.repeat(64)
const id = derivePublicationId(secret)
const limitSecret = 'e'.repeat(64)
const limitId = derivePublicationId(limitSecret)

async function call(
  method: string,
  opts: { path?: string; headers?: Record<string, string>; body?: unknown } = {},
) {
  const headers: Record<string, string> = {}
  const res = {
    setHeader: vi.fn((n: string, v: string) => {
      headers[n] = v
    }),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  }
  const req = {
    method,
    path: opts.path ?? `/api/lyrics-share/${id}/current`,
    headers: { 'x-forwarded-for': '198.51.100.10', ...opts.headers },
    body: opts.body,
  }
  await api(req as unknown as Request, res as unknown as Response)
  return { res, headers }
}
const auth = { authorization: `Bearer ${secret}` }
const body = { entryId: 'entry_abc123' }

describe('lyrics current-song route', () => {
  beforeEach(() => {
    setCurrent.mockReset()
  })

  it('401 without a secret, 403 with the wrong secret', async () => {
    expect((await call('PUT', { body })).res.status).toHaveBeenCalledWith(401)
    expect(
      (await call('PUT', { body, headers: { authorization: 'Bearer nope' } })).res.status,
    ).toHaveBeenCalledWith(403)
  })

  it('400 for a missing or unsafe entryId', async () => {
    for (const entryId of [undefined, '', 'x'.repeat(65), 'bad id!']) {
      const { res } = await call('PUT', { body: { entryId }, headers: auth })
      expect(res.status).toHaveBeenCalledWith(400)
    }
  })

  it('404 missing, 410 expired, 200 ok', async () => {
    setCurrent.mockResolvedValueOnce('missing')
    expect((await call('PUT', { body, headers: auth })).res.status).toHaveBeenCalledWith(404)
    setCurrent.mockResolvedValueOnce('expired')
    expect((await call('PUT', { body, headers: auth })).res.status).toHaveBeenCalledWith(410)
    setCurrent.mockResolvedValueOnce('ok')
    const ok = await call('PUT', { body, headers: auth })
    expect(ok.res.status).toHaveBeenCalledWith(200)
    expect(ok.res.json).toHaveBeenCalledWith({ ok: true })
  })

  it('accepts the path without the /api prefix', async () => {
    setCurrent.mockResolvedValueOnce('ok')
    const { res } = await call('PUT', {
      path: `/lyrics-share/${id}/current`,
      body,
      headers: auth,
    })
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('429 with Retry-After after 120 writes for one publication', async () => {
    setCurrent.mockResolvedValue('ok')
    const limitAuth = { authorization: `Bearer ${limitSecret}` }
    const path = `/api/lyrics-share/${limitId}/current`

    for (let i = 0; i < 120; i++) {
      const { res } = await call('PUT', { path, body, headers: limitAuth })
      expect(res.status).toHaveBeenCalledWith(200)
    }

    const limited = await call('PUT', { path, body, headers: limitAuth })
    expect(limited.res.status).toHaveBeenCalledWith(429)
    expect(Number(limited.headers['Retry-After'])).toBeGreaterThan(0)
  })

  it('405 for other methods', async () => {
    expect((await call('GET', { headers: auth })).res.status).toHaveBeenCalledWith(405)
    expect((await call('DELETE', { headers: auth })).res.status).toHaveBeenCalledWith(405)
  })
})
