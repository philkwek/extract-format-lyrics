import type { SearchCandidate, SearchSourceStatus } from './api'
import {
  SUPPORTED_SEARCH_SOURCE_COUNT,
  canonicalCandidateUrl,
} from '../../functions/src/search/selectResults'

export const SEARCH_RESULT_LIMIT = 8

function mergeCandidateMetadata(
  previous: SearchCandidate,
  incoming: SearchCandidate
): SearchCandidate {
  return { ...previous, ...incoming, url: previous.url }
}

/**
 * Adds one completed source's results while reserving capacity for sources
 * that are still pending. A fast source cannot fill all eight slots.
 * Existing cards keep their position and metadata is refreshed in place.
 */
export function mergePartialSearchCandidates(
  previous: SearchCandidate[],
  incoming: SearchCandidate[],
  limit = SEARCH_RESULT_LIMIT,
  sourceCount = SUPPORTED_SEARCH_SOURCE_COUNT
): SearchCandidate[] {
  const merged = [...previous]
  const seen = new Map(
    merged.map((candidate, index) => [canonicalCandidateUrl(candidate.url), index])
  )
  const perSourceLimit = Math.max(1, Math.ceil(limit / Math.max(1, sourceCount)))
  const perSourceCount = new Map<string, number>()
  for (const candidate of merged) {
    perSourceCount.set(candidate.site, (perSourceCount.get(candidate.site) ?? 0) + 1)
  }

  for (const candidate of incoming) {
    const key = canonicalCandidateUrl(candidate.url)
    const existing = seen.get(key)
    if (existing !== undefined) {
      merged[existing] = mergeCandidateMetadata(merged[existing], candidate)
      continue
    }
    const sourceTotal = perSourceCount.get(candidate.site) ?? 0
    if (merged.length >= limit || sourceTotal >= perSourceLimit) continue
    seen.set(key, merged.length)
    perSourceCount.set(candidate.site, sourceTotal + 1)
    merged.push(candidate)
  }

  return merged
}

/**
 * Applies the backend's final balanced selection. Previously visible cards keep
 * their order when they are still selected, then any remaining final results
 * fill the unused capacity.
 */
export function mergeFinalSearchCandidates(
  previous: SearchCandidate[],
  final: SearchCandidate[],
  limit = SEARCH_RESULT_LIMIT
): SearchCandidate[] {
  const finalByUrl = new Map(
    final.map((candidate) => [canonicalCandidateUrl(candidate.url), candidate])
  )
  const merged: SearchCandidate[] = []
  const seen = new Set<string>()

  for (const candidate of previous) {
    const key = canonicalCandidateUrl(candidate.url)
    const selected = finalByUrl.get(key)
    if (!selected || seen.has(key)) continue
    seen.add(key)
    merged.push(mergeCandidateMetadata(candidate, selected))
  }

  for (const candidate of final) {
    const key = canonicalCandidateUrl(candidate.url)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(candidate)
    if (merged.length >= limit) break
  }

  return merged.slice(0, limit)
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
    case 'worshipchords':
      return 'Worship Chords (.com)'
    case 'worshipchords-net':
      return 'Worship Chords (.net)'
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
