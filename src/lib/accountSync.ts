// Uploads local sets, pulls merged changes from the account, and reports what needs a choice.

import { get, set, del } from 'idb-keyval'
import type { Song } from '../types/song'
import type { AccountUser } from './auth'
import { onUser } from './auth'
import { ACCOUNT_MAX_SETS, checkSetLimits } from './accountLimits'
import { accountsEnabled } from './accountFlag'
import { loadFirestore } from './firestoreClient'
import { hashLiveSongContent } from './liveShareSync'
import { withNamedLock } from './lyricsPublishIdentity'
import {
  clashDiff,
  describeClash,
  mergeSet,
  sameSyncedSet,
  type ClashDiff,
  type SyncedEntry,
  type SyncedSet,
  type SyncedSongMeta,
} from './setMerge'
import { normalizeSongUrl, songCache } from './songCache'
import { sessionStore, type Session, type SessionChangeEvent } from './sessionStore'
import { setSyncStatus, type SyncStatus } from './syncStatus'

export interface SetConflict {
  /** Plain-English lines saying what clashed, e.g. "Both devices changed the key of Song A". */
  clashes: string[]
  /** Side-by-side comparison rows for the conflict dialog. */
  diffs?: ClashDiff[]
}

export interface SyncState {
  /** Open sets with a newer account version waiting behind **Update set**. */
  pendingRemote: ReadonlySet<string>
  /** Sets deleted on another device while this device had them (open or with unsynced edits). */
  deletedElsewhere: ReadonlySet<string>
  /** Sets that need the person to choose between this device and the account. */
  conflicts: ReadonlyMap<string, SetConflict>
}

const EMPTY: SyncState = {
  pendingRemote: new Set(),
  deletedElsewhere: new Set(),
  conflicts: new Map(),
}

export const ACCOUNT_SYNC_DEBOUNCE_MS = 1_500
const ACCOUNT_SYNC_LOCK = 'account-sync'
const OUTBOX_KEY = 'syncOutbox'
const BASE_PREFIX = 'syncBase:'
const CONFLICT_PREFIX = 'syncConflict:'

export interface RemoteSetSnapshot {
  rev: number
  data: string
  songCount: number
  updatedAt: number
  deletedAt?: number | null
}

export interface SetWriteDecision<T> {
  write: RemoteSetSnapshot | null
  /** Meta `setCount` move when the set becomes live or stops being live. */
  countDelta?: 1 | -1
  outcome: T
}

/** The small slice of Firestore the engine needs, so tests can supply their own store. */
export interface AccountFirestore {
  getSong(uid: string, contentHash: string): Promise<Song | null>
  ensureSong(uid: string, contentHash: string, song: Song): Promise<void>
  transactSet<T>(
    uid: string,
    setId: string,
    decide: (current: RemoteSetSnapshot | null, setCount: number) => SetWriteDecision<T>,
  ): Promise<T>
  subscribeSets(
    uid: string,
    onChange: (setId: string, snapshot: RemoteSetSnapshot | null) => void,
  ): () => void
}

export interface AccountSyncStore {
  subscribe(listener: (event: SessionChangeEvent) => void): () => void
  getAllSessions(): Promise<Session[]>
  getSession(id: string): Promise<Session | null>
  applyRemote(session: Session): Promise<void>
  removeRemote(id: string): Promise<void>
  setAccountUid(id: string, uid: string | undefined): Promise<void>
  createSetCopy(session: Session, options?: { accountUid?: string }): Promise<Session>
}

export interface AccountSongCache {
  getSong(url: string): Promise<Song | null>
  saveSong(song: Song, requestedUrl?: string): Promise<void>
  subscribe(listener: (url: string, song: Song) => void): () => void
}

export interface AccountKv {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
}

export interface AccountSyncDeps {
  store: AccountSyncStore
  songCache: AccountSongCache
  firestore: AccountFirestore
  kv: AccountKv
  timers: {
    setTimeout: (fn: () => void, ms: number) => unknown
    clearTimeout: (handle: unknown) => void
  }
  withLock: <T>(name: string, fn: () => Promise<T>) => Promise<T>
  onUser: (callback: (user: AccountUser | null) => void) => () => void
  online: () => boolean
  hashSong: (song: Song) => Promise<string>
  now: () => number
  setStatus: (status: SyncStatus) => void
}

interface BaseRecord {
  rev: number
  synced: SyncedSet
}

interface ConflictRecord extends SetConflict {
  remote: SyncedSet
  remoteRev: number
  localDeleted?: boolean
}

interface PendingRecord {
  remote: SyncedSet
  rev: number
  updatedAt: number
}

type BuildResult =
  { ok: true; synced: SyncedSet; songs: Map<string, Song> } | { ok: false; reason: string }
type BuiltLocal = Extract<BuildResult, { ok: true }>

type UploadOutcome =
  | { kind: 'written'; rev: number; synced: SyncedSet }
  | { kind: 'behind'; snapshot: RemoteSetSnapshot }
  | { kind: 'deleted' }
  | { kind: 'gone' }
  | { kind: 'skip' }
  | { kind: 'retry' }
  | { kind: 'tombstone'; outcome: TombstoneOutcome }

type TombstoneOutcome =
  | { kind: 'deleted' }
  | { kind: 'already' }
  | { kind: 'missing' }
  | {
      kind: 'conflict'
      remote: SyncedSet
      remoteRev: number
      remoteUpdatedAt: number
      clashes: string[]
      diffs?: ClashDiff[]
    }

