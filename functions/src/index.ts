import { setGlobalOptions } from 'firebase-functions/v2'
import { onRequest } from 'firebase-functions/v2/https'
import { handleCors, sendJsonError } from './limits.js'
import { validateUrls, MAX_URLS_PER_REQUEST } from './urls.js'
import { scrapeSingleUrl } from './scraper.js'
import { rateLimiter } from './rateLimit.js'
import { ultimateGuitarSearchAdapter } from './search/ultimateGuitarSearch.js'
import { pnwChordsSearchAdapter } from './search/pnwChordsSearch.js'
import { worshipTogetherSearchAdapter } from './search/worshipTogetherSearch.js'
import { isSharedSetSnapshot, MAX_SHARED_SET_SONGS, shareStore } from './shareStore.js'
import { extractSongsWithGemini, isExpectedSongCount, type SheetFilePart } from './extractSheet.js'
import type { Song } from './types.js'

// Cost safeguard: cap concurrent instances (see plan §4.2).
setGlobalOptions({
  region: 'us-central1',
  maxInstances: 3,
  minInstances: 0,
  memory: '512MiB',
  // Requests made through Firebase Hosting are limited to 60 seconds, but
  // production extraction calls this HTTPS function directly. Allow enough
  // time for sequential Gemini batches in a multi-page packet.
  timeoutSeconds: 300,
  concurrency: 5,
})

export type ScrapeResult =
  | { url: string; status: 'ok'; song: Song }
  | { url: string; status: 'error'; code: string; message: string }

export interface ScrapeResponse {
  results: ScrapeResult[]
  invalid: Array<{ input: string; reason: string }>
}

