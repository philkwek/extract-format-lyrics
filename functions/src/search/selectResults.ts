import type { SearchCandidate } from './types.js'
import { UG_SEARCH_RESULT_LIMIT } from './types.js'

export const DEFAULT_SEARCH_RESULT_LIMIT = 8
export const SUPPORTED_SEARCH_SOURCE_COUNT = 3
/** Reserve capacity for every source while streaming partial results. */
export const PARTIAL_SOURCE_RESULT_LIMIT = Math.ceil(
  DEFAULT_SEARCH_RESULT_LIMIT / SUPPORTED_SEARCH_SOURCE_COUNT
)
/**
 * Ultimate Guitar ordering: keep the source's own payload order and take the
 * first accessible candidates. The adapter already limits this to the desired
 * output count; this helper only de-duplicates canonical URLs.
 */
export function selectNativeSourceResults(
  candidates: SearchCandidate[],
  limit = UG_SEARCH_RESULT_LIMIT
): SearchCandidate[] {
  const selected: SearchCandidate[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const key = canonicalCandidateUrl(candidate.url)
    if (seen.has(key)) continue
    seen.add(key)
    selected.push({ ...candidate, url: key })
    if (selected.length >= limit) break
  }
  return selected
}

/**
 * API selection: Ultimate Guitar keeps its own order; other sources use the
 * balanced/relevance policy and fill the remaining capacity.
 */
export function selectCombinedSearchResults(
  candidates: SearchCandidate[],
  query: string,
  limit = DEFAULT_SEARCH_RESULT_LIMIT
): SearchCandidate[] {
  const ultimateGuitar = selectNativeSourceResults(
    candidates.filter((candidate) => candidate.site === 'ultimate-guitar'),
    Math.min(UG_SEARCH_RESULT_LIMIT, limit)
  )
  const otherSources = selectSearchResults(
    candidates.filter((candidate) => candidate.site !== 'ultimate-guitar'),
    query,
    Math.max(0, limit - ultimateGuitar.length)
  )
  return [...ultimateGuitar, ...otherSources].slice(0, limit)
}

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'ref',
  'referrer',
])

/**
 * Canonical key for duplicate removal. Meaningful parameters (UG version,
 * `simplified`, etc.) are preserved; tracking parameters and fragments are not.
 */
export function canonicalCandidateUrl(input: string): string {
  try {
    const url = new URL(input)
    url.hash = ''
    url.hostname = url.hostname.toLowerCase()
    const params = [...url.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b))
    url.search = ''
    for (const [key, value] of params) url.searchParams.append(key, value)
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '')
    }
    return url.toString()
  } catch {
    return input.trim()
  }
}

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9#]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
}

function relevance(candidate: SearchCandidate, tokens: string[]): number {
  if (tokens.length === 0) return 0
  const haystack = `${candidate.title} ${candidate.artist} ${candidate.versionLabel ?? ''}`.toLowerCase()
  return tokens.reduce((score, token) => (haystack.includes(token) ? score + 1 : score), 0)
}

interface RankedCandidate {
  candidate: SearchCandidate
  relevance: number
  order: number
  sourceOrder: number
}

/**
 * Result selection rule:
 *
 * 1. Drop candidates that do not match any query token when at least one
 *    relevant candidate exists.
 * 2. De-duplicate by canonical URL, keeping the most relevant/highest-rated
 *    representative.
 * 3. Order within each source by relevance, then source-local rating. Ratings
 *    from different sites are never compared directly.
 * 4. Take turns across sources so a highly rated Ultimate Guitar list cannot
 *    hide every other source; fill remaining capacity from the leftovers.
 *
 * The policy is deterministic for a given query and input order.
 */
export function selectSearchResults(
  candidates: SearchCandidate[],
  query: string,
  limit = DEFAULT_SEARCH_RESULT_LIMIT
): SearchCandidate[] {
  const tokens = queryTokens(query)
  const byUrl = new Map<string, RankedCandidate>()
  const sourceFirstSeen = new Map<string, number>()

  candidates.forEach((candidate, order) => {
    if (!sourceFirstSeen.has(candidate.site)) {
      sourceFirstSeen.set(candidate.site, sourceFirstSeen.size)
    }
    const key = canonicalCandidateUrl(candidate.url)
    const ranked: RankedCandidate = {
      candidate: { ...candidate, url: key },
      relevance: relevance(candidate, tokens),
      order,
      sourceOrder: sourceFirstSeen.get(candidate.site)!,
    }
    const existing = byUrl.get(key)
    if (
      !existing ||
      ranked.relevance > existing.relevance ||
      (ranked.relevance === existing.relevance && (ranked.candidate.rating ?? -1) > (existing.candidate.rating ?? -1))
    ) {
      byUrl.set(key, ranked)
    }
  })

  const unique = [...byUrl.values()]
  const relevant = tokens.length > 0 ? unique.filter((item) => item.relevance > 0) : unique
  const pool = relevant.length > 0 ? relevant : unique

  pool.sort((a, b) => {
    if (a.sourceOrder !== b.sourceOrder) return a.sourceOrder - b.sourceOrder
    if (b.relevance !== a.relevance) return b.relevance - a.relevance
    // Rating is only compared inside one source.
    if ((b.candidate.rating ?? -1) !== (a.candidate.rating ?? -1)) {
      return (b.candidate.rating ?? -1) - (a.candidate.rating ?? -1)
    }
    const title = a.candidate.title.localeCompare(b.candidate.title)
    if (title !== 0) return title
    return a.order - b.order
  })

  const queues = new Map<string, RankedCandidate[]>()
  for (const item of pool) {
    const queue = queues.get(item.candidate.site) ?? []
    queue.push(item)
    queues.set(item.candidate.site, queue)
  }

  const orderedSources = [...queues.keys()].sort(
    (a, b) => (sourceFirstSeen.get(a) ?? 0) - (sourceFirstSeen.get(b) ?? 0)
  )
  const selected: RankedCandidate[] = []
  let index = 0
  while (selected.length < limit) {
    let added = false
    for (const source of orderedSources) {
      const queue = queues.get(source)!
      if (index < queue.length) {
        selected.push(queue[index])
        added = true
        if (selected.length >= limit) break
      }
    }
    if (!added) break
    index += 1
  }

  return selected.map((item) => item.candidate)
}