export interface AccountSync {
  start(): () => void
  flush(): Promise<void>
  idle(): Promise<void>
  getSyncState(): SyncState
  subscribeSyncState(listener: (state: SyncState) => void): () => void
  setOpenSet(setId: string | null): void
  applyPendingRemote(setId: string): Promise<void>
  resolveConflict(setId: string, choice: 'keep-local' | 'use-remote'): Promise<void>
  keepDeletedCopy(setId: string): Promise<string>
  dismissDeleted(setId: string): Promise<void>
}

function baseKey(setId: string): string {
  return `${BASE_PREFIX}${setId}`
}

function conflictKey(setId: string): string {
  return `${CONFLICT_PREFIX}${setId}`
}

function parseSynced(data: string): SyncedSet {
  const parsed = JSON.parse(data) as Partial<SyncedSet>
  if (
    typeof parsed?.name !== 'string' ||
    typeof parsed.createdAt !== 'number' ||
    !Array.isArray(parsed.songs)
  ) {
    throw new Error('The account set is not readable.')
  }
  return { name: parsed.name, createdAt: parsed.createdAt, songs: parsed.songs }
}

function toSession(synced: SyncedSet, id: string, uid: string, updatedAt?: number): Session {
  return {
    id,
    name: synced.name,
    createdAt: synced.createdAt,
    songs: synced.songs,
    updatedAt,
    accountUid: uid,
  }
}

function withoutContentHash(entry: SyncedEntry): SyncedEntry {
  const copy = { ...entry }
  delete copy.contentHash
  return copy
}

function withoutContentHashes(synced: SyncedSet): SyncedSet {
  return { ...synced, songs: synced.songs.map(withoutContentHash) }
}

function syncedSession(session: Session): SyncedSet {
  return {
    name: session.name,
    createdAt: session.createdAt,
    songs: session.songs.map((entry) => ({ ...entry, entryId: entry.entryId ?? '' })),
  }
}

/** True when the set on this device matches the last synced copy, ignoring content hashes. */
function sameSessionAsBase(session: Session, base: BaseRecord | null): boolean {
  if (!base) return false
  return sameSyncedSet(
    withoutContentHashes(syncedSession(session)),
    withoutContentHashes(base.synced),
  )
}

