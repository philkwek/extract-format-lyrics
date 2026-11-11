import { getSetLinkApi, ShareApiError } from './api'
import { loadSources, type ImportOutcome, type ImportProgress } from './setlistImport'
import {
  sessionStore,
  uniqueSetName,
  type ImportFailure,
  type LinkSnapshotEntry,
  type Session,
  type SessionSongItem,
} from './sessionStore'
import type { SetLinkPayload, SetLinkSong } from '../types/song'

export interface SetLinkPreview {
  linkId: string
  name: string
  items: SessionSongItem[]
  failures: ImportFailure[]
  snapshot: LinkSnapshotEntry[]
}

export type SetLinkPreviewResult =
  | { kind: 'preview'; preview: SetLinkPreview }
  | { kind: 'expired' }
  | { kind: 'missing' }
  | { kind: 'empty' }

/** Outcomes stay aligned with payload.songs, so a failed song never shifts another's settings. */
function itemsFromOutcomes(outcomes: ImportOutcome[], songs: SetLinkSong[]): SessionSongItem[] {
  return outcomes.flatMap((outcome, index) => {
    if (!outcome.item) return []
    const song = songs[index]
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
}

function snapshotFromSongs(songs: SetLinkSong[]): LinkSnapshotEntry[] {
  return songs.map(({ entryId, url, targetKey }) => ({
    entryId,
    url,
    ...(targetKey !== undefined ? { targetKey } : {}),
  }))
}

/** Fetches and loads a link's songs without saving anything, so it can be previewed first. */
export async function loadSetLinkPreview(
  linkId: string,
  options: {
    onProgress?: (message: string) => void
    deps?: {
      fetchLink: (id: string) => Promise<{ payload: SetLinkPayload }>
      loadSources: typeof loadSources
    }
  } = {},
): Promise<SetLinkPreviewResult> {
  const fetchLink = options.deps?.fetchLink ?? getSetLinkApi
  const runLoad = options.deps?.loadSources ?? loadSources

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

  const items = itemsFromOutcomes(loaded.outcomes, payload.songs)
  if (items.length === 0) return { kind: 'empty' }

  return {
    kind: 'preview',
    preview: {
      linkId,
      name: payload.name,
      items,
      failures: loaded.failures,
      snapshot: snapshotFromSongs(payload.songs),
    },
  }
}

export async function savePreviewAsNew(
  preview: SetLinkPreview,
  deps: {
    sessions: Pick<typeof sessionStore, 'getAllSessions' | 'createSession'>
  } = { sessions: sessionStore },
): Promise<Session> {
  const sessions = await deps.sessions.getAllSessions()
  return deps.sessions.createSession(
    preview.items,
    uniqueSetName(preview.name, sessions.map((session) => session.name)),
    {
      importedFromLinkId: preview.linkId,
      linkSnapshot: preview.snapshot,
      importFailures: preview.failures,
    },
  )
}

/** Counts what changed on the link since this copy was saved, matched by entryId. */
export function diffLinkSnapshot(
  saved: LinkSnapshotEntry[] | undefined,
  latest: LinkSnapshotEntry[],
): { added: number; removed: number; keyChanged: number } {
  if (!saved) return { added: 0, removed: 0, keyChanged: 0 }
  const savedById = new Map(saved.map((entry) => [entry.entryId, entry]))
  const latestIds = new Set(latest.map((entry) => entry.entryId))
  let added = 0
  let removed = 0
  let keyChanged = 0
  for (const entry of latest) {
    const before = savedById.get(entry.entryId)
    if (!before) added += 1
    else if (before.targetKey !== entry.targetKey) keyChanged += 1
  }
  for (const entry of saved) {
    if (!latestIds.has(entry.entryId)) removed += 1
  }
  return { added, removed, keyChanged }
}
