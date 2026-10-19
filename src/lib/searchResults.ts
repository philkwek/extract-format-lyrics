import type { SearchCandidate, SearchSourceStatus } from './api'
import { canonicalCandidateUrl } from '../../functions/src/search/selectResults'

export const SEARCH_RESULT_LIMIT = 8

/**
 * Appends newly completed source results without moving cards the user may
 * already be about to select. Existing entries keep their position.
 */
export function mergeSearchCandidates(
  previous: SearchCandidate[],
  incoming: SearchCandidate[],
  limit = SEARCH_RESULT_LIMIT
): SearchCandidate[] {
  const merged = [...previous]
  const seen = new Map(merged.map((candidate, index) => [canonicalCandidateUrl(candidate.url), index]))

  for (const candidate of incoming) {
    const key = canonicalCandidateUrl(candidate.url)
    const existing = seen.get(key)
    if (existing !== undefined) {
      merged[existing] = { ...merged[existing], ...candidate, url: merged[existing].url }
      continue
    }
    if (merged.length >= limit) continue
    seen.set(key, merged.length)
    merged.push(candidate)
  }

  return merged
}

export function upsertSearchSource(
  sources: SearchSourceStatus[],
  incoming: SearchSourceStatus
): SearchSourceStatus[] {
  const index = sources.findIndex((source) => source.site === incoming.site)
  if (index < 0) return [...sources, incoming]
  const next = [...sources]
  next[index] = incoming
  return next
}

export function sourceLabel(site: string): string {
  switch (site) {
    case 'ultimate-guitar':
      return 'Ultimate Guitar'
    case 'pnwchords':
      return 'PNW Chords'
    case 'worshiptogether':
      return 'Worship Together'
    default:
      return site
  }
}

export function allSearchSourcesFailed(sources: SearchSourceStatus[]): boolean {
  return sources.length > 0 && sources.every((source) => source.status === 'failed')
}

export function failedSearchSources(sources: SearchSourceStatus[]): SearchSourceStatus[] {
  return sources.filter((source) => source.status === 'failed')
}
