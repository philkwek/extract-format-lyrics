import type { SharedLyricsPayload, Song } from '../types/song'
import type { Session } from './sessionStore'
import { sessionStore } from './sessionStore'
import { songCache } from './songCache'
import { putSharedLyricsApi } from './api'
import { buildSharedLyricsPayload, MAX_SHARED_LYRICS_SONGS } from './exportLyrics'
import {
  deleteLyricsPublicationIdentity,
  getLyricsPublicationIdentity,
  hashSharedLyricsPayload,
  saveLyricsPublicationIdentity,
  withNamedLock,
} from './lyricsPublishIdentity'
import {
  createSyncChannel,
  type EnsureFreshResult,
  type SetLinkSync,
  type SyncChannelDeps,
} from './setLinkSync'

export type LyricsSyncDeps = Pick<
  SyncChannelDeps<SharedLyricsPayload>,
  'store' | 'identity' | 'now' | 'timers' | 'withLock' | 'visibility'
> & {
  api: (
    id: string,
    secret: string,
    payload: SharedLyricsPayload,
    options: { keepalive?: boolean },
  ) => Promise<{ expiresAt: string }>
  getSong: (url: string) => Promise<Song | null>
}

export interface LyricsBuildResult {
  payload: SharedLyricsPayload | null
  reason?: 'empty' | 'too_many'
}

/** Builds the same lyrics payload the manual share panel publishes. */
export async function buildLyricsSyncPayload(
  session: Pick<Session, 'name' | 'songs'>,
  getSong: (url: string) => Promise<Song | null>,
): Promise<LyricsBuildResult> {
  if (session.songs.length === 0) return { payload: null, reason: 'empty' }
  if (session.songs.length > MAX_SHARED_LYRICS_SONGS) {
    return { payload: null, reason: 'too_many' }
  }
  if (session.songs.some((item) => item.status !== 'ok')) return { payload: null }

  const songsData = new Map<string, Song>()
  for (const item of session.songs) {
    const song = await getSong(item.url)
    if (!song) return { payload: null }
    songsData.set(item.entryId || item.url, song)
    songsData.set(item.url, song)
  }

  return { payload: buildSharedLyricsPayload(session, songsData) }
}

export function createLyricsSync(deps: LyricsSyncDeps): SetLinkSync {
  return createSyncChannel<SharedLyricsPayload>({
    ...deps,
    name: 'lyrics-publish',
    shouldSync: async (session) => {
      if (session.liveSourceId) return false
      return (await deps.identity.get(session.id)) !== null
    },
    buildPayload: (session) => buildLyricsSyncPayload(session, deps.getSong),
    publish: (identity, payload, options) =>
      deps.api(identity.publicId, identity.secret, payload, options),
    hash: hashSharedLyricsPayload,
  })
}

export function createLyricsIdentityAccess(): SyncChannelDeps<SharedLyricsPayload>['identity'] {
  return {
    get: async (sessionId) => {
      const record = await getLyricsPublicationIdentity(sessionId)
      if (!record?.expiresAt) return null
      return {
        sessionId,
        publicId: record.publicationId,
        secret: record.updateSecret,
        lastPublishedHash: record.lastPublishedHash,
        expiresAt: record.expiresAt,
      }
    },
    update: async (sessionId, patch) => {
      const record = await getLyricsPublicationIdentity(sessionId)
      if (record) await saveLyricsPublicationIdentity({ ...record, ...patch })
    },
    remove: (sessionId) => deleteLyricsPublicationIdentity(sessionId),
  }
}

function createDefaultSync(): SetLinkSync {
  return createLyricsSync({
    store: sessionStore,
    identity: createLyricsIdentityAccess(),
    api: putSharedLyricsApi,
    getSong: (url) => songCache.getSong(url),
    now: () => Date.now(),
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    },
    withLock: withNamedLock,
    visibility:
      typeof document === 'undefined'
        ? undefined
        : {
            subscribe(onHidden) {
              const listener = () => {
                if (document.visibilityState === 'hidden') onHidden()
              }
              document.addEventListener('visibilitychange', listener)
              return () => document.removeEventListener('visibilitychange', listener)
            },
          },
  })
}

let defaultSync: SetLinkSync | undefined
let stopDefault: (() => void) | undefined

/** Wires automatic lyrics updates to the session store. Idempotent; call once at app startup. */
export function startLyricsSync(): () => void {
  if (stopDefault) return stopDefault
  defaultSync ??= createDefaultSync()
  const stop = defaultSync.start()
  stopDefault = () => {
    stop()
    stopDefault = undefined
  }
  return stopDefault
}

/** Publishes now (no debounce) if never published, changed, or close to expiring. Never throws. */
export async function ensureLyricsFresh(session: Session): Promise<EnsureFreshResult> {
  try {
    defaultSync ??= createDefaultSync()
    return await defaultSync.ensureFresh(session)
  } catch {
    return { ok: false, reason: 'failed' }
  }
}
