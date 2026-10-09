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