export function createAccountSync(deps: AccountSyncDeps): AccountSync {
  let user: AccountUser | null = null
  let started = false
  let userToken = 0
  let openSetId: string | null = null
  let suppressSongEvents = 0
  let lastStatus: SyncStatus | undefined

  const listeners = new Set<(state: SyncState) => void>()
  let state: SyncState = EMPTY

  const conflicts = new Map<string, ConflictRecord>()
  const pendingRemote = new Map<string, PendingRecord>()
  const deletedElsewhere = new Set<string>()
  const outbox = new Set<string>()
  const dirtyTimers = new Map<string, unknown>()
  const running = new Map<string, Promise<void>>()
  const rerun = new Set<string>()
  const tasks = new Set<Promise<unknown>>()

  let stopStore: (() => void) | undefined
  let stopSongs: (() => void) | undefined
  let stopSnapshot: (() => void) | undefined

  function track<T>(task: Promise<T>): Promise<T> {
    tasks.add(task)
    void task.then(
      () => tasks.delete(task),
      () => tasks.delete(task),
    )
    return task
  }

  function publishState(): void {
    state = {
      pendingRemote: new Set(pendingRemote.keys()),
      deletedElsewhere: new Set(deletedElsewhere),
      conflicts: new Map(
        [...conflicts].map(([setId, record]) => [
          setId,
          {
            clashes: [...record.clashes],
            ...(record.diffs ? { diffs: [...record.diffs] } : {}),
          },
        ]),
      ),
    }
    for (const listener of [...listeners]) listener(state)
  }

  function refreshStatus(): void {
    let next: SyncStatus
    if (conflicts.size > 0) next = 'needs-choice'
    else if (!deps.online() && outbox.size > 0) next = 'offline'
    else if (running.size > 0) next = 'syncing'
    else next = 'synced'
    if (next !== lastStatus) {
      lastStatus = next
      deps.setStatus(next)
    }
  }

  function saveOutbox(): Promise<void> {
    return deps.kv.set(OUTBOX_KEY, [...outbox])
  }

  /** Reads the shared outbox back, so another tab's queued sets are not overwritten. */
  async function refreshOutbox(): Promise<void> {
    const stored = await deps.kv.get<string[]>(OUTBOX_KEY)
    outbox.clear()
    if (Array.isArray(stored)) {
      for (const setId of stored) {
        if (typeof setId === 'string') outbox.add(setId)
      }
    }
  }

  /** Merges a newly dirty set into the shared outbox without dropping another tab's queue. */
  async function addToOutbox(setId: string): Promise<void> {
    const stored = await deps.kv.get<string[]>(OUTBOX_KEY)
    if (Array.isArray(stored)) {
      for (const id of stored) {
        if (typeof id === 'string') outbox.add(id)
      }
    }
    outbox.add(setId)
    await saveOutbox()
  }

  async function loadBase(setId: string): Promise<BaseRecord | null> {
    const stored = await deps.kv.get<BaseRecord>(baseKey(setId))
    return stored && typeof stored.rev === 'number' && stored.synced ? stored : null
  }

  async function saveBase(setId: string, record: BaseRecord): Promise<void> {
    await deps.kv.set(baseKey(setId), record)
  }

  async function dropBase(setId: string): Promise<void> {
    await deps.kv.del(baseKey(setId))
  }

  function clearTimer(setId: string): void {
    const handle = dirtyTimers.get(setId)
    if (handle !== undefined) {
      deps.timers.clearTimeout(handle)
      dirtyTimers.delete(setId)
    }
  }

  function markDirty(setId: string): void {
    if (!user || conflicts.has(setId)) return
    outbox.add(setId)
    void track(addToOutbox(setId))
    clearTimer(setId)
    dirtyTimers.set(
      setId,
      deps.timers.setTimeout(() => {
        dirtyTimers.delete(setId)
        void upload(setId)
      }, ACCOUNT_SYNC_DEBOUNCE_MS),
    )
    refreshStatus()
  }

  function upload(setId: string): Promise<void> {
    const current = running.get(setId)
    if (current) {
      rerun.add(setId)
      return current
    }
    const task = doUpload(setId)
      .catch((error) => {
        console.warn(`[account-sync] upload failed for ${setId}`, error)
      })
      .finally(() => {
        running.delete(setId)
        refreshStatus()
        if (rerun.delete(setId)) void upload(setId)
      })
    running.set(setId, task)
    refreshStatus()
    return task
  }

  async function buildLocal(session: Session): Promise<BuildResult> {
    const songs = new Map<string, Song>()
    const entries: SyncedEntry[] = []
    for (const entry of session.songs) {
      const song = await deps.songCache.getSong(entry.url)
      if (!song) return { ok: false, reason: `Song not found in cache: ${entry.url}` }
      const contentHash = await deps.hashSong(song)
      songs.set(contentHash, song)
      entries.push({ ...entry, entryId: entry.entryId ?? '', contentHash })
    }
    return {
      ok: true,
      synced: { name: session.name, createdAt: session.createdAt, songs: entries },
      songs,
    }
  }

  async function ensureSongs(uid: string, songs: Map<string, Song>): Promise<void> {
    for (const [contentHash, song] of songs) {
      await deps.firestore.ensureSong(uid, contentHash, song)
    }
  }

  function remoteWrite(
    synced: SyncedSet,
    rev: number,
    updatedAt: number,
    deletedAt?: number,
  ): RemoteSetSnapshot {
    return {
      rev,
      data: JSON.stringify(synced),
      songCount: synced.songs.length,
      updatedAt,
      ...(deletedAt !== undefined ? { deletedAt } : {}),
    }
  }

  async function uploadLocked(setId: string, uid: string): Promise<UploadOutcome> {
    const session = await deps.store.getSession(setId)
    const base = await loadBase(setId)
    if (!session) {
      if (!base) return { kind: 'skip' }
      return { kind: 'tombstone', outcome: await tombstoneLocked(setId, uid, base) }
    }
    if (session.accountUid !== uid || session.liveSourceId) return { kind: 'skip' }
    const limit = checkSetLimits(session)
    if (limit) {
      console.warn(limit)
      return { kind: 'skip' }
    }

    const built = await buildLocal(session)
    if (!built.ok) {
      console.warn(`[account-sync] ${built.reason}`)
      return { kind: 'retry' }
    }
    await ensureSongs(uid, built.songs)

    const updatedAt = session.updatedAt ?? deps.now()
    const outcome = await deps.firestore.transactSet<UploadOutcome>(
      uid,
      setId,
      (current, setCount) => {
        if (!current) {
          if (base) return { write: null, outcome: { kind: 'gone' } }
          if (setCount >= ACCOUNT_MAX_SETS) {
            console.warn(
              `This account already has ${ACCOUNT_MAX_SETS} sets, so this set can't be saved to it.`,
            )
            return { write: null, outcome: { kind: 'skip' } }
          }
          return {
            write: remoteWrite(built.synced, 1, updatedAt),
            countDelta: 1,
            outcome: { kind: 'written', rev: 1, synced: built.synced },
          }
        }

        try {
          parseSynced(current.data)
        } catch {
          return { write: null, outcome: { kind: 'gone' } }
        }

        if (current.deletedAt != null) {
          return { write: null, outcome: { kind: 'deleted' } }
        }

        if (!base || current.rev !== base.rev) {
          return { write: null, outcome: { kind: 'behind', snapshot: current } }
        }

        if (sameSyncedSet(built.synced, base.synced)) {
          return { write: null, outcome: { kind: 'skip' } }
        }

        return {
          write: remoteWrite(built.synced, current.rev + 1, updatedAt),
          outcome: { kind: 'written', rev: current.rev + 1, synced: built.synced },
        }
      },
    )
    // Still under the lock, so a snapshot handler cannot save a newer base first.
    if (outcome.kind === 'written') {
      await saveBase(setId, { rev: outcome.rev, synced: outcome.synced })
    }
    return outcome
  }

  async function applyUploadOutcome(setId: string, uid: string, outcome: UploadOutcome) {
    if (outcome.kind === 'written') {
      pendingRemote.delete(setId)
      if (!dirtyTimers.has(setId) && !rerun.has(setId)) outbox.delete(setId)
      await saveOutbox()
      publishState()
      refreshStatus()
      return
    }
    if (outcome.kind === 'tombstone') {
      await applyTombstoneOutcome(setId, uid, outcome.outcome)
      return
    }
    if (outcome.kind === 'behind') {
      await applyRemoteSnapshot(setId, outcome.snapshot)
      return
    }
    if (outcome.kind === 'deleted' || outcome.kind === 'gone') {
      await handleGone(setId, await loadBase(setId))
      return
    }
    if (outcome.kind === 'skip') {
      if (!rerun.has(setId)) {
        outbox.delete(setId)
        await saveOutbox()
      }
      refreshStatus()
      return
    }
    refreshStatus()
  }

  async function doUpload(setId: string): Promise<void> {
    clearTimer(setId)
    const currentUser = user
    if (!currentUser) return
    if (conflicts.has(setId)) {
      outbox.delete(setId)
      await saveOutbox()
      return
    }
    if (!deps.online()) {
      refreshStatus()
      return
    }

    const outcome = await deps.withLock(ACCOUNT_SYNC_LOCK, () =>
      uploadLocked(setId, currentUser.uid),
    )
    if (user?.uid !== currentUser.uid) return
    await applyUploadOutcome(setId, currentUser.uid, outcome)
  }

  async function tombstoneLocked(
    setId: string,
    uid: string,
    base: BaseRecord,
  ): Promise<TombstoneOutcome> {
    return deps.firestore.transactSet<TombstoneOutcome>(uid, setId, (current) => {
      if (!current) return { write: null, outcome: { kind: 'missing' } }
      if (current.deletedAt != null) return { write: null, outcome: { kind: 'already' } }
      if (current.rev !== base.rev) {
        try {
          return {
            write: null,
            outcome: {
              kind: 'conflict',
              remote: parseSynced(current.data),
              remoteRev: current.rev,
              remoteUpdatedAt: current.updatedAt,
              clashes: ['This set was deleted on this device, but changed in the cloud.'],
              diffs: [{ label: 'Saved set', local: 'Deleted', remote: 'Changed' }],
            },
          }
        } catch {
          return { write: null, outcome: { kind: 'missing' } }
        }
      }
      const now = deps.now()
      return {
        write: remoteWrite(base.synced, current.rev + 1, now, now),
        countDelta: -1,
        outcome: { kind: 'deleted' },
      }
    })
  }

  async function tombstone(setId: string, uid: string, base: BaseRecord): Promise<void> {
    const currentUser = user
    if (!currentUser || currentUser.uid !== uid) return
    const outcome = await deps.withLock(ACCOUNT_SYNC_LOCK, () => tombstoneLocked(setId, uid, base))
    if (user?.uid !== uid) return
    await applyTombstoneOutcome(setId, uid, outcome)
  }

  async function applyTombstoneOutcome(
    setId: string,
    uid: string,
    outcome: TombstoneOutcome,
  ): Promise<void> {
    if (outcome.kind === 'conflict') {
      await fetchRemoteSongs(uid, outcome.remote)
      if (user?.uid !== uid) return
      await deps.store.applyRemote(toSession(outcome.remote, setId, uid, outcome.remoteUpdatedAt))
      await recordConflict(
        setId,
        outcome.remote,
        outcome.remoteRev,
        outcome.clashes,
        outcome.diffs,
        true,
      )
      outbox.delete(setId)
      await saveOutbox()
      return
    }
    await dropBase(setId)
    await clearConflict(setId)
    pendingRemote.delete(setId)
    deletedElsewhere.delete(setId)
    outbox.delete(setId)
    await saveOutbox()
    publishState()
    refreshStatus()
  }

  async function recordConflict(
    setId: string,
    remote: SyncedSet,
    remoteRev: number,
    clashes: string[],
    diffs?: ClashDiff[],
    localDeleted = false,
  ): Promise<void> {
    const record: ConflictRecord = {
      remote,
      remoteRev,
      clashes,
      ...(diffs?.length ? { diffs } : {}),
      ...(localDeleted ? { localDeleted: true } : {}),
    }
    conflicts.set(setId, record)
    await deps.kv.set(conflictKey(setId), record)
    pendingRemote.delete(setId)
    clearTimer(setId)
    publishState()
    refreshStatus()
  }

  async function clearConflict(setId: string): Promise<void> {
    conflicts.delete(setId)
    await deps.kv.del(conflictKey(setId))
  }

  async function fetchRemoteSongs(uid: string, remote: SyncedSet): Promise<void> {
    suppressSongEvents += 1
    try {
      for (const entry of remote.songs) {
        if (!entry.contentHash) continue
        const cached = await deps.songCache.getSong(entry.url)
        if (cached && (await deps.hashSong(cached)) === entry.contentHash) continue
        const stored = await deps.firestore.getSong(uid, entry.contentHash)
        if (!stored) {
          console.warn(`[account-sync] Missing song ${entry.contentHash}`)
          continue
        }
        await deps.songCache.saveSong(stored, entry.url)
      }
    } finally {
      suppressSongEvents -= 1
    }
  }

  async function handleGone(setId: string, base: BaseRecord | null): Promise<void> {
    clearTimer(setId)
    const session = await deps.store.getSession(setId)
    if (session && sameSessionAsBase(session, base) && !outbox.has(setId) && openSetId !== setId) {
      await deps.store.removeRemote(setId)
      deletedElsewhere.delete(setId)
    } else if (session) {
      deletedElsewhere.add(setId)
    }
    await dropBase(setId)
    pendingRemote.delete(setId)
    await clearConflict(setId)
    outbox.delete(setId)
    await saveOutbox()
    publishState()
    refreshStatus()
  }

  async function applyRemoteVersion(
    setId: string,
    uid: string,
    session: Session,
    base: BaseRecord | null,
    built: BuiltLocal,
    remote: SyncedSet,
    rev: number,
    updatedAt: number,
    waitForOpenSet: boolean,
  ): Promise<void> {
    if (sameSyncedSet(built.synced, remote)) {
      if (conflicts.has(setId)) await clearConflict(setId)
      await saveBase(setId, { rev, synced: remote })
      pendingRemote.delete(setId)
      deletedElsewhere.delete(setId)
      if (!dirtyTimers.has(setId)) {
        outbox.delete(setId)
        await saveOutbox()
      }
      publishState()
      refreshStatus()
      return
    }

    const songMeta = new Map<string, SyncedSongMeta>()
    for (const entry of built.synced.songs) {
      const cached = entry.contentHash ? built.songs.get(entry.contentHash) : undefined
      if (!cached) continue
      songMeta.set(entry.entryId, {
        originalKey: cached.originalKey ?? undefined,
        baseLabels: cached.sections.map((section) => section.label),
        simplifiedBaseLabels: (cached.simplifiedSections ?? cached.sections).map(
          (section) => section.label,
        ),
      })
    }
    const merge = mergeSet(base?.synced ?? null, built.synced, remote, songMeta)
    if (!merge.ok) {
      await recordConflict(
        setId,
        remote,
        rev,
        merge.clashes.map(describeClash),
        merge.clashes.map(clashDiff),
      )
      return
    }

    if (conflicts.has(setId)) await clearConflict(setId)

    if (waitForOpenSet && openSetId === setId) {
      pendingRemote.set(setId, { remote, rev, updatedAt })
      publishState()
      refreshStatus()
      return
    }

    const localChanged = !base || !sameSyncedSet(built.synced, base.synced) || outbox.has(setId)
    await deps.store.applyRemote(
      toSession(
        localChanged ? merge.merged : remote,
        setId,
        uid,
        localChanged ? session.updatedAt : updatedAt,
      ),
    )
    await saveBase(setId, { rev, synced: remote })
    pendingRemote.delete(setId)
    deletedElsewhere.delete(setId)
    if (localChanged) {
      markDirty(setId)
    } else if (!dirtyTimers.has(setId)) {
      outbox.delete(setId)
      await saveOutbox()
    }
    publishState()
    refreshStatus()
  }

  async function applyRemoteSnapshot(
    setId: string,
    snapshot: RemoteSetSnapshot | null,
  ): Promise<void> {
    const currentUser = user
    if (!currentUser) return
    const uid = currentUser.uid

    await deps.withLock(ACCOUNT_SYNC_LOCK, async () => {
      if (user?.uid !== uid) return
      await refreshOutbox()
      const base = await loadBase(setId)
      const existing = await deps.store.getSession(setId)
      if (user?.uid !== uid) return
      if (existing && (existing.accountUid !== uid || existing.liveSourceId)) return

      if (!snapshot) {
        await handleGone(setId, base)
        return
      }
      if (base && snapshot.rev <= base.rev) return

      let remote: SyncedSet
      try {
        remote = parseSynced(snapshot.data)
      } catch (error) {
        console.warn(`[account-sync] Could not read set ${setId}`, error)
        return
      }

      if (snapshot.deletedAt != null) {
        await handleGone(setId, base)
        return
      }

      await fetchRemoteSongs(uid, remote)
      if (user?.uid !== uid) return

      const session = await deps.store.getSession(setId)
      if (user?.uid !== uid) return
      if (session && (session.accountUid !== uid || session.liveSourceId)) return

      if (!session) {
        if (outbox.has(setId)) return
        pendingRemote.delete(setId)
        deletedElsewhere.delete(setId)
        await clearConflict(setId)
        await deps.store.applyRemote(toSession(remote, setId, uid, snapshot.updatedAt))
        await saveBase(setId, { rev: snapshot.rev, synced: remote })
        if (!dirtyTimers.has(setId)) {
          outbox.delete(setId)
          await saveOutbox()
        }
        publishState()
        refreshStatus()
        return
      }

      const built = await buildLocal(session)
      if (!built.ok) {
        console.warn(`[account-sync] ${built.reason}`)
        return
      }

      await applyRemoteVersion(
        setId,
        uid,
        session,
        base,
        built,
        remote,
        snapshot.rev,
        snapshot.updatedAt,
        true,
      )
    })
  }

  function handleEvent(event: SessionChangeEvent): void {
    const currentUser = user
    if (!currentUser || event.origin === 'remote') return
    if (event.type === 'deleted') {
      clearTimer(event.sessionId)
      void track(
        handleDeleted(event.sessionId, currentUser.uid).catch((error) => {
          console.warn(`[account-sync] delete failed for ${event.sessionId}`, error)
        }),
      )
      return
    }
    const session = event.session
    if (!session || session.liveSourceId) return
    if (event.type === 'created' && !session.accountUid) {
      void track(
        claimSet(session.id, currentUser.uid).catch((error) => {
          console.warn(`[account-sync] claim failed for ${session.id}`, error)
        }),
      )
      return
    }
    if (session.accountUid !== currentUser.uid) return
    markDirty(session.id)
  }

  async function claimSet(setId: string, uid: string): Promise<void> {
    await deps.store.setAccountUid(setId, uid)
    if (user?.uid !== uid) return
    markDirty(setId)
  }

  async function handleDeleted(setId: string, uid: string): Promise<void> {
    await addToOutbox(setId)
    if (!deps.online()) {
      refreshStatus()
      return
    }
    const base = await loadBase(setId)
    if (!base) {
      outbox.delete(setId)
      await saveOutbox()
      refreshStatus()
      return
    }
    await tombstone(setId, uid, base)
  }

  function handleSongSaved(url: string): void {
    const currentUser = user
    if (!currentUser || suppressSongEvents > 0) return
    const uid = currentUser.uid
    const target = normalizeSongUrl(url)
    void track(
      (async () => {
        const sessions = await deps.store.getAllSessions()
        if (user?.uid !== uid) return
        for (const session of sessions) {
          if (session.liveSourceId || session.accountUid !== uid) continue
          if (!session.songs.some((entry) => normalizeSongUrl(entry.url) === target)) continue
          markDirty(session.id)
        }
      })().catch((error) => {
        console.warn('[account-sync] song refresh failed', error)
      }),
    )
  }

  async function startForUser(next: AccountUser, token: number): Promise<void> {
    const uid = next.uid
    const storedOutbox = await deps.kv.get<string[]>(OUTBOX_KEY)
    if (userToken !== token) return
    outbox.clear()
    if (Array.isArray(storedOutbox)) {
      for (const setId of storedOutbox) {
        if (typeof setId === 'string') outbox.add(setId)
      }
    }

    const sessions = await deps.store.getAllSessions()
    if (userToken !== token) return
    conflicts.clear()
    for (const session of sessions) {
      if (session.accountUid !== uid) continue
      const stored = await deps.kv.get<ConflictRecord>(conflictKey(session.id))
      if (stored?.remote && Array.isArray(stored.clashes)) {
        conflicts.set(session.id, stored)
      }
    }
    if (userToken !== token) return
    for (const setId of [...outbox]) {
      if (conflicts.has(setId)) outbox.delete(setId)
    }
    await saveOutbox()
    if (userToken !== token) return

    stopStore = deps.store.subscribe(handleEvent)
    stopSongs = deps.songCache.subscribe(handleSongSaved)
    stopSnapshot = deps.firestore.subscribeSets(uid, (setId, snapshot) => {
      if (userToken !== token) return
      void track(
        applyRemoteSnapshot(setId, snapshot).catch((error) => {
          console.warn(`[account-sync] remote change failed for ${setId}`, error)
        }),
      )
    })

    publishState()
    refreshStatus()
    for (const setId of [...outbox]) void upload(setId)
  }

  function stopForUser(): void {
    stopStore?.()
    stopStore = undefined
    stopSongs?.()
    stopSongs = undefined
    stopSnapshot?.()
    stopSnapshot = undefined
    for (const handle of dirtyTimers.values()) deps.timers.clearTimeout(handle)
    dirtyTimers.clear()
  }

  function resetState(): void {
    conflicts.clear()
    pendingRemote.clear()
    deletedElsewhere.clear()
    outbox.clear()
    publishState()
    refreshStatus()
  }

  function handleUser(next: AccountUser | null): void {
    userToken += 1
    const token = userToken
    stopForUser()
    user = next
    resetState()
    if (!next) return
    void track(
      startForUser(next, token).catch((error) => {
        console.warn('[account-sync] sign-in setup failed', error)
      }),
    )
  }

  async function applyPendingRemoteNow(setId: string): Promise<void> {
    const currentUser = user
    if (!currentUser || !pendingRemote.has(setId)) return
    const uid = currentUser.uid

    await deps.withLock(ACCOUNT_SYNC_LOCK, async () => {
      if (user?.uid !== uid) return
      await refreshOutbox()
      const pending = pendingRemote.get(setId)
      if (!pending) return
      const base = await loadBase(setId)
      const session = await deps.store.getSession(setId)
      if (user?.uid !== uid) return

      if (!session) {
        await deps.store.applyRemote(toSession(pending.remote, setId, uid, pending.updatedAt))
        await saveBase(setId, { rev: pending.rev, synced: pending.remote })
        pendingRemote.delete(setId)
        publishState()
        refreshStatus()
        return
      }

      const built = await buildLocal(session)
      if (!built.ok) {
        await recordConflict(
          setId,
          pending.remote,
          pending.rev,
          ['This set could not be read on this device.'],
          [{ label: 'Saved set', local: 'Could not be read', remote: 'Available in the cloud' }],
        )
        return
      }

      await applyRemoteVersion(
        setId,
        uid,
        session,
        base,
        built,
        pending.remote,
        pending.rev,
        pending.updatedAt,
        false,
      )
    })
  }

  async function resolveConflictNow(
    setId: string,
    choice: 'keep-local' | 'use-remote',
  ): Promise<void> {
    const currentUser = user
    if (!currentUser || !conflicts.has(setId)) return
    const uid = currentUser.uid

    await deps.withLock(ACCOUNT_SYNC_LOCK, async () => {
      if (user?.uid !== uid) return
      await refreshOutbox()
      const record = conflicts.get(setId)
      if (!record) return

      if (choice === 'use-remote') {
        await fetchRemoteSongs(uid, record.remote)
        if (user?.uid !== uid) return
        const session = await deps.store.getSession(setId)
        await deps.store.applyRemote(toSession(record.remote, setId, uid, session?.updatedAt))
        await saveBase(setId, { rev: record.remoteRev, synced: record.remote })
        pendingRemote.delete(setId)
        deletedElsewhere.delete(setId)
      } else {
        const session = await deps.store.getSession(setId)
        if (record.localDeleted || !session) {
          const base = await loadBase(setId)
          const data = base?.synced ?? record.remote
          await deps.firestore.transactSet(uid, setId, (current) => {
            if (!current || current.deletedAt != null) return { write: null, outcome: null }
            const now = deps.now()
            return {
              write: remoteWrite(data, current.rev + 1, now, now),
              countDelta: -1,
              outcome: null,
            }
          })
          await deps.store.removeRemote(setId)
          await dropBase(setId)
        } else {
          const built = await buildLocal(session)
          if (!built.ok) throw new Error(built.reason)
          await ensureSongs(uid, built.songs)
          const updatedAt = session.updatedAt ?? deps.now()
          const base = await loadBase(setId)
          const written = await deps.firestore.transactSet<
            { kind: 'written'; rev: number } | { kind: 'deleted' } | null
          >(uid, setId, (current, setCount) => {
            if (!current) {
              if (setCount >= ACCOUNT_MAX_SETS) return { write: null, outcome: null }
              return {
                write: remoteWrite(built.synced, 1, updatedAt),
                countDelta: 1,
                outcome: { kind: 'written', rev: 1 },
              }
            }
            if (current.deletedAt != null) {
              return { write: null, outcome: { kind: 'deleted' } }
            }
            return {
              write: remoteWrite(built.synced, current.rev + 1, updatedAt),
              outcome: { kind: 'written', rev: current.rev + 1 },
            }
          })
          if (written?.kind === 'deleted') {
            await handleGone(setId, base)
            return
          }
          if (!written) throw new Error('This account is full.')
          await saveBase(setId, { rev: written.rev, synced: built.synced })
        }
        pendingRemote.delete(setId)
        deletedElsewhere.delete(setId)
      }

      await clearConflict(setId)
      outbox.delete(setId)
      await saveOutbox()
      publishState()
      refreshStatus()
    })
  }

  async function keepDeletedCopyNow(setId: string): Promise<string> {
    const currentUser = user
    const session = await deps.store.getSession(setId)
    if (!currentUser || !session) throw new Error('This set is no longer on this device.')
    const copy = await deps.store.createSetCopy(session, { accountUid: currentUser.uid })
    await deps.store.removeRemote(setId)
    await dropBase(setId)
    await clearConflict(setId)
    deletedElsewhere.delete(setId)
    pendingRemote.delete(setId)
    outbox.delete(setId)
    await saveOutbox()
    publishState()
    refreshStatus()
    return copy.id
  }

  async function dismissDeletedNow(setId: string): Promise<void> {
    const session = await deps.store.getSession(setId)
    if (session) await deps.store.removeRemote(setId)
    await dropBase(setId)
    await clearConflict(setId)
    deletedElsewhere.delete(setId)
    pendingRemote.delete(setId)
    outbox.delete(setId)
    await saveOutbox()
    publishState()
    refreshStatus()
  }

  async function flush(): Promise<void> {
    for (const setId of [...dirtyTimers.keys()]) clearTimer(setId)
    const ids = [...outbox].filter((setId) => !conflicts.has(setId))
    await Promise.all(ids.map((setId) => upload(setId)))
    refreshStatus()
  }

  async function idle(): Promise<void> {
    for (;;) {
      const pending = [...tasks, ...running.values()]
      if (pending.length === 0) return
      await Promise.allSettled(pending)
    }
  }

  return {
    start() {
      if (started) return () => {}
      started = true
      const unsubscribe = deps.onUser(handleUser)
      return () => {
        if (!started) return
        started = false
        userToken += 1
        unsubscribe()
        stopForUser()
        user = null
        resetState()
      }
    },
    flush,
    idle,
    getSyncState: () => state,
    subscribeSyncState(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setOpenSet(setId) {
      openSetId = setId
    },
    applyPendingRemote: applyPendingRemoteNow,
    resolveConflict: resolveConflictNow,
    keepDeletedCopy: keepDeletedCopyNow,
    dismissDeleted: dismissDeletedNow,
  }
}

function snapshotFromData(data: Record<string, unknown>): RemoteSetSnapshot {
  const deletedAt = data.deletedAt
  let deletedAtMs: number | null = null
  if (typeof deletedAt === 'number') deletedAtMs = deletedAt
  else if (deletedAt && typeof deletedAt === 'object') {
    const value = deletedAt as { toMillis?: () => number }
    deletedAtMs = typeof value.toMillis === 'function' ? value.toMillis() : null
  }
  return {
    rev: Number(data.rev),
    data: String(data.data ?? ''),
    songCount: Number(data.songCount ?? 0),
    updatedAt: Number(data.updatedAt ?? 0),
    deletedAt: deletedAtMs,
  }
}

function alreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'already-exists'
  )
}

