import { setGlobalOptions } from 'firebase-functions/v2'
import { onRequest } from 'firebase-functions/v2/https'

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
  res.status(404).json({ error: 'Not found' })
})
