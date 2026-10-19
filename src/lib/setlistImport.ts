import { scrapeApi, type SearchCandidate } from './api'
import { songCache, type SongCache } from './songCache'
import { sessionStore, type Session, type SessionSongItem, type SessionStore } from './sessionStore'
import { splitUrls, validateUrls } from '../../functions/src/urls'
import type { Song } from '../types/song'

export type ImportStatusValue = 'pending' | 'cached' | 'fetching' | 'done' | 'error'

export interface ImportProgress {
  url: string
  status: ImportStatusValue
  message?: string
}

export interface ImportSource {
  url: string
  title?: string
  artist?: string
  site?: string
}

export interface InvalidImportInput {
  input: string
  reason: string
}

export interface ParsedPastedSources {
  sources: ImportSource[]
  invalid: InvalidImportInput[]
  tokenCount: number
}

export interface ImportSourceDeps {
  cache: Pick<SongCache, 'getSong' | 'saveSong' | 'recordFailed'>
  sessions: Pick<SessionStore, 'createSession' | 'addSongsToSession'>
  scrape: typeof scrapeApi
}

export interface ImportSourcesOptions {
  targetSessionId?: string
  invalidInputs?: InvalidImportInput[]
  requireAll?: boolean
  chunkSize?: number
  onProgress?: (statuses: ImportProgress[]) => void
  deps?: Partial<ImportSourceDeps>
}

export interface ImportSourcesResult {
  session: Session
  items: SessionSongItem[]
  imported: number
  attempted: number
  firstNewIndex: number
  failures: Array<{ url: string; reason: string }>
}

interface LoadOutcome {
  song?: Song
  reason?: string
}

const DEFAULT_CHUNK_SIZE = 5

/** Splits pasted text into importable sources and invalid inputs. */
export function parsePastedSources(input: string): ParsedPastedSources {
  const tokens = splitUrls(input)
  const { valid, invalid } = validateUrls(tokens)
  return {
    sources: valid.map(({ url }) => ({ url })),
    invalid: invalid.map(({ input: invalidInput, reason }) => ({ input: invalidInput, reason })),
    tokenCount: tokens.length,
  }
}

/** Converts a search result into the shared import source shape. */
export function sourceFromCandidate(candidate: SearchCandidate): ImportSource {
  return {
    url: candidate.url,
    title: candidate.title,
    artist: candidate.artist,
    site: candidate.site,
  }
}

/**
 * Imports one or more chord-sheet sources into a new or existing setlist.
 *
 * The pipeline is intentionally shared by paste imports and search results:
 * validate/cache lookup -> scrape uncached URLs in chunks -> persist once.
 */
export async function importSources(
  sources: ImportSource[],
  options: ImportSourcesOptions = {}
): Promise<ImportSourcesResult> {
  const deps: ImportSourceDeps = {
    cache: options.deps?.cache ?? songCache,
    sessions: options.deps?.sessions ?? sessionStore,
    scrape: options.deps?.scrape ?? scrapeApi,
  }
  const invalidInputs = options.invalidInputs ?? []
  const statuses: ImportProgress[] = [
    ...sources.map((source) => ({ url: source.url, status: 'pending' as const })),
    ...invalidInputs.map((input) => ({
      url: input.input,
      status: 'error' as const,
      message: input.reason,
    })),
  ]
  const outcomes: LoadOutcome[] = new Array(sources.length)
  const uncached: Array<{ source: ImportSource; index: number }> = []

  const emitProgress = () => options.onProgress?.(statuses.map((status) => ({ ...status })))
  const updateStatus = (url: string, next: Partial<ImportProgress>) => {
    const index = statuses.findIndex((status) => status.url === url)
    if (index >= 0) statuses[index] = { ...statuses[index], ...next }
  }

  emitProgress()

  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index]
    const cached = await deps.cache.getSong(source.url)
    if (cached) {
      outcomes[index] = { song: cached }
      updateStatus(source.url, { status: 'cached', message: 'Loaded from cache' })
      emitProgress()
    } else {
      uncached.push({ source, index })
    }
  }

  const chunkSize = Math.max(1, options.chunkSize ?? DEFAULT_CHUNK_SIZE)
  for (let offset = 0; offset < uncached.length; offset += chunkSize) {
    const chunk = uncached.slice(offset, offset + chunkSize)
    for (const { source } of chunk) {
      updateStatus(source.url, { status: 'fetching', message: undefined })
    }
    emitProgress()

    try {
      const response = await deps.scrape(chunk.map(({ source }) => source.url))
      const resultByUrl = new Map(response.results.map((result) => [result.url, result]))

      for (const { source, index } of chunk) {
        const result = resultByUrl.get(source.url)
        if (result?.status === 'ok' && result.song) {
          try {
            await deps.cache.saveSong(result.song)
            outcomes[index] = { song: result.song }
            updateStatus(source.url, { status: 'done', message: undefined })
          } catch (err) {
            const reason = errorMessage(err, 'Could not save song')
            outcomes[index] = { reason }
            updateStatus(source.url, { status: 'error', message: reason })
          }
        } else {
          const reason = result?.message || 'Scrape failed'
          try {
            await deps.cache.recordFailed(source.url, reason)
          } catch {
            // Failure markers are best-effort; the import result is still valid.
          }
          outcomes[index] = { reason }
          updateStatus(source.url, { status: 'error', message: reason })
        }
      }
    } catch (err) {
      const reason = errorMessage(err, 'Network error')
      for (const { source, index } of chunk) {
        outcomes[index] = { reason }
        updateStatus(source.url, { status: 'error', message: reason })
      }
    }
    emitProgress()
  }

  const failures = outcomes.flatMap((outcome, index) =>
    outcome.song ? [] : [{ url: sources[index].url, reason: outcome.reason || 'Import failed' }]
  )
  const allFailures = [
    ...failures,
    ...invalidInputs.map((input) => ({ url: input.input, reason: input.reason })),
  ]

  if (options.requireAll && allFailures.length > 0) {
    throw new Error(allFailures[0].reason)
  }

  const items: SessionSongItem[] = sources.map((source, index) => {
    const outcome = outcomes[index]
    if (outcome.song) {
      return {
        url: outcome.song.sourceUrl,
        title: source.title ?? outcome.song.title,
        artist: source.artist ?? outcome.song.artist,
        status: 'ok',
      }
    }
    return {
      url: source.url,
      title: source.title,
      artist: source.artist,
      status: 'error',
      errorMessage: outcome.reason || 'Import failed',
    }
  })

  for (const invalid of invalidInputs) {
    items.push({
      url: invalid.input,
      status: 'error',
      errorMessage: invalid.reason,
    })
  }

  const imported = outcomes.filter((outcome) => outcome.song).length
  const attempted = sources.length + invalidInputs.length

  if (options.targetSessionId) {
    const appended = await deps.sessions.addSongsToSession(options.targetSessionId, items)
    if (!appended) throw new Error('Setlist is unavailable')
    return {
      session: appended.session,
      items,
      imported,
      attempted,
      firstNewIndex: appended.firstNewIndex,
      failures,
    }
  }

  const session = await deps.sessions.createSession(items)
  return {
    session,
    items,
    imported,
    attempted,
    firstNewIndex: 0,
    failures,
  }
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}
