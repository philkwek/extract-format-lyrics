import { setGlobalOptions } from 'firebase-functions/v2'
import { onRequest } from 'firebase-functions/v2/https'
import { handleCors, sendJsonError } from './limits.js'
import { validateUrls, MAX_URLS_PER_REQUEST } from './urls.js'
import { scrapeSingleUrl } from './scraper.js'
import { rateLimiter } from './rateLimit.js'
import { ultimateGuitarSearchAdapter } from './search/ultimateGuitarSearch.js'
import { pnwChordsSearchAdapter } from './search/pnwChordsSearch.js'
import { worshipTogetherSearchAdapter } from './search/worshipTogetherSearch.js'
import { shortLinkStore } from './shortLinkStore.js'
import type { Song, SharePayload } from './types.js'

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

    // IP Rate limit check
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown'
    const limitCheck = rateLimiter.checkIp(clientIp)
    if (!limitCheck.allowed) {
      res.setHeader('Retry-After', String(limitCheck.retryAfterSeconds ?? 60))
      sendJsonError(
        res,
        429,
        'RATE_LIMITED',
        `Rate limit exceeded. Try again in ${limitCheck.retryAfterSeconds}s`
      )
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
        const host = new URL(url).hostname
        const pausedCheck = rateLimiter.isHostPaused(host)
        if (pausedCheck.paused) {
          return {
            url,
            status: 'error',
            code: 'HOST_PAUSED',
            message: `Requests to ${host} temporarily paused due to repeated upstream errors. Try again later.`,
          }
        }

        try {
          const song = await scrapeSingleUrl(url)
          rateLimiter.recordHostSuccess(host)
          return { url, status: 'ok', song }
        } catch (err) {
          const status = (err as { status?: number })?.status
          rateLimiter.recordHostFailure(host, status)
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

  // Search endpoint: GET /api/search?q=
  if (req.path === '/api/search' || req.path === '/search') {
    if (req.method !== 'GET') {
      sendJsonError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed for /api/search')
      return
    }

    const query = String(req.query.q || '').trim()
    if (!query) {
      sendJsonError(res, 400, 'BAD_REQUEST', 'Missing "q" search query parameter')
      return
    }

    // IP Rate limit check
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown'
    const limitCheck = rateLimiter.checkIp(clientIp)
    if (!limitCheck.allowed) {
      res.setHeader('Retry-After', String(limitCheck.retryAfterSeconds ?? 60))
      sendJsonError(
        res,
        429,
        'RATE_LIMITED',
        `Rate limit exceeded. Try again in ${limitCheck.retryAfterSeconds}s`
      )
      return
    }

    try {
      const ugResults = await ultimateGuitarSearchAdapter.search(query)
      const pnwResults = await pnwChordsSearchAdapter.search(query)
      const wtResults = await worshipTogetherSearchAdapter.search(query)

      const combined = [...ugResults, ...pnwResults, ...wtResults]
      // Rank by rating (if present) and limit to top 8 candidates
      combined.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      const candidates = combined.slice(0, 8)

      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600')
      res.status(200).json({ query, results: candidates })
      return
    } catch (err) {
      sendJsonError(res, 500, 'SEARCH_FAILED', (err as Error).message || 'Failed to search songs')
      return
    }
  }

  // Short link creation: POST /api/share
  if (req.path === '/api/share' || req.path === '/share') {
    if (req.method !== 'POST') {
      sendJsonError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed for /api/share')
      return
    }

    const { payload } = req.body || {}
    if (!payload || !payload.name || !Array.isArray(payload.songs)) {
      sendJsonError(res, 400, 'BAD_REQUEST', 'Missing valid "payload" object with name and songs')
      return
    }

    const id = shortLinkStore.save(payload as SharePayload)
    res.status(200).json({ id })
    return
  }

  // Short link lookup: GET /api/share/:id
  const shareMatch = req.path.match(/^\/(?:api\/)?share\/([a-zA-Z0-9_-]+)$/)
  if (shareMatch) {
    if (req.method !== 'GET') {
      sendJsonError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed for /api/share/:id')
      return
    }

    const id = shareMatch[1]
    const payload = shortLinkStore.get(id)
    if (!payload) {
      sendJsonError(res, 404, 'NOT_FOUND', 'Share link not found or expired')
      return
    }

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600')
    res.status(200).json({ id, payload })
    return
  }

  // 404 for unrouted paths
  sendJsonError(res, 404, 'NOT_FOUND', `Cannot ${req.method} ${req.path}`)
})