function createFirestoreAdapter(): AccountFirestore {
  return {
    async getSong(uid, contentHash) {
      const fs = await loadFirestore()
      const snap = await fs.getDoc(fs.doc(fs.db as never, 'users', uid, 'songs', contentHash))
      if (!snap.exists()) return null
      const data = snap.data() as { data?: unknown }
      if (typeof data.data !== 'string') return null
      try {
        return JSON.parse(data.data) as Song
      } catch {
        return null
      }
    },

    async ensureSong(uid, contentHash, song) {
      const fs = await loadFirestore()
      const ref = fs.doc(fs.db as never, 'users', uid, 'songs', contentHash)
      const snap = await fs.getDoc(ref)
      if (snap.exists()) return
      try {
        await fs.setDoc(ref, {
          v: 1,
          data: JSON.stringify(song),
          createdAt: fs.serverTimestamp(),
        })
      } catch (error) {
        if (!alreadyExists(error)) throw error
      }
    },

    async transactSet<T>(
      uid: string,
      setId: string,
      decide: (current: RemoteSetSnapshot | null, setCount: number) => SetWriteDecision<T>,
    ): Promise<T> {
      const fs = await loadFirestore()
      const db = fs.db as never
      const metaRef = fs.doc(db, 'users', uid)
      const setRef = fs.doc(db, 'users', uid, 'sets', setId)
      return fs.runTransaction(db, async (transaction) => {
        const setSnap = await transaction.get(setRef)
        const metaSnap = await transaction.get(metaRef)
        const current = setSnap.exists()
          ? snapshotFromData(setSnap.data() as Record<string, unknown>)
          : null
        const count = metaSnap.exists()
          ? Number((metaSnap.data() as { setCount?: unknown }).setCount ?? 0)
          : 0
        const decision = decide(current, count)
        if (decision.write) {
          const write = decision.write
          const payload: Record<string, unknown> = {
            v: 1,
            rev: write.rev,
            data: write.data,
            songCount: write.songCount,
            updatedAt: write.updatedAt,
            serverUpdatedAt: fs.serverTimestamp(),
          }
          if (write.deletedAt != null) {
            payload.deletedAt = fs.Timestamp.fromMillis(write.deletedAt)
          }
          transaction.set(setRef, payload)
          if (decision.countDelta) {
            transaction.set(metaRef, {
              setCount: count + decision.countDelta,
              lastSetId: setId,
            })
          }
        }
        return decision.outcome
      })
    },

    subscribeSets(uid, onChange) {
      let stopped = false
      let unsubscribe: (() => void) | undefined
      void loadFirestore()
        .then((fs) => {
          if (stopped) return
          const off = fs.onSnapshot(
            fs.collection(fs.db as never, 'users', uid, 'sets'),
            (snapshot) => {
              for (const change of snapshot.docChanges()) {
                if (change.type === 'removed') onChange(change.doc.id, null)
                else {
                  onChange(
                    change.doc.id,
                    snapshotFromData(change.doc.data() as Record<string, unknown>),
                  )
                }
              }
            },
            (error) => {
              console.warn('[account-sync] set listener failed', error)
            },
          )
          if (stopped) off()
          else unsubscribe = off
        })
        .catch((error) => {
          console.warn('[account-sync] could not start the set listener', error)
        })
      return () => {
        stopped = true
        unsubscribe?.()
        unsubscribe = undefined
      }
    },
  }
}

