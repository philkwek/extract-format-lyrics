import { getLiveSetApi, ShareApiError, type GetLiveSetResult } from './api'
import { buildLivePayload, hashLivePayload } from './liveShareSync'
import { sessionStore, type Session, type SessionSongItem } from './sessionStore'
import { sessionSongsFromSnapshot } from './shareSnapshot'
import { songCache } from './songCache'
import type { LiveSetManifest, LiveSongContent, SharedSetSnapshot, Song } from '../types/song'

export type LiveFollowResult =
  | { kind: 'opened'; session: Session }
  | { kind: 'reused'; session: Session }
  | { kind: 'expired' }
  | { kind: 'missing' }
  | { kind: 'stopped' }

export interface LiveFollowDeps {
  fetchLive: (id: string) => Promise<GetLiveSetResult>
  sessions: Pick<typeof sessionStore, 'findByLiveSourceId' | 'createSession' | 'updateSession' | 'getSession'>
  saveSong: (song: Song) => Promise<unknown>
  getSong: (url: string) => Promise<Song | null>
}

const defaultDeps: LiveFollowDeps = {
  fetchLive: getLiveSetApi,
  sessions: sessionStore,
  saveSong: (song) => songCache.saveSong(song),
  getSong: (url) => songCache.getSong(url),
}

/** Turns the host's manifest and content into set songs, caching each song for the session page. */
export async function applyLiveSet(
  response: GetLiveSetResult,
  deps: Pick<LiveFollowDeps, 'saveSong'> = defaultDeps,
): Promise<{ name: string; songs: SessionSongItem[] }> {
  const { manifest, contents } = response
  const present: SharedSetSnapshot['songs'] = []
  for (const entry of manifest.entries) {
    const content = contents[entry.contentHash]
    if (!content) continue
    await deps.saveSong(content.song)
    present.push({
      entryId: entry.entryId,
      song: content.song,
      customSections: content.customSections,
      customFlow: content.customFlow,
      customSimplifiedSections: content.customSimplifiedSections,
      customSimplifiedFlow: content.customSimplifiedFlow,
      targetKey: entry.targetKey,
      padKeyMode: entry.padKeyMode,
      customPadKey: entry.customPadKey,
      simplified: entry.simplified,
    })
  }
  const mapped = sessionSongsFromSnapshot({ v: 2, name: manifest.name, songs: present })
  let next = 0
  const songs = manifest.entries.map((entry): SessionSongItem =>
    contents[entry.contentHash]
      ? mapped[next++]
      : {
          entryId: entry.entryId,
          url: '',
          title: 'Song unavailable',
          status: 'error',
          errorMessage: 'The host’s version of this song could not be loaded.',
        },
  )
  return { name: manifest.name, songs }
}

/** Replaces the set's songs and name with the host's version, keeping its id and public id. */
export async function refreshFromLiveSet(
  session: Session,
  response: GetLiveSetResult,
  deps: LiveFollowDeps = defaultDeps,
): Promise<Session> {
  const { name, songs } = await applyLiveSet(response, deps)
  session.name = name
  session.songs = songs
  session.liveRev = response.manifest.rev
  const { payload } = await buildLivePayload(session, deps.getSong)
  session.lastHostHash = payload ? await hashLivePayload(payload) : undefined
  await deps.sessions.updateSession(session)
  return session
}

export async function openLiveShare(
  liveId: string,
  options: { deps?: LiveFollowDeps } = {},
): Promise<LiveFollowResult> {
  const deps = options.deps ?? defaultDeps
  const existing = await deps.sessions.findByLiveSourceId(liveId)

  if (existing) {
    if (existing.followHost === true) {
      try {
        const response = await deps.fetchLive(liveId)
        if (response.manifest.status === 'stopped') return { kind: 'reused', session: existing }
        if (response.manifest.rev > (existing.liveRev ?? 0)) {
          await refreshFromLiveSet(existing, response, deps)
        }
      } catch {
        // Offline or expired: the local copy still opens.
      }
    }
    return { kind: 'reused', session: existing }
  }

  let response: GetLiveSetResult
  try {
    response = await deps.fetchLive(liveId)
  } catch (err) {
    if (err instanceof ShareApiError && err.code === 'EXPIRED') return { kind: 'expired' }
    if (err instanceof ShareApiError && err.code === 'NOT_FOUND') return { kind: 'missing' }
    throw err
  }
  if (response.manifest.status === 'stopped') return { kind: 'stopped' }

  const { name, songs } = await applyLiveSet(response, deps)
  const session = await deps.sessions.createSession(songs, name, {
    liveSourceId: liveId,
    followHost: true,
    liveRev: response.manifest.rev,
  })
  const { payload } = await buildLivePayload(session, deps.getSong)
  if (payload) {
    session.lastHostHash = await hashLivePayload(payload)
    await deps.sessions.updateSession(session)
  }
  return { kind: 'opened', session }
}

