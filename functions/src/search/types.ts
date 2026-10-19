/** Ultimate Guitar's own ordering is used directly for this many results. */
export const UG_SEARCH_RESULT_LIMIT = 3

export interface SearchCandidate {
  site: string
  title: string
  artist: string
  url: string
  versionLabel?: string
  rating?: number
  type?: string
}

export interface SearchAdapter {
  site: string
  search(query: string): Promise<SearchCandidate[]>
}

/** Parser/schema failure, as opposed to a valid page with no matches. */
export class SearchParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SearchParseError'
  }
}

export type SearchFailureReason = 'timeout' | 'blocked' | 'fetch' | 'parser'

export interface SearchSourceStatus {
  site: string
  status: 'ok' | 'empty' | 'failed'
  count: number
  durationMs: number
  failure?: SearchFailureReason
  message?: string
}

export type SearchSiteOutcome =
  | { site: string; status: 'ok'; candidates: SearchCandidate[]; durationMs: number; failure?: undefined }
  | { site: string; status: 'empty'; candidates: SearchCandidate[]; durationMs: number; failure?: undefined }
  | {
      site: string
      status: 'failed'
      candidates: SearchCandidate[]
      durationMs: number
      failure: SearchFailureReason
      message: string
    }

export function toSourceStatus(outcome: SearchSiteOutcome): SearchSourceStatus {
  return {
    site: outcome.site,
    status: outcome.status,
    count: outcome.candidates.length,
    durationMs: outcome.durationMs,
    ...(outcome.status === 'failed' ? { failure: outcome.failure, message: outcome.message } : {}),
  }
}
