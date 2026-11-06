import { getSetLinkApi, ShareApiError } from './api'
import { importSources, type ImportProgress } from './setlistImport'
import { sessionStore, type Session, type SessionSongItem } from './sessionStore'
import type { SetLinkPayload } from '../types/song'

export type SetLinkImportResult =
  | { kind: 'reused'; session: Session }
  | { kind: 'imported'; session: Session; failed: number }
  | { kind: 'expired' }
  | { kind: 'missing' }

export interface SetLinkImportOptions {
  onProgress?: (message: string) => void
  /** Create a fresh copy even when this link was already imported. */
  force?: boolean
  deps?: {
    fetchLink: (id: string) => Promise<{ payload: SetLinkPayload }>
    importSources: typeof importSources
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
  const runImport = options.deps?.importSources ?? importSources
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

  // importSources scrapes + caches; we capture its items instead of letting it
  // create the session, because we need to add the per-song settings first.
  let captured: SessionSongItem[] = []
  await runImport(
    payload.songs.map((song) => ({ url: song.url, title: song.title, artist: song.artist })),
    {
      ignoreFailureCache: true,
      onProgress,
      deps: {
        sessions: {
          createSession: async (items: SessionSongItem[]) => {
            captured = items
            return { id: '', createdAt: 0, name: '', songs: items }
          },
          addSongsToSession: async () => null,
        },
      },
    },
  )

  const items: SessionSongItem[] = captured.map((item, index) => {
    const song = payload.songs[index]
    return {
      ...item,
      entryId: song.entryId,
      ...(song.targetKey !== undefined ? { targetKey: song.targetKey } : {}),
      ...(song.simplified !== undefined ? { simplified: song.simplified } : {}),
      ...(song.padKeyMode !== undefined ? { padKeyMode: song.padKeyMode } : {}),
      ...(song.customPadKey !== undefined ? { customPadKey: song.customPadKey } : {}),
    }
  })

  options.onProgress?.('Saving your copy...')
  const session = await sessions.createSession(items, payload.name, { importedFromLinkId: linkId })
  return { kind: 'imported', session, failed: items.filter((i) => i.status === 'error').length }
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