const inFlight = new Map<string, Promise<LiveFollowResult>>()

/** Shares one open per live id, so StrictMode's double effect never imports twice. */
export function openLiveShareOnce(
  liveId: string,
  options: { deps?: LiveFollowDeps } = {},
): Promise<LiveFollowResult> {
  let promise = inFlight.get(liveId)
  if (!promise) {
    promise = openLiveShare(liveId, options).finally(() => inFlight.delete(liveId))
    inFlight.set(liveId, promise)
  }
  return promise
}

export async function stopFollowing(
  sessionId: string,
  deps: Pick<LiveFollowDeps, 'sessions'> = defaultDeps,
): Promise<Session | null> {
  const session = await deps.sessions.getSession(sessionId)
  if (!session) return null
  session.followHost = false
  await deps.sessions.updateSession(session)
  return session
}

/** True when the set differs from the last host version applied. */
export async function hasLocalEdits(
  session: Session,
  deps: Pick<LiveFollowDeps, 'getSong'> = defaultDeps,
): Promise<boolean> {
  const { payload } = await buildLivePayload(session, deps.getSong)
  return (payload ? await hashLivePayload(payload) : undefined) !== session.lastHostHash
}

export type ResumeResult =
  | { kind: 'resumed'; session: Session }
  | { kind: 'expired' | 'missing' | 'stopped' }

/** Fetches the host's version, replaces local edits with it and turns following back on. */
export async function resumeFollowing(
  sessionId: string,
  options: { deps?: LiveFollowDeps } = {},
): Promise<ResumeResult> {
  const deps = options.deps ?? defaultDeps
  const session = await deps.sessions.getSession(sessionId)
  if (!session?.liveSourceId) return { kind: 'missing' }
  let response: GetLiveSetResult
  try {
    response = await deps.fetchLive(session.liveSourceId)
  } catch (err) {
    const kind = gone(err)
    if (kind) return { kind }
    throw err
  }
  if (response.manifest.status === 'stopped') return { kind: 'stopped' }
  session.followHost = true
  return { kind: 'resumed', session: await refreshFromLiveSet(session, response, deps) }
}

function gone(err: unknown): 'expired' | 'missing' | null {
  if (!(err instanceof ShareApiError)) return null
  if (err.code === 'EXPIRED' || err.status === 410) return 'expired'
  if (err.code === 'NOT_FOUND' || err.status === 404) return 'missing'
  return null
}

export type FollowStatus = 'live' | 'reconnecting' | 'stopped' | 'expired'

export interface FollowHandlers {
  onUpdate: (session: Session) => void
  onStatus: (status: FollowStatus) => void
  /** While true, received updates are held until flushDeferred or dropDeferred. */
  shouldDefer?: () => boolean
}

export interface FollowDeps extends LiveFollowDeps {
  /** Null when Firestore is not configured: only polling runs. */
  subscribeManifest:
    | ((
        liveId: string,
        onNext: (manifest: LiveSetManifest) => void,
        onError: (err: unknown) => void,
      ) => Promise<() => void>)
    | null
  getContent: (liveId: string, hash: string) => Promise<LiveSongContent | null>
  pollMs: number
}

export interface FollowController {
  stop: () => void
  flushDeferred: () => void
  dropDeferred: () => void
}

function firebaseConfig() {
  const { VITE_FIREBASE_API_KEY: apiKey, VITE_FIREBASE_APP_ID: appId } = import.meta.env
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
  return apiKey && appId && projectId ? { apiKey, appId, projectId } : null
}

/** Splits a local `host:port` emulator address; anything else means "use the real project". */
export function parseEmulatorHost(
  value: string | undefined,
): { host: string; port: number } | null {
  const match = /^([\w.-]+):(\d{1,5})$/.exec(value ?? '')
  return match ? { host: match[1], port: Number(match[2]) } : null
}

let firestore: Promise<typeof import('firebase/firestore') & { db: unknown }> | undefined

function loadFirestore() {
  firestore ??= (async () => {
    const [{ getApps, initializeApp }, fs] = await Promise.all([
      import('firebase/app'),
      import('firebase/firestore'),
    ])
    const app = getApps()[0] ?? initializeApp(firebaseConfig()!)
    const db = fs.getFirestore(app)
    const emulator = import.meta.env.DEV
      ? parseEmulatorHost(import.meta.env.VITE_FIRESTORE_EMULATOR_HOST)
      : null
    if (emulator) fs.connectFirestoreEmulator(db, emulator.host, emulator.port)
    return { ...fs, db }
  })().catch((err) => {
    firestore = undefined
    throw err
  })
  return firestore
}

