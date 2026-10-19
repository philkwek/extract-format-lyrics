import { setGlobalOptions } from 'firebase-functions/v2'
import { onRequest } from 'firebase-functions/v2/https'
import { handleCors, sendJsonError } from './limits.js'
import { checkUrl, validateUrls, MAX_URLS_PER_REQUEST } from './urls.js'
import { scrapeUrls, type ScrapeResult } from './scrapePool.js'
import { loadOfficialSimplification } from './chartSimplification.js'
import { rateLimiter } from './rateLimit.js'
import { ultimateGuitarSearchAdapter } from './search/ultimateGuitarSearch.js'
import { pnwChordsSearchAdapter } from './search/pnwChordsSearch.js'
import { worshipTogetherSearchAdapter } from './search/worshipTogetherSearch.js'
import { searchSites } from './search/searchSites.js'
import { searchCache } from './search/searchCache.js'
import {
  DEFAULT_SEARCH_RESULT_LIMIT,
  PARTIAL_SOURCE_RESULT_LIMIT,
  UG_NATIVE_RESULT_LIMIT,
  selectNativeSourceResults,
  selectSearchResults,
  selectSearchResultsForMode,
  type SearchSelectionMode,
} from './search/selectResults.js'
import { toSourceStatus } from './search/types.js'
import { isSharedSetSnapshot, MAX_SHARED_SET_SONGS, shareStore } from './shareStore.js'
import {
  sharedLyricsStore,
  verifyPublicationSecret,
  isSharedLyricsPayload,
  MAX_SHARED_LYRICS_SONGS,
} from './sharedLyricsStore.js'
import { extractSongsWithGemini, isExpectedSongCount, type SheetFilePart } from './extractSheet.js'
import type { SharedLyricsPayload } from './types.js'
import { elapsedMs, recordTiming } from './metrics.js'


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

/**
 * Temporary experiment switch. `search-v1`/balanced remains the default.
 * Set SEARCH_RESULT_MODE=ug-native to use Ultimate Guitar's own first three
 * accessible results while keeping the balanced selector available.
 */
