import { scrapeApi, type SearchCandidate } from './api'
import { songCache, type SongCache } from './songCache'
import {
  sessionStore,
  type ImportFailure,
  type Session,
  type SessionSongItem,
  type SessionStore,
} from './sessionStore'
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
  cache: Pick<SongCache, 'getSong' | 'saveSong' | 'recordFailed' | 'getFailed'>
  /** Only needed when the import persists; loadSources ignores it. */
  sessions?: Pick<SessionStore, 'createSession' | 'addSongsToSession'>
  scrape: typeof scrapeApi
}

export interface LoadSourcesOptions {
  invalidInputs?: InvalidImportInput[]
  requireAll?: boolean
  chunkSize?: number
  /** Explicit retries bypass the short-lived local failure marker. */
  ignoreFailureCache?: boolean
  onProgress?: (statuses: ImportProgress[]) => void
  deps?: Partial<ImportSourceDeps>
}

export interface ImportSourcesOptions extends LoadSourcesOptions {
  targetSessionId?: string
}

export interface ImportOutcome {
  url: string
  item?: SessionSongItem
  reason?: string
}

export interface LoadSourcesResult {
  /** One per source, in source order. */
  outcomes: ImportOutcome[]
  /** Songs that loaded, in source order. */
  items: SessionSongItem[]
  /** Failed sources and invalid inputs. */
  failures: ImportFailure[]
  imported: number
  attempted: number
}

export interface ImportSourcesResult extends LoadSourcesResult {
  session: Session | null
  firstNewIndex: number
}

interface LoadedSource {
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
 * Loads every source into a song item or a failure, without touching the session store.
 *
 * The pipeline is shared by paste imports and set links:
 * cache lookup -> scrape uncached URLs in chunks -> report each source's outcome.
 */
export async function loadSources(
  sources: ImportSource[],
  options: LoadSourcesOptions = {}
): Promise<LoadSourcesResult> {
  const deps = {
    cache: options.deps?.cache ?? songCache,
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
  const loaded: LoadedSource[] = new Array(sources.length)
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
      loaded[index] = { song: cached }
      updateStatus(source.url, { status: 'cached', message: 'Loaded from cache' })
      emitProgress()
      continue
    }

    // A marker is deliberately short-lived. Once it expires the normal retry
    // path runs; a manual retry can bypass it with ignoreFailureCache.
    let recentFailure: string | null = null
    if (!options.ignoreFailureCache) {
      try {
        recentFailure = (await deps.cache.getFailed?.(source.url)) ?? null
      } catch {
        // Failure markers are best-effort.
      }
    }
    if (recentFailure) {
      const reason = `Recent attempt failed: ${recentFailure}. Try again in a minute.`
      loaded[index] = { reason }
      updateStatus(source.url, { status: 'error', message: reason })
      emitProgress()
      continue
    }

    uncached.push({ source, index })
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
            await deps.cache.saveSong(result.song, source.url)
            loaded[index] = { song: result.song }
            updateStatus(source.url, { status: 'done', message: undefined })
          } catch (err) {
            const reason = errorMessage(err, 'Could not save song')
            loaded[index] = { reason }
            updateStatus(source.url, { status: 'error', message: reason })
          }
        } else {
          const reason = result?.message || 'Scrape failed'
          try {
            await deps.cache.recordFailed(source.url, reason)
          } catch {
            // Failure markers are best-effort; the import result is still valid.
          }
          loaded[index] = { reason }
          updateStatus(source.url, { status: 'error', message: reason })
        }
      }
    } catch (err) {
      const reason = errorMessage(err, 'Network error')
      for (const { source, index } of chunk) {
        loaded[index] = { reason }
        updateStatus(source.url, { status: 'error', message: reason })
      }
    }
    emitProgress()
  }

  const outcomes: ImportOutcome[] = sources.map((source, index) => {
    const outcome = loaded[index]
    if (!outcome.song) {
      return { url: source.url, reason: outcome.reason || 'Import failed' }
    }
    return {
      url: source.url,
      item: {
        url: outcome.song.sourceUrl,
        title: source.title ?? outcome.song.title,
        artist: source.artist ?? outcome.song.artist,
      },
    }
  })
  const items = outcomes.flatMap((outcome) => (outcome.item ? [outcome.item] : []))
  const failures: ImportFailure[] = [
    ...outcomes.flatMap((outcome) =>
      outcome.item ? [] : [{ url: outcome.url, reason: outcome.reason || 'Import failed' }]
    ),
    ...invalidInputs.map((input) => ({ url: input.input, reason: input.reason })),
  ]

  if (options.requireAll && failures.length > 0) {
    throw new Error(failures[0].reason)
  }

  return {
    outcomes,
    items,
    failures,
    imported: items.length,
    attempted: sources.length + invalidInputs.length,
  }
}

/**
 * Imports one or more chord-sheet sources into a new or existing setlist.
 *
 * Loading is done by loadSources; this function performs the single session write.
 * A set is never created for an import where no song loaded.
 */
export async function importSources(
  sources: ImportSource[],
  options: ImportSourcesOptions = {}
): Promise<ImportSourcesResult> {
  const loaded = await loadSources(sources, options)
  const sessions = options.deps?.sessions ?? sessionStore

  if (options.targetSessionId) {
    const appended = await sessions.addSongsToSession(
      options.targetSessionId,
      loaded.items,
      loaded.failures
    )
    if (!appended) throw new Error('Setlist is unavailable')
    return {
      ...loaded,
      session: appended.session,
      firstNewIndex: appended.firstNewIndex,
    }
  }

  if (loaded.items.length === 0) {
    return { ...loaded, session: null, firstNewIndex: 0 }
  }

  const session = await sessions.createSession(loaded.items, undefined, {
    importFailures: loaded.failures,
  })
  return { ...loaded, session, firstNewIndex: 0 }
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}
