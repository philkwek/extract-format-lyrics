import type { SetLinkPayload, SetLinkSong } from '../types/song'
import type { Session, SessionChangeEvent } from './sessionStore'
import { sessionStore } from './sessionStore'
import { putSetLinkApi, ShareApiError, type PutSetLinkResult } from './api'
import {
  deleteSetLinkIdentity,
  getSetLinkIdentity,
  getSetLinkIdentityStore,
  saveSetLinkIdentity,
  type SetLinkIdentityRecord,
} from './setLinkIdentity'
import { withNamedLock } from './lyricsPublishIdentity'
import { trackEvent } from './analytics'

export const SET_LINK_MAX_SONGS = 30
export const SET_LINK_NAME_MAX = 200
export const SET_LINK_DEBOUNCE_MS = 1500
export const SET_LINK_RETRY_DELAYS_MS = [5_000, 30_000, 120_000]
export const SET_LINK_RATE_LIMIT_DEFAULT_WAIT_MS = 120_000
export const SET_LINK_RATE_LIMIT_GIVE_UP_SECONDS = 600
export const SET_LINK_MIN_SPACING_MS = 5_000
export const SET_LINK_JITTER_MAX_MS = 500
export const SET_LINK_REFRESH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

export type SetLinkTrigger = 'create' | 'update' | 'refresh'

export interface BuildSetLinkPayloadResult {
  payload: SetLinkPayload | null
  skippedUploads: number
  reason?: 'empty' | 'too_many'
}

export type SetLinkUnavailableReason = NonNullable<BuildSetLinkPayloadResult['reason']> | 'failed'

export type EnsureFreshResult =
  | { ok: true }
  | { ok: false; reason: SetLinkUnavailableReason }

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

/** Pure: only URLs and per-song set choices, never edited sections or flows. */
export function buildSetLinkPayload(session: Session): BuildSetLinkPayloadResult {
  const songs: SetLinkSong[] = []
  let skippedUploads = 0
  for (const item of session.songs) {
    if (item.status === 'error') continue
    if (!item.url || !isHttpUrl(item.url)) {
      if (item.url?.startsWith('upload://')) skippedUploads++
      continue
    }
    const song: SetLinkSong = { entryId: item.entryId ?? '', url: item.url }
    if (item.title !== undefined) song.title = item.title
    if (item.artist !== undefined) song.artist = item.artist
    if (item.targetKey !== undefined) song.targetKey = item.targetKey
    if (item.simplified !== undefined) song.simplified = item.simplified
    if (item.padKeyMode !== undefined) song.padKeyMode = item.padKeyMode
    if (item.customPadKey !== undefined) song.customPadKey = item.customPadKey
    songs.push(song)
  }
  if (songs.length === 0) return { payload: null, skippedUploads, reason: 'empty' }
  if (songs.length > SET_LINK_MAX_SONGS) return { payload: null, skippedUploads, reason: 'too_many' }
  const name = session.name.trim().slice(0, SET_LINK_NAME_MAX)
  return { payload: { v: 1, name, songs }, skippedUploads }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const parts = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    return `{${parts.join(',')}}`
  }
  return JSON.stringify(value)
}

