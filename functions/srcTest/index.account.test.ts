import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response } from 'express'

const m = vi.hoisted(() => ({
  deleteAccountData: vi.fn(),
  verifyIdToken: vi.fn(),
  deleteUser: vi.fn(),
}))

vi.mock('../src/accountStore.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/accountStore.js')>()
  return { ...actual, accountStore: { deleteAccountData: m.deleteAccountData } }
})

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: m.verifyIdToken, deleteUser: m.deleteUser }),
}))

import { api } from '../src/index.js'

const nowSeconds = () => Math.floor(Date.now() / 1000)

let ipCounter = 0
async function call(
  opts: { method?: string; path?: string; token?: string } = {},
): Promise<{ res: Record<string, ReturnType<typeof vi.fn>> }> {
  const headers: Record<string, string> = {
    'x-forwarded-for': `192.0.2.${(ipCounter++ % 250) + 1}`,
  }
  if (opts.token !== undefined) headers.authorization = `Bearer ${opts.token}`
  const res = {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    end: vi.fn(),
  }
  const req = {
    method: opts.method ?? 'DELETE',
    path: opts.path ?? '/api/account',
    headers,
  }
  await api(req as unknown as Request, res as unknown as Response)
  return { res }
}

describe('DELETE /api/account', () => {
  beforeEach(() => {
    m.deleteAccountData.mockReset()
    m.verifyIdToken.mockReset()
    m.deleteUser.mockReset()
    m.deleteAccountData.mockResolvedValue(undefined)
    m.deleteUser.mockResolvedValue(undefined)
  })

  it('401 without a token or with an invalid one', async () => {
    const missing = await call()
    expect(missing.res.status).toHaveBeenCalledWith(401)
    expect(missing.res.json).toHaveBeenCalledWith({
      error: { code: 'UNAUTHENTICATED', message: expect.any(String) },
    })
    expect(m.deleteAccountData).not.toHaveBeenCalled()

    m.verifyIdToken.mockRejectedValue(new Error('bad token'))
    const invalid = await call({ token: 'bad' })
    expect(invalid.res.status).toHaveBeenCalledWith(401)
    expect(invalid.res.json).toHaveBeenCalledWith({
      error: { code: 'UNAUTHENTICATED', message: expect.any(String) },
    })
    expect(m.deleteAccountData).not.toHaveBeenCalled()
  })

  it('401 REAUTH for a sign-in older than five minutes and deletes nothing', async () => {
    m.verifyIdToken.mockResolvedValue({ uid: 'u1', auth_time: nowSeconds() - 301 })

    const { res } = await call({ token: 'token' })

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'REAUTH', message: expect.any(String) },
    })
    expect(m.deleteAccountData).not.toHaveBeenCalled()
    expect(m.deleteUser).not.toHaveBeenCalled()
  })

  it('deletes the data before the auth user and returns 204', async () => {
    const order: string[] = []
    m.verifyIdToken.mockResolvedValue({ uid: 'u1', auth_time: nowSeconds() - 60 })
    m.deleteAccountData.mockImplementation(async () => {
      order.push('data')
    })
    m.deleteUser.mockImplementation(async () => {
      order.push('auth')
    })

    const { res } = await call({ token: 'token' })
    expect(order).toEqual(['data', 'auth'])
    expect(m.deleteAccountData).toHaveBeenCalledWith('u1')
    expect(m.deleteUser).toHaveBeenCalledWith('u1')
    expect(res.status).toHaveBeenCalledWith(204)
    expect(res.end).toHaveBeenCalled()

    const noPrefix = await call({ token: 'token', path: '/account' })
    expect(noPrefix.res.status).toHaveBeenCalledWith(204)
  })

  it('leaves the auth user when the data delete fails', async () => {
    m.verifyIdToken.mockResolvedValue({ uid: 'u1', auth_time: nowSeconds() - 60 })
    m.deleteAccountData.mockRejectedValue(new Error('boom'))

    const { res } = await call({ token: 'token' })

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'ACCOUNT_DELETE_FAILED', message: 'boom' },
    })
    expect(m.deleteUser).not.toHaveBeenCalled()
  })
})
