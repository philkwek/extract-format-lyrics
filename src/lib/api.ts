import type { Song } from '../types/song'

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

export interface ApiSearchResponse {
  query: string
  results: SearchCandidate[]
}

export async function searchApi(query: string): Promise<SearchCandidate[]> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
  if (!res.ok) {
    let errMsg = `Search failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error?.message) errMsg = data.error.message
    } catch {
      // ignore
    }
    throw new Error(errMsg)
  }
  const data = (await res.json()) as ApiSearchResponse
  return data.results
}

export class ShareApiError extends Error {
  readonly code?: string
  readonly status?: number

  constructor(message: string, code?: string, status?: number) {
    super(message)
    this.code = code
    this.status = status
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
  return new ShareApiError(message, code, res.status)
}

export interface CreateShareResult { id: string; expiresAt: string }

export async function createShareApi(snapshot: import('../types/song').SharedSetSnapshot): Promise<CreateShareResult> {
  const res = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshot }),
  })
  if (!res.ok) {
    throw await readShareError(res)
  }
  return await res.json() as CreateShareResult
}

export async function getShareApi(id: string): Promise<import('../types/song').SharedSetSnapshot> {
  const res = await fetch(`/api/share/${encodeURIComponent(id)}`)
  if (!res.ok) {
    throw await readShareError(res)
  }
  const data = await res.json()
  return data.snapshot
}

export interface ExtractSongsResponse {
  songs: Song[]
}

export interface ExtractSongsProgressEvent {
  message: string
  completed?: number
  total?: number
}

export type ExtractSongsProgress = (progress: ExtractSongsProgressEvent) => void

// Firebase Hosting terminates rewritten dynamic requests after 60 seconds.
// Sheet extraction can legitimately exceed that while Gemini processes a
// multi-page packet, so production calls the HTTPS function directly.
const extractSheetEndpoint =
  import.meta.env.VITE_EXTRACT_SHEET_ENDPOINT ||
  (import.meta.env.PROD
    ? 'https://us-central1-extract-format-lyrics.cloudfunctions.net/api/extract-sheet'
    : '/api/extract-sheet')

export async function extractSongsApi(
  files: Array<{ mimeType: string; base64Data: string }>,
  apiKey?: string,
  expectedSongCount?: number,
  onProgress?: ExtractSongsProgress
): Promise<Song[]> {
  const res = await fetch(extractSheetEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, apiKey, expectedSongCount }),
  })

  if (!res.ok) {
    let errMsg = `Extraction failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error?.message) {
        errMsg = data.error.message
      }
    } catch {
      // ignore
    }
    throw new Error(errMsg)
  }

  if (!res.body) throw new Error('Extraction response did not include a readable result')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: ExtractSongsResponse | null = null
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line) continue
      const event = JSON.parse(line) as {
        type: string
        message?: string
        songs?: Song[]
        completed?: number
        total?: number
      }
      if (event.type === 'progress' && event.message) {
        onProgress?.({ message: event.message, completed: event.completed, total: event.total })
      }
      if (event.type === 'error') throw new Error(event.message || 'Extraction failed')
      if (event.type === 'result' && event.songs) result = { songs: event.songs }
    }
    if (done) break
  }
  if (!result) throw new Error('Extraction ended without a result')
  return result.songs
}
