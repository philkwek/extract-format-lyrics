import type { Section, Song } from '../types/song'
import {
  PARTIAL_SOURCE_RESULT_LIMIT,
  selectCombinedSearchResults,
  selectNativeSourceResults,
  selectSearchResults,
} from '../../functions/src/search/selectResults'
import { SEARCH_SITES, UG_SEARCH_RESULT_LIMIT } from '../../functions/src/search/types'

export type ScrapeStatus = 'ok' | 'error'

export interface ApiScrapeResult {
  url: string
  status: ScrapeStatus
  song?: Song
  code?: string
  message?: string
}

export interface ApiScrapeResponse {
  results: ApiScrapeResult[]
  invalid: Array<{ input: string; reason: string }>
}

/**
 * Calls the POST /api/scrape backend endpoint with an array of URLs.
 */
export async function scrapeApi(urls: string[]): Promise<ApiScrapeResponse> {
  const res = await fetch('/api/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ urls }),
  })

  if (!res.ok) {
    let errMsg = `Server returned status ${res.status}`
    try {
      const data = await res.json()
      if (data?.error?.message) {
        errMsg = data.error.message
      }
    } catch {
      // ignore JSON parse error
    }
    throw new Error(errMsg)
  }

  return (await res.json()) as ApiScrapeResponse
}

export interface SearchCandidate {
  site: string
  title: string
  artist: string
  url: string
  versionLabel?: string
  rating?: number
  type?: string
}

export interface SearchSourceStatus {
  site: string
  status: 'ok' | 'empty' | 'failed'
  count: number
  durationMs: number
  failure?: 'timeout' | 'blocked' | 'fetch' | 'parser'
  message?: string
}

export interface ApiSearchResponse {
  query: string
  results: SearchCandidate[]
  sources?: SearchSourceStatus[]
  partial?: boolean
}

export interface PartialSearchSource extends SearchSourceStatus {
  candidates: SearchCandidate[]
}

export interface SearchStreamOptions {
  signal?: AbortSignal
  onSource?: (source: PartialSearchSource) => void
}

async function searchError(res: Response): Promise<Error> {
  let message = `Search failed (${res.status})`
  try {
    const data = await res.json()
    if (data?.error?.message) message = data.error.message
  } catch {
    // Preserve the HTTP fallback.
  }
  return new Error(message)
}

/**
 * Asks for every source at once, one request each, and reports each source as
 * it answers. A slow or failed source never holds back the others.
 */
export async function searchApiStream(
  query: string,
  options: SearchStreamOptions = {},
): Promise<ApiSearchResponse> {
  const errors: Error[] = []
  const settled = await Promise.all(
    SEARCH_SITES.map(async (site) => {
      let source: SearchSourceStatus
      let candidates: SearchCandidate[] = []
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&site=${site}`, {
          signal: options.signal,
        })
        if (!res.ok) throw await searchError(res)
        const data = (await res.json()) as ApiSearchResponse
        candidates = data.results ?? []
        source = data.sources?.[0] ?? {
          site,
          status: candidates.length > 0 ? 'ok' : 'empty',
          count: candidates.length,
          durationMs: 0,
        }
      } catch (err) {
        if (options.signal?.aborted) throw err
        errors.push(err as Error)
        source = {
          site,
          status: 'failed',
          count: 0,
          durationMs: 0,
          failure: 'fetch',
          message: (err as Error).message,
        }
      }
      options.onSource?.({
        ...source,
        candidates:
          site === 'ultimate-guitar'
            ? selectNativeSourceResults(candidates, UG_SEARCH_RESULT_LIMIT, query)
            : selectSearchResults(candidates, query, PARTIAL_SOURCE_RESULT_LIMIT),
      })
      return { source, candidates }
    }),
  )
  // Nothing reached the server (offline, rate limited): report that, not four dead sources.
  if (errors.length === settled.length) throw errors[0]

  return {
    query,
    results: selectCombinedSearchResults(
      settled.flatMap((item) => item.candidates),
      query,
    ),
    sources: settled.map((item) => item.source),
    partial: settled.some((item) => item.source.status === 'failed'),
  }
}

export type SimplifyResponse =
  | {
      status: 'ok'
      simplifiedSections: Section[]
      simplifiedFlow?: number[]
      simplifiedSource: 'official'
      cached?: boolean
    }
  | {
      status: 'unavailable'
      code?: string
      message?: string
      cached?: boolean
    }

export async function simplifyApi(url: string, signal?: AbortSignal): Promise<SimplifyResponse> {
  const res = await fetch('/api/simplify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  })
  if (!res.ok) {
    let message = `Simplification failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error?.message) message = data.error.message
    } catch {
      // Preserve the HTTP fallback.
    }
    throw new Error(message)
  }
  return (await res.json()) as SimplifyResponse
}