const SEARCH_RESULT_MODE: SearchSelectionMode =
  process.env.SEARCH_RESULT_MODE === 'ug-native' ? 'ug-native' : 'balanced'

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
    // A continuously filled queue keeps both workers busy instead of waiting
    // for the slowest song in each fixed pair.
    const results: ScrapeResult[] = await scrapeUrls(valid.map((item) => item.url))

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

    const searchStartedAt = Date.now()
    const adapters = [
      ultimateGuitarSearchAdapter,
      pnwChordsSearchAdapter,
      worshipTogetherSearchAdapter,
    ]
    const wantsStream =
      req.query.stream === '1' ||
      String(req.headers.accept || '').includes('application/x-ndjson')

    if (wantsStream) {
      res.status(200)
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('X-Search-Selection', SEARCH_RESULT_MODE)
      res.flushHeaders()

      let closed = false
      // `res` close fires on client disconnect as well as after our own end().
      res.on('close', () => {
        closed = true
      })
      const write = (event: unknown) => {
        if (closed) return
        try {
          res.write(`${JSON.stringify(event)}\n`)
        } catch {
          closed = true
        }
      }

      try {
        const lookup = await searchCache.search(query, async (upstreamQuery) => {
          const { candidates: combined, outcomes } = await searchSites(
            adapters,
            upstreamQuery,
            {},
            (outcome) => {
              // Completed sources become usable immediately, even when another
              // source is still pending.
              const partialCandidates =
                SEARCH_RESULT_MODE === 'ug-native' && outcome.site === 'ultimate-guitar'
                  ? selectNativeSourceResults(outcome.candidates, UG_NATIVE_RESULT_LIMIT)
                  : selectSearchResults(
                      outcome.candidates,
                      upstreamQuery,
                      PARTIAL_SOURCE_RESULT_LIMIT
                    )
              write({
                type: 'source',
                source: toSourceStatus(outcome),
                candidates: partialCandidates,
              })
            }
          )
          return {
            results: selectSearchResultsForMode(
              combined,
              upstreamQuery,
              DEFAULT_SEARCH_RESULT_LIMIT,
              SEARCH_RESULT_MODE
            ),
            sources: outcomes.map(toSourceStatus),
            partial: outcomes.some((outcome) => outcome.status === 'failed'),
          }
        })
        const { results, sources, partial } = lookup.data
        recordTiming({
          operation: 'search.total',
          durationMs: elapsedMs(searchStartedAt),
          outcome: partial ? 'partial' : results.length > 0 ? 'ok' : 'empty',
          cacheStatus: lookup.cacheStatus === 'hit' ? 'hit' : 'miss',
        })
        write({
          type: 'complete',
          query,
          results,
          sources,
          partial,
          cacheStatus: lookup.cacheStatus,
          selectionMode: SEARCH_RESULT_MODE,
        })
        if (!closed) res.end()
      } catch (err) {
        recordTiming({
          operation: 'search.total',
          durationMs: elapsedMs(searchStartedAt),
          outcome: 'error',
        })
        write({
          type: 'error',
          code: 'SEARCH_FAILED',
          message: (err as Error).message || 'Failed to search songs',
        })
        if (!closed) res.end()
      }
      return
    }

    try {
      const lookup = await searchCache.search(query, async (upstreamQuery) => {
        const { candidates: combined, outcomes } = await searchSites(adapters, upstreamQuery)
        return {
          results: selectSearchResultsForMode(
              combined,
              upstreamQuery,
              DEFAULT_SEARCH_RESULT_LIMIT,
              SEARCH_RESULT_MODE
            ),
          sources: outcomes.map(toSourceStatus),
          partial: outcomes.some((outcome) => outcome.status === 'failed'),
        }
      })
      const { results, sources, partial } = lookup.data
      recordTiming({
        operation: 'search.total',
        durationMs: elapsedMs(searchStartedAt),
        outcome: partial ? 'partial' : results.length > 0 ? 'ok' : 'empty',
        cacheStatus: lookup.cacheStatus === 'hit' ? 'hit' : 'miss',
      })

      // A partial response may change when a failed site recovers; do not let a
      // shared HTTP cache keep it for the full complete-response TTL. Complete
      // hits advertise only the freshness that actually remains.
      if (partial) {
        res.setHeader('Cache-Control', 'private, no-store')
      } else {
        const ttlSeconds = Math.max(1, Math.floor((lookup.expiresAt - Date.now()) / 1000))
        res.setHeader('Cache-Control', `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`)
      }
      res.setHeader('X-Search-Cache', lookup.cacheStatus)
      res.setHeader('X-Search-Selection', SEARCH_RESULT_MODE)
      res.status(200).json({
        query,
        results,
        sources,
        partial,
        selectionMode: SEARCH_RESULT_MODE,
      })
      return
    } catch (err) {
      recordTiming({
        operation: 'search.total',
        durationMs: elapsedMs(searchStartedAt),
        outcome: 'error',
      })
      sendJsonError(res, 500, 'SEARCH_FAILED', (err as Error).message || 'Failed to search songs')
      return
    }
  }

  // Optional official simplification: POST /api/simplify
  // Kept separate so the original chart is never delayed by this request.
  if (req.path === '/api/simplify' || req.path === '/simplify') {
    if (req.method !== 'POST') {
      sendJsonError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed for /api/simplify')
      return
    }

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown'
    const limitCheck = rateLimiter.checkIp(clientIp)
    if (!limitCheck.allowed) {
      res.setHeader('Retry-After', String(limitCheck.retryAfterSeconds ?? 60))
      sendJsonError(res, 429, 'RATE_LIMITED', `Rate limit exceeded. Try again in ${limitCheck.retryAfterSeconds}s`)
      return
    }

    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : ''
    const checked = checkUrl(url)
    if (!url || !checked.ok) {
      sendJsonError(res, 400, 'INVALID_URL', checked.ok ? 'Missing "url" body field' : checked.reason)
      return
    }

    try {
      const result = await loadOfficialSimplification(checked.url)
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json(result)
      return
    } catch (err) {
      const code = (err as { code?: string })?.code
      if (code === 'INVALID_URL') {
        sendJsonError(res, 400, 'INVALID_URL', (err as Error).message)
        return
      }
      // Enrichment is optional: the original chart remains usable.
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({
        status: 'unavailable',
        code: code ?? 'SIMPLIFICATION_FAILED',
        message: (err as Error).message || 'Could not load the official simplified chart',
      })
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

  // Lyrics share endpoints: PUT /api/lyrics-share/:id and GET /api/lyrics-share/:id
  const lyricsShareMatch = req.path.match(/^\/(?:api\/)?lyrics-share\/([a-zA-Z0-9_-]+)$/)
  if (lyricsShareMatch) {
    const id = lyricsShareMatch[1]

    if (req.method === 'PUT') {
      const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown'
      const limitCheck = rateLimiter.checkIp(clientIp)
      if (!limitCheck.allowed) {
        res.setHeader('Retry-After', String(limitCheck.retryAfterSeconds ?? 60))
        sendJsonError(res, 429, 'RATE_LIMITED', `Rate limit exceeded. Try again in ${limitCheck.retryAfterSeconds}s`)
        return
      }

      const contentLength = Number(req.headers['content-length'] || 0)
      if (Number.isFinite(contentLength) && contentLength > 9 * 1024 * 1024) {
        sendJsonError(res, 413, 'PAYLOAD_TOO_LARGE', 'Shared lyrics data is too large')
        return
      }

      const authHeader = (req.headers['authorization'] as string) || ''
      const secret = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim()
      if (!secret) {
        sendJsonError(res, 401, 'UNAUTHORIZED', 'Missing authorization secret')
        return
      }

      if (!verifyPublicationSecret(secret, id)) {
        sendJsonError(res, 403, 'FORBIDDEN', 'Invalid authorization secret for this publication')
        return
      }

      const payload = (req.body?.payload ?? req.body) as SharedLyricsPayload
      if (!isSharedLyricsPayload(payload)) {
        sendJsonError(res, 400, 'BAD_REQUEST', 'Missing or invalid shared lyrics payload')
        return
      }

      if (payload.songs.length > MAX_SHARED_LYRICS_SONGS) {
        sendJsonError(res, 400, 'SONG_LIMIT_EXCEEDED', `Shared lyrics are limited to ${MAX_SHARED_LYRICS_SONGS} songs`)
        return
      }

      try {
        const result = await sharedLyricsStore.publish(id, payload)
        res.status(200).json({ id: result.id, expiresAt: result.expiresAt.toISOString() })
      } catch (err) {
        sendJsonError(res, 500, 'LYRICS_SHARE_FAILED', (err as Error).message || 'Failed to save lyrics publication')
      }
      return
    }

    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store')
      let result
      try {
        result = await sharedLyricsStore.get(id)
      } catch (err) {
        sendJsonError(res, 500, 'LYRICS_LOOKUP_FAILED', (err as Error).message || 'Failed to retrieve shared lyrics')
        return
      }

      if (result.kind === 'expired') {
        sendJsonError(res, 410, 'EXPIRED', 'This lyrics share link has expired')
        return
      }

      if (result.kind === 'missing') {
        sendJsonError(res, 404, 'NOT_FOUND', 'Lyrics share not found')
        return
      }

      res.status(200).json({ id, lyrics: result.lyrics, expiresAt: result.expiresAt.toISOString() })
      return
    }

    sendJsonError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET and PUT are allowed for /api/lyrics-share/:id')
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
