import { describe, it, expect, vi } from 'vitest'
import type { Request, Response } from 'express'
import { extractSheet } from '../src/index.js'

describe('POST /extractSheet validation', () => {
  it('returns 400 INVALID_FILE_PAYLOAD instead of throwing when files contains null', async () => {
    const res = {
      headersSent: false,
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis(),
      write: vi.fn(),
      flushHeaders: vi.fn(),
    }
    const req = {
      method: 'POST',
      headers: {},
      ip: '127.0.0.1',
      body: { files: [null] },
    }

    await extractSheet(req as unknown as Request, res as unknown as Response)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'INVALID_FILE_PAYLOAD' }),
      }),
    )
  })
})