export async function hashSetLinkPayload(payload: SetLinkPayload): Promise<string> {
  const data = new TextEncoder().encode(canonicalJson(payload))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export interface SetLinkSyncIdentity {
  get(sessionId: string): Promise<SetLinkIdentityRecord | null>
  /** Merges bookkeeping into an existing record; no-op when the record is gone. */
  update(
    sessionId: string,
    patch: Pick<SetLinkIdentityRecord, 'lastPublishedHash' | 'expiresAt'>
  ): Promise<void>
  remove(sessionId: string): Promise<void>
}

type MaybePromise<T> = T | Promise<T>

export interface SyncChannelDeps<P> {
  /** Names the lock key, state and log prefix, so channels never collide. */
  name: string
  store: { subscribe(listener: (event: SessionChangeEvent) => void): () => void }
  identity: SetLinkSyncIdentity
  /** Sessions that return false are never published on this channel. */
  shouldSync?: (session: Session) => boolean | Promise<boolean>
  buildPayload: (
    session: Session
  ) => MaybePromise<{ payload: P | null; skippedUploads?: number; reason?: 'empty' | 'too_many' }>
  /** Public id the session must carry to be published; absent means no check. */
  expectedPublicId?: (session: Session) => string | undefined
  publish: (
    identity: SetLinkIdentityRecord,
    payload: P,
    options: { keepalive?: boolean }
  ) => Promise<{ expiresAt: string }>
  /** 'failing' once retries give up or the error can't be retried; 'ok' after a publish. */
  onStatus?: (sessionId: string, status: 'ok' | 'failing') => void
  /** Called when buildPayload has nothing to publish, so a channel can report its status. */
  onSkipped?: (sessionId: string, reason?: 'empty' | 'too_many') => void
  onPublished?: (info: { payload: P; skippedUploads: number; trigger: SetLinkTrigger }) => void
  now: () => number
  timers: {
    setTimeout: (fn: () => void, ms: number) => unknown
    clearTimeout: (handle: unknown) => void
  }
  hash: (payload: P) => Promise<string>
  /** Jitter source in [0, 1); injectable for tests. */
  random?: () => number
  withLock: <T>(name: string, fn: () => Promise<T>) => Promise<T>
  /** Only used to flush on page hide; absent in non-DOM environments. */
  visibility?: {
    subscribe(onHidden: () => void): () => void
  }
}

export interface SetLinkSyncDeps {
  store: SyncChannelDeps<SetLinkPayload>['store']
  identity: SetLinkSyncIdentity
  api: (
    id: string,
    secret: string,
    payload: SetLinkPayload,
    options: { keepalive?: boolean }
  ) => Promise<PutSetLinkResult>
  now: () => number
  timers: SyncChannelDeps<SetLinkPayload>['timers']
  hash: (payload: SetLinkPayload) => Promise<string>
  random?: () => number
  withLock: SyncChannelDeps<SetLinkPayload>['withLock']
  track: (
    name: 'set_link_published',
    params: { song_count: number; skipped_uploads: number; trigger: SetLinkTrigger }
  ) => void
  visibility?: SyncChannelDeps<SetLinkPayload>['visibility']
}

interface SessionSyncState {
  latest?: Session
  debounce?: unknown
  retry?: unknown
  spaced?: unknown
  lastAttemptAt?: number
  inFlight?: Promise<EnsureFreshResult>
  dirty: boolean
  failures: number
  trigger: SetLinkTrigger
  refresh: boolean
}

export interface SetLinkSync {
  start(): () => void
  handleEvent(event: SessionChangeEvent): void
  ensureFresh(session: Session): Promise<EnsureFreshResult>
  /** Resolves when nothing is in flight; for tests and shutdown. */
  idle(): Promise<void>
}

function nonRetryable(error: unknown): boolean {
  if (!(error instanceof ShareApiError)) return false
  return [400, 401, 403, 410, 413].includes(error.status ?? 0)
}

export function createSyncChannel<P>(deps: SyncChannelDeps<P>): SetLinkSync {
  const states = new Map<string, SessionSyncState>()
  const publishCounts = new Map<string, number>()

  function stateFor(sessionId: string): SessionSyncState {
    let st = states.get(sessionId)
    if (!st) {
      st = { dirty: false, failures: 0, trigger: 'update', refresh: false }
      states.set(sessionId, st)
    }
    return st
  }

  function clearTimers(st: SessionSyncState): void {
    if (st.debounce !== undefined) deps.timers.clearTimeout(st.debounce)
    if (st.retry !== undefined) deps.timers.clearTimeout(st.retry)
    if (st.spaced !== undefined) deps.timers.clearTimeout(st.spaced)
    st.debounce = undefined
    st.retry = undefined
    st.spaced = undefined
  }

  const expiresSoon = (identity: SetLinkIdentityRecord): boolean => {
    if (!identity.expiresAt) return true
    const t = Date.parse(identity.expiresAt)
    return !Number.isFinite(t) || t - deps.now() < SET_LINK_REFRESH_WINDOW_MS
  }

  function scheduleRetry(sessionId: string, st: SessionSyncState, error: unknown): void {
    const giveUp = () => deps.onStatus?.(sessionId, 'failing')
    if (nonRetryable(error)) return giveUp()
    let delay: number
    if (error instanceof ShareApiError && error.status === 429) {
      // Rate limits do not spend the 5xx/network backoff budget.
      const seconds = error.retryAfterSeconds
      if (seconds === undefined) {
        delay = SET_LINK_RATE_LIMIT_DEFAULT_WAIT_MS
      } else if (seconds > SET_LINK_RATE_LIMIT_GIVE_UP_SECONDS) {
        return giveUp() // Daily cap: wait for the next real change or open.
      } else {
        const jitter = Math.floor((deps.random?.() ?? Math.random()) * SET_LINK_JITTER_MAX_MS)
        delay = Math.max(seconds, 1) * 1000 + jitter
        // The server told us exactly when it will accept a write; align spacing to that.
        st.lastAttemptAt = deps.now() + delay - SET_LINK_MIN_SPACING_MS
      }
    } else {
      st.failures++
      if (st.failures > SET_LINK_RETRY_DELAYS_MS.length) return giveUp()
      delay = SET_LINK_RETRY_DELAYS_MS[st.failures - 1]
    }
    if (st.retry !== undefined) deps.timers.clearTimeout(st.retry)
    st.retry = deps.timers.setTimeout(() => {
      st.retry = undefined
      void run(sessionId, { keepalive: false })
    }, delay)
  }

  async function publishOnce(
    sessionId: string,
    st: SessionSyncState,
    keepalive: boolean
  ): Promise<EnsureFreshResult> {
    const session = st.latest
    if (!session) return { ok: false, reason: 'failed' }
    if (deps.shouldSync && !(await deps.shouldSync(session))) {
      return { ok: false, reason: 'failed' }
    }
    const { payload, skippedUploads = 0, reason } = await deps.buildPayload(session)
    if (!payload) {
      deps.onSkipped?.(sessionId, reason)
      return { ok: false, reason: reason ?? 'failed' }
    }
    const hash = await deps.hash(payload)
    const trigger = st.trigger
    const refresh = st.refresh
    return deps.withLock(`${deps.name}:${sessionId}`, async (): Promise<EnsureFreshResult> => {
      // Re-read inside the lock so a second tab that already published the same state skips.
      const identity = await deps.identity.get(sessionId)
      if (!identity) return { ok: false, reason: 'failed' }
      const expected = deps.expectedPublicId?.(session)
      if (expected && expected !== identity.publicId) {
        // Publishing would go to an id nobody's URL points at; skip rather than write blindly.
        console.warn(`[${deps.name}] publicId mismatch for ${sessionId}; not publishing`)
        return { ok: false, reason: 'failed' }
      }
      if (identity.lastPublishedHash === hash && !(refresh && expiresSoon(identity))) {
        return { ok: true }
      }
      st.lastAttemptAt = deps.now()
      const result = await deps.publish(identity, payload, { keepalive })
      await deps.identity.update(sessionId, {
        lastPublishedHash: hash,
        expiresAt: result.expiresAt,
      })
      st.failures = 0
      deps.onStatus?.(sessionId, 'ok')
      st.refresh = false
      st.trigger = 'update'
      const count = (publishCounts.get(sessionId) ?? 0) + 1
      publishCounts.set(sessionId, count)
      if (import.meta.env?.DEV && import.meta.env.MODE !== 'test') {
        console.debug(`[${deps.name}] publish #${count} for ${sessionId}`)
      }
      deps.onPublished?.({ payload, skippedUploads, trigger })
      return { ok: true }
    })
  }

  function run(sessionId: string, opts: { keepalive: boolean }): Promise<EnsureFreshResult> {
    const st = stateFor(sessionId)
    if (st.inFlight) {
      st.dirty = true
      return st.inFlight
    }
    if (st.lastAttemptAt !== undefined) {
      const wait = st.lastAttemptAt + SET_LINK_MIN_SPACING_MS - deps.now()
      if (wait > 0) {
        // Too soon after the previous attempt: publish the latest state once spacing allows.
        if (st.debounce !== undefined) deps.timers.clearTimeout(st.debounce)
        st.debounce = undefined
        if (st.spaced === undefined) {
          st.spaced = deps.timers.setTimeout(() => {
            st.spaced = undefined
            void run(sessionId, { keepalive: false })
          }, wait)
        }
        return Promise.resolve({ ok: false, reason: 'failed' })
      }
    }
    clearTimers(st)
    const task = (async (): Promise<EnsureFreshResult> => {
      let outcome: EnsureFreshResult
      try {
        outcome = await publishOnce(sessionId, st, opts.keepalive)
      } catch (error) {
        st.dirty = false
        scheduleRetry(sessionId, st, error)
        outcome = { ok: false, reason: 'failed' }
      }
      st.inFlight = undefined
      if (outcome.ok && st.dirty) {
        st.dirty = false
        // At most one follow-up per settle; it re-checks the hash and no-ops if unchanged.
        return run(sessionId, { keepalive: false })
      }
      return outcome
    })()
    st.inFlight = task
    return task
  }

  function handleEvent(event: SessionChangeEvent): void {
    const { sessionId } = event
    if (event.type === 'deleted') {
      const st = states.get(sessionId)
      if (st) {
        clearTimers(st)
        st.dirty = false
        states.delete(sessionId)
      }
      publishCounts.delete(sessionId)
      void deps.identity.remove(sessionId).catch(() => {})
      return
    }
    if (!event.session) return
    const st = stateFor(sessionId)
    st.latest = event.session
    st.failures = 0
    if (event.type === 'created') {
      st.trigger = 'create'
      void run(sessionId, { keepalive: false })
      return
    }
    if (st.debounce !== undefined) deps.timers.clearTimeout(st.debounce)
    st.debounce = deps.timers.setTimeout(() => {
      st.debounce = undefined
      void run(sessionId, { keepalive: false })
    }, SET_LINK_DEBOUNCE_MS)
  }

  function flushPending(): void {
    for (const [sessionId, st] of states) {
      if (st.debounce === undefined) continue
      deps.timers.clearTimeout(st.debounce)
      st.debounce = undefined
      void run(sessionId, { keepalive: true })
    }
  }

  async function ensureFresh(session: Session): Promise<EnsureFreshResult> {
    const st = stateFor(session.id)
    st.latest = session
    st.failures = 0
    st.refresh = true
    if (st.trigger !== 'create') st.trigger = 'refresh'
    try {
      return await run(session.id, { keepalive: false })
    } catch {
      return { ok: false, reason: 'failed' }
    }
  }

  return {
    start() {
      const unsubscribe = deps.store.subscribe(handleEvent)
      const unVisibility = deps.visibility?.subscribe(flushPending)
      return () => {
        unsubscribe()
        unVisibility?.()
        for (const st of states.values()) clearTimers(st)
      }
    },
    handleEvent,
    ensureFresh,
    async idle() {
      for (;;) {
        const pending = [...states.values()].map((s) => s.inFlight).filter(Boolean)
        if (pending.length === 0) return
        await Promise.all(pending)
      }
    },
  }
}

export function createSetLinkSync(deps: SetLinkSyncDeps): SetLinkSync {
  return createSyncChannel<SetLinkPayload>({
    ...deps,
    name: 'set-link',
    shouldSync: (session) => session.followHost !== true,
    expectedPublicId: (s) => s.publicId,
    buildPayload: buildSetLinkPayload,
    publish: (identity, payload, options) =>
      deps.api(identity.publicId, identity.secret, payload, options),
    onPublished: ({ payload, skippedUploads, trigger }) =>
      deps.track('set_link_published', {
        song_count: payload.songs.length,
        skipped_uploads: skippedUploads,
        trigger,
      }),
  })
}

function createDefaultSync(): SetLinkSync {
  return createSetLinkSync({
    store: sessionStore,
    identity: {
      get: (id) => getSetLinkIdentity(id, getSetLinkIdentityStore()),
      async update(id, patch) {
        const store = getSetLinkIdentityStore()
        const record = await getSetLinkIdentity(id, store)
        if (record) await saveSetLinkIdentity({ ...record, ...patch }, store)
      },
      remove: (id) => deleteSetLinkIdentity(id, getSetLinkIdentityStore()),
    },
    api: putSetLinkApi,
    now: () => Date.now(),
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    },
    hash: hashSetLinkPayload,
    withLock: withNamedLock,
    track: trackEvent,
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

/** Wires the default sync to the session store. Idempotent; call once at app startup. */
export function startSetLinkSync(): () => void {
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
export async function ensureSetLinkFresh(session: Session): Promise<EnsureFreshResult> {
  try {
    defaultSync ??= createDefaultSync()
    const result = await defaultSync.ensureFresh(session)
    // 'failed' can also mean "too soon to publish again"; an earlier link may still be good.
    if (!result.ok && result.reason !== 'failed') return result
    const identity = await getSetLinkIdentity(session.id, getSetLinkIdentityStore())
    const expiresAt = identity?.expiresAt ? Date.parse(identity.expiresAt) : NaN
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return { ok: false, reason: 'failed' }
    }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}