export const api = onRequest({ secrets: ['GEMINI_API_KEY'] }, async (req, res) => {
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

  // Immutable Firestore-backed shared set creation: POST /api/share
  if (req.path === '/api/share' || req.path === '/share') {
    if (req.method !== 'POST') {
      sendJsonError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed for /api/share')
      return
    }

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown'
    const limitCheck = rateLimiter.checkIp(clientIp)
    if (!limitCheck.allowed) {
      res.setHeader('Retry-After', String(limitCheck.retryAfterSeconds ?? 60))
      sendJsonError(res, 429, 'RATE_LIMITED', `Rate limit exceeded. Try again in ${limitCheck.retryAfterSeconds}s`)
      return
    }
    const { snapshot } = req.body || {}
    const contentLength = Number(req.headers['content-length'] || 0)
    if (Number.isFinite(contentLength) && contentLength > 9 * 1024 * 1024) {
      sendJsonError(res, 413, 'PAYLOAD_TOO_LARGE', 'Shared set data is too large')
      return
    }
    if (snapshot?.songs?.length > MAX_SHARED_SET_SONGS) {
      sendJsonError(res, 400, 'SONG_LIMIT_EXCEEDED', `Shared sets are limited to ${MAX_SHARED_SET_SONGS} songs`)
      return
    }
    if (!isSharedSetSnapshot(snapshot)) {
      sendJsonError(res, 400, 'BAD_REQUEST', 'Missing or invalid shared set snapshot')
      return
    }
    try {
      const created = await shareStore.create(snapshot)
      res.status(201).json({ id: created.id, expiresAt: created.expiresAt.toISOString() })
    } catch (err) {
      sendJsonError(res, 500, 'SHARE_CREATE_FAILED', (err as Error).message || 'Failed to create sharing link')
    }
    return
  }

  // Shared set lookup: GET /api/share/:id
  const shareMatch = req.path.match(/^\/(?:api\/)?share\/([a-zA-Z0-9_-]+)$/)
  if (shareMatch) {
    if (req.method !== 'GET') {
      sendJsonError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed for /api/share/:id')
      return
    }

    const id = shareMatch[1]
    let result
    try {
      result = await shareStore.get(id)
    } catch (err) {
      sendJsonError(res, 500, 'SHARE_LOOKUP_FAILED', (err as Error).message || 'Failed to retrieve sharing link')
      return
    }
    if (result.kind === 'expired') {
      sendJsonError(res, 410, 'EXPIRED', 'This sharing link has expired')
      return
    }
    if (result.kind === 'missing') {
      sendJsonError(res, 404, 'NOT_FOUND', 'Share link not found')
      return
    }

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600')
    res.status(200).json({ id, snapshot: result.snapshot, expiresAt: result.expiresAt.toISOString() })
    return
  }

  // Extract sheet endpoint: POST /api/extract-sheet
  if (req.path === '/api/extract-sheet' || req.path === '/extract-sheet') {
    if (req.method !== 'POST') {
      sendJsonError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed for /api/extract-sheet')
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

    const { files, apiKey, model, expectedSongCount } = req.body || {}
    if (!files || !Array.isArray(files) || files.length === 0) {
      sendJsonError(res, 400, 'BAD_REQUEST', 'Missing "files" array in request body')
      return
    }

    if (files.length > 10) {
      sendJsonError(res, 400, 'MAX_FILES_EXCEEDED', 'A maximum of 10 pages/images can be extracted at once')
      return
    }

    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
    for (const f of files) {
      if (!f.mimeType || !f.base64Data) {
        sendJsonError(res, 400, 'INVALID_FILE_PAYLOAD', 'Each file must contain "mimeType" and "base64Data"')
        return
      }
      if (!allowed.includes(f.mimeType)) {
        sendJsonError(res, 400, 'UNSUPPORTED_MIME_TYPE', `Unsupported mime type: ${f.mimeType}. Allowed: ${allowed.join(', ')}`)
        return
      }
    }

    if (
      expectedSongCount !== undefined &&
      !isExpectedSongCount(expectedSongCount)
    ) {
      sendJsonError(res, 400, 'INVALID_EXPECTED_SONG_COUNT', 'Expected song count must be a positive whole number')
      return
    }

    try {
      res.status(200)
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.flushHeaders()
      res.write(
        `${JSON.stringify({
          type: 'progress',
          message: 'Analyzing SongSelect sheet(s)...',
          completed: 0,
          total: files.length,
        })}\n`
      )
      const songs = await extractSongsWithGemini(files as SheetFilePart[], apiKey, model, {
        expectedSongCount,
        onProgress: ({ type, expectedSongCount: expected, extractedSongCount: found, batchStartPage, batchEndPage, pageIndex, classification, route, diagnostic }) => {
          const message = type === 'analyzing'
            ? 'Checking PDF text layers...'
            : type === 'page-route'
              ? route === 'deterministic'
                ? `Page ${pageIndex}: selectable text detected — extracting directly.`
                : `Page ${pageIndex}: ${classification === 'image' ? 'image upload' : `${classification} PDF`} — using Gemini${diagnostic ? ` (${diagnostic})` : ''}.`
            : type === 'deterministic'
              ? `Extracting ${batchEndPage} selectable-text PDF page${batchEndPage === 1 ? '' : 's'} directly...`
              : type === 'batch'
                ? `Using Gemini for pages ${batchStartPage}-${batchEndPage}...`
                : type === 'merging'
                  ? 'Merging extracted pages...'
                  : `Found ${found} of ${expected} songs - checking for missing songs...`
          res.write(
            `${JSON.stringify({
              type: 'progress',
              message,
              completed: type === 'batch' ? Math.max(0, (batchStartPage ?? 1) - 1) : 0,
              total: files.length,
            })}\n`
          )
        },
      })
      res.end(`${JSON.stringify({ type: 'result', songs })}\n`)
      return
    } catch (err) {
      const msg = (err as Error).message || 'Extraction failed'
      if (res.headersSent) {
        res.end(`${JSON.stringify({ type: 'error', message: msg })}\n`)
      } else {
        const status = msg.includes('GEMINI_API_KEY is not configured') ? 400 : 500
        sendJsonError(res, status, 'EXTRACTION_FAILED', msg)
      }
      return
    }
  }

  // 404 for unrouted paths
  sendJsonError(res, 404, 'NOT_FOUND', `Cannot ${req.method} ${req.path}`)
})
