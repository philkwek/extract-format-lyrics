import { getSetLinkApi, ShareApiError } from './api'
import { loadSources, type ImportProgress } from './setlistImport'
import { sessionStore, type Session, type SessionSongItem } from './sessionStore'
import type { SetLinkPayload } from '../types/song'

export type SetLinkImportResult =
  | { kind: 'reused'; session: Session }
  | { kind: 'imported'; session: Session }
  | { kind: 'empty' }
  | { kind: 'expired' }
  | { kind: 'missing' }

export interface SetLinkImportOptions {
  onProgress?: (message: string) => void
  /** Create a fresh copy even when this link was already imported. */
  force?: boolean
  deps?: {
    fetchLink: (id: string) => Promise<{ payload: SetLinkPayload }>
    loadSources: typeof loadSources
    sessions: Pick<typeof sessionStore, 'findByImportedLinkId' | 'createSession'>
  }
}

/**
 * Turns a set link into a local copy: scrape every song first, then create one
 * session so the new set is written (and synced) once.
 */
export async function importFromSetLink(
  linkId: string,
  options: SetLinkImportOptions = {},
): Promise<SetLinkImportResult> {
  const fetchLink = options.deps?.fetchLink ?? getSetLinkApi
  const runLoad = options.deps?.loadSources ?? loadSources
  const sessions = options.deps?.sessions ?? sessionStore

  if (!options.force) {
    const existing = await sessions.findByImportedLinkId(linkId)
    if (existing) return { kind: 'reused', session: existing }
  }

  options.onProgress?.('Retrieving the set...')
  let payload: SetLinkPayload
  try {
    payload = (await fetchLink(linkId)).payload
  } catch (err) {
    if (err instanceof ShareApiError && err.code === 'EXPIRED') return { kind: 'expired' }
    if (err instanceof ShareApiError && err.code === 'NOT_FOUND') return { kind: 'missing' }
    throw err
  }

  const total = payload.songs.length
  const onProgress = (statuses: ImportProgress[]) => {
    const done = statuses.filter((s) => s.status === 'done' || s.status === 'cached' || s.status === 'error').length
    options.onProgress?.(`Loading songs (${done} of ${total})...`)
  }

  const loaded = await runLoad(
    payload.songs.map((song) => ({ url: song.url, title: song.title, artist: song.artist })),
    { ignoreFailureCache: true, onProgress },
  )

  // Outcomes stay aligned with payload.songs, so a failed song never shifts
  // another song's settings.
  const items: SessionSongItem[] = loaded.outcomes.flatMap((outcome, index) => {
    if (!outcome.item) return []
    const song = payload.songs[index]
    return [
      {
        ...outcome.item,
        entryId: song.entryId,
        ...(song.targetKey !== undefined ? { targetKey: song.targetKey } : {}),
        ...(song.simplified !== undefined ? { simplified: song.simplified } : {}),
        ...(song.padKeyMode !== undefined ? { padKeyMode: song.padKeyMode } : {}),
        ...(song.customPadKey !== undefined ? { customPadKey: song.customPadKey } : {}),
      },
    ]
  })

  if (items.length === 0) return { kind: 'empty' }

  options.onProgress?.('Saving your copy...')
  const session = await sessions.createSession(items, payload.name, {
    importedFromLinkId: linkId,
    importFailures: loaded.failures,
  })
  return { kind: 'imported', session }
}

/** Forces a brand-new copy from the link's current contents. */
export function refreshFromSetLink(
  linkId: string,
  options: Omit<SetLinkImportOptions, 'force'> = {},
): Promise<SetLinkImportResult> {
  return importFromSetLink(linkId, { ...options, force: true })
}

const inFlight = new Map<string, Promise<SetLinkImportResult>>()

/** Shares one import per link, so StrictMode's double effect never imports twice. */
export function importFromSetLinkOnce(
  linkId: string,
  options: SetLinkImportOptions = {},
  force = false,
): Promise<SetLinkImportResult> {
  const key = `${force ? 'f' : 'n'}:${linkId}`
  let promise = inFlight.get(key)
  if (!promise) {
    promise = importFromSetLink(linkId, { ...options, force }).finally(() => inFlight.delete(key))
    inFlight.set(key, promise)
  }
  return promise
}
