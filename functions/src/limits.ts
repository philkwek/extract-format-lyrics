import type { Request, Response } from 'express'

export interface CorsOptions {
  allowedOrigins?: string[]
}

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5000',
]

export function handleCors(req: Request, res: Response, options: CorsOptions = {}): boolean {
  const origin = req.headers.origin
  const allowed = options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS

  if (origin) {
    const isAllowed =
      allowed.includes(origin) ||
      origin.endsWith('.web.app') ||
      origin.endsWith('.firebaseapp.com')

    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true
  }

  return false
}

export function sendJsonError(
  res: Response,
  status: number,
  code: string,
  message: string
): void {
  res.status(status).json({
    error: {
      code,
      message,
    },
  })
}
