import { setGlobalOptions } from 'firebase-functions/v2'
import { onRequest } from 'firebase-functions/v2/https'
import { handleCors, sendJsonError } from './limits.js'

// Cost safeguard: cap concurrent instances (see plan §4.2).
setGlobalOptions({
  region: 'us-central1',
  maxInstances: 3,
  minInstances: 0,
  memory: '256MiB',
  timeoutSeconds: 30,
  concurrency: 5,
})

export const api = onRequest((req, res) => {
  // Handle CORS and preflight
  if (handleCors(req, res)) {
    return
  }

  // Health check endpoint
  if (req.method === 'GET' && (req.path === '/api/health' || req.path === '/health')) {
    res.status(200).json({ ok: true })
    return
  }

  // 404 for unrouted paths
  sendJsonError(res, 404, 'NOT_FOUND', `Cannot ${req.method} ${req.path}`)
})
