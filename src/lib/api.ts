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

export async function createShortLinkApi(payload: import('../types/song').SharePayload): Promise<string> {
  const res = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
  })
  if (!res.ok) {
    throw new Error('Failed to create short link')
  }
  const data = await res.json()
  return data.id
}

export async function getShortLinkApi(id: string): Promise<import('../types/song').SharePayload> {
  const res = await fetch(`/api/share/${encodeURIComponent(id)}`)
  if (!res.ok) {
    throw new Error('Share link not found or expired')
  }
  const data = await res.json()
  return data.payload
}

export interface ExtractSongsResponse {
  songs: Song[]
}

export async function extractSongsApi(
  files: Array<{ mimeType: string; base64Data: string }>,
  apiKey?: string
): Promise<Song[]> {
  const res = await fetch('/api/extract-sheet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, apiKey }),
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

  const data = (await res.json()) as ExtractSongsResponse
  return data.songs
}

