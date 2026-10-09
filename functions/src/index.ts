import { setGlobalOptions } from 'firebase-functions/v2'
import { onRequest } from 'firebase-functions/v2/https'
import { handleCors, sendJsonError } from './limits.js'
import { validateUrls, MAX_URLS_PER_REQUEST } from './urls.js'
import { scrapeSingleUrl } from './scraper.js'
import type { Song } from './types.js'

// Cost safeguard: cap concurrent instances (see plan §4.2).
setGlobalOptions({
  region: 'us-central1',
  maxInstances: 3,
  minInstances: 0,
  memory: '256MiB',
  timeoutSeconds: 30,
  concurrency: 5,
})

export type ScrapeResult =
  | { url: string; status: 'ok'; song: Song }
  | { url: string; status: 'error'; code: string; message: string }

export interface ScrapeResponse {
  results: ScrapeResult[]
  invalid: Array<{ input: string; reason: string }>
}

export const api = onRequest(async (req, res) => {
  // Handle CORS and preflight
  if (handleCors(req, res)) {
    return
  }

  // Health check endpoint
  if (req.method === 'GET' && (req.path === '/api/health' || req.path === '/health')) {
    res.status(200).json({ ok: true })
    return
  }

  // Scrape endpoint
  if (req.path === '/api/scrape' || req.path === '/scrape') {
    if (req.method !== 'POST') {
      sendJsonError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed for /api/scrape')
      return
    }

    const { urls } = req.body || {}
    if (!urls || !Array.isArray(urls)) {
      sendJsonError(res, 400, 'BAD_REQUEST', 'Body must contain a "urls" array')
      return
    }

    if (urls.length > MAX_URLS_PER_REQUEST) {
      sendJsonError(
        res,
        400,
        'MAX_URLS_EXCEEDED',
        `Maximum ${MAX_URLS_PER_REQUEST} URLs per request allowed (received ${urls.length})`
      )
      return
    }

    const { valid, invalid } = validateUrls(urls)
    const results: ScrapeResult[] = []

    // Concurrency limit of 2 parallel scrapes
    const concurrency = 2
    for (let i = 0; i < valid.length; i += concurrency) {
      const chunk = valid.slice(i, i + concurrency)
      const chunkPromises = chunk.map(async ({ url }): Promise<ScrapeResult> => {
        try {
          const song = await scrapeSingleUrl(url)
          return { url, status: 'ok', song }
        } catch (err) {
          const errorCode = (err as { code?: string })?.code || 'SCRAPE_FAILED'
          return {
            url,
            status: 'error',
            code: errorCode,
            message: (err as Error).message || 'Failed to extract chords',
          }
        }
      })

      const chunkResults = await Promise.all(chunkPromises)
      results.push(...chunkResults)
    }

    // Set short cache header for scrape responses
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120')
    res.status(200).json({
      results,
      invalid,
    } satisfies ScrapeResponse)
    return
  }

  // 404 for unrouted paths
  sendJsonError(res, 404, 'NOT_FOUND', `Cannot ${req.method} ${req.path}`)
})