function createDefaultSync(): AccountSync {
  return createAccountSync({
    store: sessionStore,
    songCache,
    firestore: createFirestoreAdapter(),
    kv: { get, set, del },
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    withLock: withNamedLock,
    onUser,
    online: () => typeof navigator === 'undefined' || navigator.onLine,
    hashSong: (song) => hashLiveSongContent({ song }),
    now: () => Date.now(),
    setStatus: setSyncStatus,
  })
}

let defaultSync: AccountSync | undefined
let stopDefault: (() => void) | undefined

/** Starts account sync if the flag is on. Idempotent; call once at app startup. */
export function startAccountSync(): () => void {
  if (stopDefault) return stopDefault
  if (!accountsEnabled()) return () => {}
  defaultSync ??= createDefaultSync()
  const stop = defaultSync.start()
  stopDefault = () => {
    stop()
    stopDefault = undefined
  }
  return stopDefault
}

/** Retries the outbox now, e.g. when the connection returns. */
export async function flushAccountSync(): Promise<void> {
  await defaultSync?.flush()
}

export function getSyncState(): SyncState {
  return defaultSync?.getSyncState() ?? EMPTY
}

export function subscribeSyncState(listener: (state: SyncState) => void): () => void {
  return defaultSync?.subscribeSyncState(listener) ?? (() => {})
}

/** Tells the engine which set is on screen, so remote changes to it wait for **Update set**. */
export function setOpenSet(setId: string | null): void {
  defaultSync?.setOpenSet(setId)
}

/** Applies the waiting account version of an open set (**Update set**). */
export async function applyPendingRemote(setId: string): Promise<void> {
  await defaultSync?.applyPendingRemote(setId)
}

/** **Keep this device** or **Use account version** for a set with a conflict. */
export async function resolveConflict(
  setId: string,
  choice: 'keep-local' | 'use-remote',
): Promise<void> {
  await defaultSync?.resolveConflict(setId, choice)
}

/** **Keep a copy** of a set deleted on another device. Resolves to the new set's id. */
export async function keepDeletedCopy(setId: string): Promise<string> {
  return defaultSync ? defaultSync.keepDeletedCopy(setId) : setId
}

/** **Go back** from a set deleted on another device: drop it from this device. */
export async function dismissDeleted(setId: string): Promise<void> {
  await defaultSync?.dismissDeleted(setId)
}
