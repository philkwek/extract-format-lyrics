import type { LiveSetManifestInput, LiveSongContent, Song } from '../types/song'
import { canonicalLiveSongContent } from '../../functions/src/liveSetContent'
import { sessionStore, type Session } from './sessionStore'
import {
  deleteLiveSetApi,
  LiveSetMissingContentError,
  putLiveSetManifestApi,
  putLiveSetSongApi,
  ShareApiError,
} from './api'
import {
  createSyncChannel,
  SET_LINK_MAX_SONGS,
  SET_LINK_NAME_MAX,
  type SetLinkSync,
  type SyncChannelDeps,
} from './setLinkSync'
import {
  deriveSetLinkId,
  generateSetLinkSecret,
  getSetLinkIdentityStore,
  LIVE_SET_DOMAIN_SEPARATOR,
  type SetLinkIdentityRecord,
} from './setLinkIdentity'
import { withNamedLock } from './lyricsPublishIdentity'
import { snapshotEntry } from './shareSnapshot'
import { songCache } from './songCache'

export const LIVE_SHARE_MAX_SONGS = SET_LINK_MAX_SONGS

export interface LiveIdentityRecord extends SetLinkIdentityRecord {
  /** Content hashes the server is known to hold, pruned to the current set. */
  knownContentHashes?: string[]
}

export interface LivePayload {
  manifest: LiveSetManifestInput
  contents: Map<string, LiveSongContent>
}

export type LiveShareStatus = 'ok' | 'failing'

const liveKey = (sessionId: string) => `live:${sessionId}`

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Must equal the server's hashLiveSongContent for the same content. */
export function hashLiveSongContent(content: LiveSongContent): Promise<string> {
  return sha256Hex(canonicalLiveSongContent(content))
}

/** The manifest already carries every content hash, so hashing it covers both. */
export function hashLivePayload(payload: LivePayload): Promise<string> {
  return sha256Hex(JSON.stringify(payload.manifest))
}

export async function buildLivePayload(
  session: Session,
  getSong: (url: string) => Promise<Song | null>
): Promise<{ payload: LivePayload | null }> {
  const contents = new Map<string, LiveSongContent>()
  const entries: LiveSetManifestInput['entries'] = []
  for (const item of session.songs) {
    if (item.status === 'error') continue
    const song = await getSong(item.url)
    if (!song) continue
    const e = snapshotEntry(item, song)
    const { entryId, targetKey, simplified, padKeyMode, customPadKey } = e
    const content: LiveSongContent = {
      song,
      customSections: e.customSections,
      customFlow: e.customFlow,
      customSimplifiedSections: e.customSimplifiedSections,
      customSimplifiedFlow: e.customSimplifiedFlow,
    }
    const contentHash = await hashLiveSongContent(content)
    contents.set(contentHash, content)
    const entry: LiveSetManifestInput['entries'][number] = { entryId, contentHash }
    if (targetKey !== undefined) entry.targetKey = targetKey
    if (simplified !== undefined) entry.simplified = simplified
    if (padKeyMode !== undefined) entry.padKeyMode = padKeyMode
    if (customPadKey !== undefined) entry.customPadKey = customPadKey
    entries.push(entry)
  }
  if (entries.length === 0 || entries.length > LIVE_SHARE_MAX_SONGS) return { payload: null }
  const name = session.name.trim().slice(0, SET_LINK_NAME_MAX) || 'Untitled set'
  return { payload: { manifest: { v: 1, name, entries }, contents } }
}

export interface LiveIdentityAccess {
  get(sessionId: string): Promise<LiveIdentityRecord | null>
  update(sessionId: string, patch: Partial<LiveIdentityRecord>): Promise<void>
  remove(sessionId: string): Promise<void>
}

export interface LiveShareApi {
  putSong: (id: string, secret: string, hash: string, content: LiveSongContent) => Promise<unknown>
  putManifest: (
    id: string,
    secret: string,
    manifest: LiveSetManifestInput,
    options: { keepalive?: boolean }
  ) => Promise<{ expiresAt: string }>
}

export interface LiveShareSyncDeps {
  store: SyncChannelDeps<LivePayload>['store']
  identity: LiveIdentityAccess
  api: LiveShareApi
  getSong: (url: string) => Promise<Song | null>
  now: () => number
  timers: SyncChannelDeps<LivePayload>['timers']
  random?: () => number
  withLock: SyncChannelDeps<LivePayload>['withLock']
  visibility?: SyncChannelDeps<LivePayload>['visibility']
  onStatus?: (sessionId: string, status: LiveShareStatus) => void
}

export function createLiveShareSync(deps: LiveShareSyncDeps): SetLinkSync {
  async function publish(
    identity: LiveIdentityRecord,
    { manifest, contents }: LivePayload,
    options: { keepalive?: boolean }
  ): Promise<{ expiresAt: string }> {
    const { publicId, secret, sessionId } = identity
    const uploaded = new Set<string>()
    const known = new Set(identity.knownContentHashes)
    const upload = async (hash: string) => {
      const content = contents.get(hash)
      if (!content) return
      await deps.api.putSong(publicId, secret, hash, content)
      uploaded.add(hash)
    }
    for (const hash of contents.keys()) if (!known.has(hash)) await upload(hash)

    let result: { expiresAt: string }
    try {
      result = await deps.api.putManifest(publicId, secret, manifest, options)
    } catch (error) {
      if (!(error instanceof LiveSetMissingContentError)) throw error
      for (const hash of error.missing) await upload(hash)
      result = await deps.api.putManifest(publicId, secret, manifest, options)
    }
    const knownContentHashes = [...new Set([...known, ...uploaded])].filter((h) => contents.has(h))
    await deps.identity.update(sessionId, { knownContentHashes })
    return result
  }

  return createSyncChannel<LivePayload>({
    ...deps,
    name: 'live-set',
    // Task 6b adds "and not following" here.
    shouldSync: async (session) => (await deps.identity.get(session.id)) !== null,
    buildPayload: (session) => buildLivePayload(session, deps.getSong),
    publish,
    hash: hashLivePayload,
  })
}