export class ShareApiError extends Error {
  readonly code?: string
  readonly status?: number
  /** Seconds from a Retry-After header, when the server sent one. */
  readonly retryAfterSeconds?: number

  constructor(message: string, code?: string, status?: number, retryAfterSeconds?: number) {
    super(message)
    this.code = code
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

async function readShareError(res: Response): Promise<ShareApiError> {
  let code: string | undefined
  let message = `Share link request failed (${res.status})`
  try {
    const data = await res.json()
    code = data?.error?.code
    message = data?.error?.message || message
  } catch {
    // Preserve the HTTP fallback.
  }
  const retryAfter = Number(res.headers?.get?.('Retry-After'))
  const retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : undefined
  return new ShareApiError(message, code, res.status, retryAfterSeconds)
}

export async function getShareApi(id: string): Promise<import('../types/song').SharedSetSnapshot> {
  const res = await fetch(`/api/share/${encodeURIComponent(id)}`)
  if (!res.ok) {
    throw await readShareError(res)
  }
  const data = await res.json()
  return data.snapshot
}

export interface PutSharedLyricsResult {
  id: string
  expiresAt: string
}

export interface GetSharedLyricsResult {
  id: string
  lyrics: import('../types/song').SharedLyricsPayload
  expiresAt: string
  /** The host's open song, when they are sending it. */
  currentEntryId?: string | null
}

export async function putSharedLyricsApi(
  id: string,
  secret: string,
  payload: import('../types/song').SharedLyricsPayload,
  options: { keepalive?: boolean } = {},
): Promise<PutSharedLyricsResult> {
  const res = await fetch(`/api/lyrics-share/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ payload }),
    ...(options.keepalive ? { keepalive: true } : {}),
  })
  if (!res.ok) {
    throw await readShareError(res)
  }
  return (await res.json()) as PutSharedLyricsResult
}

export async function putLyricsCurrentApi(
  id: string,
  secret: string,
  entryId: string,
): Promise<void> {
  const res = await fetch(`/api/lyrics-share/${encodeURIComponent(id)}/current`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ entryId }),
  })
  if (!res.ok) {
    throw await readShareError(res)
  }
}

export async function getSharedLyricsApi(id: string): Promise<GetSharedLyricsResult> {
  const res = await fetch(`/api/lyrics-share/${encodeURIComponent(id)}`, {
    headers: {
      'Cache-Control': 'no-store',
    },
  })
  if (!res.ok) {
    throw await readShareError(res)
  }
  return (await res.json()) as GetSharedLyricsResult
}

export interface PutSetLinkResult {
  id: string
  expiresAt: string
  unchanged: boolean
}

export interface GetSetLinkResult {
  id: string
  payload: import('../types/song').SetLinkPayload
  expiresAt: string
}

export async function putSetLinkApi(
  id: string,
  secret: string,
  payload: import('../types/song').SetLinkPayload,
  options: { keepalive?: boolean } = {},
): Promise<PutSetLinkResult> {
  const res = await fetch(`/api/set-link/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ payload }),
    ...(options.keepalive ? { keepalive: true } : {}),
  })
  if (!res.ok) {
    throw await readShareError(res)
  }
  return (await res.json()) as PutSetLinkResult
}