const defaultFollowDeps: FollowDeps = {
  ...defaultDeps,
  subscribeManifest: firebaseConfig()
    ? async (liveId, onNext, onError) => {
        const { db, doc, onSnapshot } = await loadFirestore()
        return onSnapshot(
          doc(db as never, 'liveSets', liveId),
          (snap) => {
            if (snap.exists()) onNext(snap.data() as LiveSetManifest)
          },
          onError,
        )
      }
    : null,
  getContent: async (liveId, hash) => {
    const { db, doc, getDoc } = await loadFirestore()
    const snap = await getDoc(doc(db as never, 'liveSetSongs', `${liveId}_${hash}`))
    if (!snap.exists()) return null
    const { song, customSections, customFlow, customSimplifiedSections, customSimplifiedFlow } =
      snap.data() as LiveSongContent
    return { song, customSections, customFlow, customSimplifiedSections, customSimplifiedFlow }
  },
  pollMs: 30_000,
}

/** Keeps a followed set current: one catch-up fetch, then a live listener with a polling fallback. */
export function followLiveSet(
  session: Session,
  handlers: FollowHandlers,
  options: { deps?: FollowDeps } = {},
): FollowController {
  const deps = options.deps ?? defaultFollowDeps
  const liveId = session.liveSourceId!
  const known = new Map<string, LiveSongContent>()
  let stopped = false
  let applied = session.liveRev ?? 0
  let queued: LiveSetManifest | null = null
  let held: LiveSetManifest | null = null
  let applying = false
  let status: FollowStatus | undefined
  let unsubscribe: (() => void) | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  const setStatus = (next: FollowStatus) => {
    if (stopped || status === next) return
    status = next
    handlers.onStatus(next)
  }

  const fail = (err: unknown) => {
    if (gone(err)) {
      setStatus('expired')
      stopPolling()
    } else {
      setStatus('reconnecting')
      startPolling()
    }
  }

  async function drain() {
    applying = true
    try {
      while (queued && !stopped) {
        const manifest = queued
        queued = null
        if (manifest.rev <= applied) continue
        try {
          const missing = manifest.entries.map((e) => e.contentHash).filter((h) => !known.has(h))
          await Promise.all(
            [...new Set(missing)].map(async (hash) => {
              const content = await deps.getContent(liveId, hash)
              if (!content) throw new Error('Song content is not there yet')
              known.set(hash, content)
            }),
          )
          const latest = await deps.sessions.getSession(session.id)
          if (stopped || !latest || latest.followHost === false) continue
          const contents = Object.fromEntries(
            manifest.entries.map((e) => [e.contentHash, known.get(e.contentHash)!]),
          )
          const next = await refreshFromLiveSet(
            latest,
            { id: liveId, manifest, contents, expiresAt: '' },
            deps,
          )
          if (stopped) continue
          applied = manifest.rev
          const used = new Set(manifest.entries.map((e) => e.contentHash))
          for (const hash of known.keys()) if (!used.has(hash)) known.delete(hash)
          setStatus('live')
          handlers.onUpdate(next)
        } catch (err) {
          fail(err)
        }
      }
    } finally {
      applying = false
    }
  }

  function receive(manifest: LiveSetManifest) {
    if (stopped) return
    if (manifest.status === 'stopped') return setStatus('stopped')
    if (manifest.rev <= 0 || manifest.rev <= applied) return
    if (handlers.shouldDefer?.()) {
      if (!held || manifest.rev > held.rev) held = manifest
      return
    }
    if (queued && queued.rev >= manifest.rev) return
    queued = manifest
    if (!applying) void drain()
  }

  async function fetchAndReceive() {
    try {
      const response = await deps.fetchLive(liveId)
      for (const [hash, content] of Object.entries(response.contents)) known.set(hash, content)
      if (status === 'reconnecting' && response.manifest.status !== 'stopped') setStatus('live')
      receive(response.manifest)
    } catch (err) {
      fail(err)
    }
  }

  function onVisible() {
    if (document.visibilityState === 'visible') void fetchAndReceive()
  }

  function startPolling() {
    if (timer || stopped) return
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') void fetchAndReceive()
    }, deps.pollMs)
    document.addEventListener('visibilitychange', onVisible)
  }

  function stopPolling() {
    clearInterval(timer)
    timer = undefined
    document.removeEventListener('visibilitychange', onVisible)
  }

  void (async () => {
    setStatus('live')
    await fetchAndReceive()
    if (stopped || status === 'expired') return
    if (!deps.subscribeManifest) return startPolling()
    try {
      const off = await deps.subscribeManifest(liveId, receive, fail)
      if (stopped) off()
      else unsubscribe = off
    } catch (err) {
      fail(err)
    }
  })()

  return {
    stop() {
      stopped = true
      queued = held = null
      unsubscribe?.()
      unsubscribe = undefined
      stopPolling()
    },
    flushDeferred() {
      const manifest = held
      held = null
      if (manifest) receive(manifest)
    },
    dropDeferred() {
      held = null
    },
  }
}
