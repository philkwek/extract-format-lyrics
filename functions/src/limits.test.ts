import { describe, it, expect, vi } from 'vitest'
import type { Request, Response } from 'express'
import { handleCors, sendJsonError } from './limits.js'

describe('handleCors', () => {
  it('handles OPTIONS preflight and sets status 204', () => {
    const req = {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5173' },
    } as unknown as Request

    const setHeader = vi.fn()
    const status = vi.fn().mockReturnThis()
    const end = vi.fn()
    const res = { setHeader, status, end } as unknown as Response

    const handled = handleCors(req, res)
    expect(handled).toBe(true)
    expect(setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://localhost:5173')
    expect(status).toHaveBeenCalledWith(204)
    expect(end).toHaveBeenCalled()
  })

  it('allows Firebase Hosting origins', () => {
    const req = {
      method: 'GET',
      headers: { origin: 'https://my-app.web.app' },
    } as unknown as Request

    const setHeader = vi.fn()
    const res = { setHeader } as unknown as Response

    const handled = handleCors(req, res)
    expect(handled).toBe(false)
    expect(setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://my-app.web.app')
  })

  it('does not set Access-Control-Allow-Origin for unknown untrusted origins', () => {
    const req = {
      method: 'GET',
      headers: { origin: 'https://malicious-site.com' },
    } as unknown as Request

    const setHeader = vi.fn()
    const res = { setHeader } as unknown as Response

    handleCors(req, res)
    expect(setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://malicious-site.com')
  })
})

describe('sendJsonError', () => {
  it('formats standardized error payload', () => {
    const status = vi.fn().mockReturnThis()
    const json = vi.fn()
    const res = { status, json } as unknown as Response

    sendJsonError(res, 400, 'BAD_REQUEST', 'Missing urls field')
    expect(status).toHaveBeenCalledWith(400)
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'BAD_REQUEST',
        message: 'Missing urls field',
      },
    })
  })
})