export async function getSetLinkApi(id: string): Promise<GetSetLinkResult> {
  const res = await fetch(`/api/set-link/${encodeURIComponent(id)}`, {
    headers: { 'Cache-Control': 'no-store' },
  })
  if (!res.ok) {
    throw await readShareError(res)
  }
  return (await res.json()) as GetSetLinkResult
}

export interface PutLiveSetResult {
  id: string
  rev: number
  expiresAt: string
  unchanged: boolean
}

export interface PutLiveSetSongResult {
  id: string
  hash: string
  created: boolean
  expiresAt: string
}

export interface GetLiveSetResult {
  id: string
  manifest: import('../types/song').LiveSetManifest
  contents: Record<string, import('../types/song').LiveSongContent>
  expiresAt: string
}

/** The server needs these content docs before it accepts the manifest. */
export class LiveSetMissingContentError extends ShareApiError {
  readonly missing: string[]

  constructor(missing: string[]) {
    super('Some song content has not been uploaded', 'MISSING_CONTENT', 409)
    this.missing = missing
  }
}

function liveSetHeaders(secret: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }
}

export async function putLiveSetSongApi(
  id: string,
  secret: string,
  hash: string,
  content: import('../types/song').LiveSongContent,
): Promise<PutLiveSetSongResult> {
  const res = await fetch(
    `/api/live-set/${encodeURIComponent(id)}/song/${encodeURIComponent(hash)}`,
    { method: 'PUT', headers: liveSetHeaders(secret), body: JSON.stringify({ content }) },
  )
  if (!res.ok) {
    throw await readShareError(res)
  }
  return (await res.json()) as PutLiveSetSongResult
}

export async function putLiveSetManifestApi(
  id: string,
  secret: string,
  manifest: import('../types/song').LiveSetManifestInput,
  options: { keepalive?: boolean } = {},
): Promise<PutLiveSetResult> {
  const res = await fetch(`/api/live-set/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: liveSetHeaders(secret),
    body: JSON.stringify({ manifest }),
    ...(options.keepalive ? { keepalive: true } : {}),
  })
  if (!res.ok) {
    if (res.status === 409) {
      const data = await res.json().catch(() => null)
      if (data?.error?.code === 'MISSING_CONTENT' && Array.isArray(data.error.missing)) {
        throw new LiveSetMissingContentError(data.error.missing)
      }
    }
    throw await readShareError(res)
  }
  return (await res.json()) as PutLiveSetResult
}

export async function deleteLiveSetApi(id: string, secret: string): Promise<void> {
  const res = await fetch(`/api/live-set/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${secret}` },
  })
  if (!res.ok) {
    throw await readShareError(res)
  }
}

export async function resumeLiveSetApi(id: string, secret: string): Promise<void> {
  const res = await fetch(`/api/live-set/${encodeURIComponent(id)}/resume`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  })
  if (!res.ok) {
    throw await readShareError(res)
  }
}

export async function getLiveSetApi(id: string): Promise<GetLiveSetResult> {
  const res = await fetch(`/api/live-set/${encodeURIComponent(id)}`, {
    headers: { 'Cache-Control': 'no-store' },
  })
  if (!res.ok) {
    throw await readShareError(res)
  }
  return (await res.json()) as GetLiveSetResult
}

/** The sign-in is too old; the person must sign in again before deleting the account. */
export class AccountReauthError extends Error {
  constructor(message = 'Sign in again to delete your account.') {
    super(message)
    this.name = 'AccountReauthError'
  }
}

export async function deleteAccountApi(idToken: string): Promise<void> {
  const res = await fetch('/api/account', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  })
  if (!res.ok) {
    let code: string | undefined
    let message = `Delete account request failed (${res.status})`
    try {
      const data = await res.json()
      code = data?.error?.code
      message = data?.error?.message || message
    } catch {
      // Preserve the HTTP fallback.
    }
    if (code === 'REAUTH') throw new AccountReauthError(message)
    throw new Error(message)
  }
}