function createLiveIdentityAccess(): LiveIdentityAccess {
  return {
    get: (id) => getSetLinkIdentityStore().get<LiveIdentityRecord>(liveKey(id)).then((r) => r ?? null),
    async update(id, patch) {
      const store = getSetLinkIdentityStore()
      const record = await store.get<LiveIdentityRecord>(liveKey(id))
      if (record) await store.set(liveKey(id), { ...record, ...patch })
    },
    remove: (id) => getSetLinkIdentityStore().del(liveKey(id)),
  }
}

const statuses = new Map<string, LiveShareStatus>()
const statusListeners = new Map<string, Set<(status: LiveShareStatus) => void>>()

function setStatus(sessionId: string, status: LiveShareStatus): void {
  if (statuses.get(sessionId) === status) return
  statuses.set(sessionId, status)
  statusListeners.get(sessionId)?.forEach((cb) => cb(status))
}

export function subscribeLiveShareStatus(
  sessionId: string,
  cb: (status: LiveShareStatus) => void
): () => void {
  let set = statusListeners.get(sessionId)
  if (!set) statusListeners.set(sessionId, (set = new Set()))
  set.add(cb)
  return () => {
    set.delete(cb)
    if (set.size === 0) statusListeners.delete(sessionId)
  }
}

const liveListeners = new Map<string, Set<() => void>>()

/** Fires when a live share starts or stops for this set. */
export function subscribeLiveShare(sessionId: string, cb: () => void): () => void {
  let set = liveListeners.get(sessionId)
  if (!set) liveListeners.set(sessionId, (set = new Set()))
  set.add(cb)
  return () => {
    set.delete(cb)
    if (set.size === 0) liveListeners.delete(sessionId)
  }
}

const liveIdentity = createLiveIdentityAccess()

function createDefaultSync(): SetLinkSync {
  return createLiveShareSync({
    store: sessionStore,
    identity: liveIdentity,
    api: {
      putSong: putLiveSetSongApi,
      putManifest: putLiveSetManifestApi,
    },
    getSong: (url) => songCache.getSong(url),
    now: () => Date.now(),
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    },
    withLock: withNamedLock,
    onStatus: setStatus,
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

/** Wires live shares to the session store. Idempotent; call once at app startup. */
export function startLiveShareSync(): () => void {
  if (stopDefault) return stopDefault
  defaultSync ??= createDefaultSync()
  const stop = defaultSync.start()
  stopDefault = () => {
    stop()
    stopDefault = undefined
  }
  return stopDefault
}

const liveUrl = (publicId: string) => `${window.location.origin}/live/${publicId}`

export async function getLiveShare(sessionId: string): Promise<string | null> {
  const record = await liveIdentity.get(sessionId)
  return record ? liveUrl(record.publicId) : null
}

/** Creates the live identity, publishes now, and returns the link. */
export async function startLiveShare(
  sessionId: string
): Promise<{ url: string; expiresAt: string }> {
  const session = await sessionStore.getSession(sessionId)
  if (!session) throw new Error('This set no longer exists.')
  const record = await withNamedLock(`live-identity:${sessionId}`, async () => {
    const existing = await liveIdentity.get(sessionId)
    if (existing) return existing
    const secret = generateSetLinkSecret()
    const created: LiveIdentityRecord = {
      sessionId,
      publicId: await deriveSetLinkId(secret, LIVE_SET_DOMAIN_SEPARATOR),
      secret,
    }
    await getSetLinkIdentityStore().set(liveKey(sessionId), created)
    return created
  })
  defaultSync ??= createDefaultSync()
  await defaultSync.ensureFresh(session)
  const published = await liveIdentity.get(sessionId)
  if (!published?.expiresAt) {
    await liveIdentity.remove(sessionId)
    throw new ShareApiError('Could not start the live share. Check your connection and try again.')
  }
  liveListeners.get(sessionId)?.forEach((cb) => cb())
  return { url: liveUrl(record.publicId), expiresAt: published.expiresAt }
}

/** Tells the server to stop, then forgets the identity. A network failure keeps it so you can retry. */
export async function stopLiveShare(sessionId: string): Promise<void> {
  const record = await liveIdentity.get(sessionId)
  if (!record) return
  try {
    await deleteLiveSetApi(record.publicId, record.secret)
  } catch (error) {
    // A 4xx (other than rate limits) means the server will never accept it; don't trap the host.
    const status = error instanceof ShareApiError ? (error.status ?? 0) : 0
    if (status < 400 || status >= 500 || status === 429) throw error
  }
  await liveIdentity.remove(sessionId)
  statuses.delete(sessionId)
  liveListeners.get(sessionId)?.forEach((cb) => cb())
}
