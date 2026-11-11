import { get, set, del } from 'idb-keyval'
import type { Section } from '../types/song'
import {
  getOrCreateSetLinkIdentity,
  getSetLinkIdentityStore,
  type SetLinkIdentityStore,
} from './setLinkIdentity'

export type PadKeyMode = 'match' | 'custom'

export interface ImportFailure {
  url: string
  reason: string
}

export interface LinkSnapshotEntry {
  entryId: string
  targetKey?: string
}

export const MAX_IMPORT_FAILURES = 30

export interface SessionSongItem {
  /** Stable per-occurrence ID. This permits the same source song more than once. */
  entryId?: string
  url: string
  title?: string
  artist?: string
  customSections?: Section[]
  customFlow?: number[]
  customSimplifiedSections?: Section[]
  customSimplifiedFlow?: number[]
  /** Per-set musical choices; layout and typography remain personal preferences. */
  targetKey?: string
  padKeyMode?: PadKeyMode
  customPadKey?: string
  simplified?: boolean
}

export interface Session {
  id: string
  createdAt: number
  name: string
  songs: SessionSongItem[]
  /** Unguessable ID used in the shareable URL. Derived from a secret kept in the identity store. */
  publicId?: string
  /** Set link this session was imported from, so re-opening the link finds the existing copy. */
  importedFromLinkId?: string
  /** Live share this set came from, so re-opening the live link finds the existing copy. */
  liveSourceId?: string
  /** Hash of this set as built from the last host version applied. */
  lastHostHash?: string
  /** Last host manifest revision applied. */
  liveRev?: number
  /** Set once the host stops the live share or its link expires; neither can come back. */
  liveEnded?: 'stopped' | 'expired'
  /** Links that failed to import; shown until dismissed, never copied or shared. */
  importFailures?: ImportFailure[]
  /** The set link when this copy was saved; used to show what the sender changed since. */
  linkSnapshot?: LinkSnapshotEntry[]
}

export interface SessionChangeEvent {
  type: 'created' | 'updated' | 'deleted'
  sessionId: string
  session?: Session
}

export type SessionChangeListener = (event: SessionChangeEvent) => void

export interface CreateSessionOptions {
  importedFromLinkId?: string
  liveSourceId?: string
  lastHostHash?: string
  liveRev?: number
  importFailures?: ImportFailure[]
  linkSnapshot?: LinkSnapshotEntry[]
}

export function sessionPath(session: Pick<Session, 'id' | 'publicId'>): string {
  return `/session/${session.publicId ?? session.id}`
}

/** Appends failures, keeping the newest entry per url, capped at MAX_IMPORT_FAILURES. */
export function mergeImportFailures(
  existing: ImportFailure[] | undefined,
  added: ImportFailure[],
): ImportFailure[] | undefined {
  const byUrl = new Map<string, ImportFailure>()
  for (const failure of [...(existing ?? []), ...added]) {
    byUrl.delete(failure.url)
    byUrl.set(failure.url, failure)
  }
  const merged = [...byUrl.values()].slice(-MAX_IMPORT_FAILURES)
  return merged.length > 0 ? merged : undefined
}

/** Picks a copy name that avoids existing sets, filling gaps in the numbering. */
export function uniqueSetName(name: string, existingNames: string[]): string {
  if (!existingNames.includes(name)) return name
  const base = name.replace(/ - Copy(?: #\d+)?$/, '').trim()
  let n = 1
  while (existingNames.includes(`${base} - Copy #${n}`)) n += 1
  return `${base} - Copy #${n}`
}

const SESSIONS_STORAGE_KEY = 'app_sessions'

type LegacySongItem = SessionSongItem & { status?: string; errorMessage?: string }

export interface SessionStorageStore {
  get: typeof get
  set: typeof set
  del: typeof del
}

const defaultStore: SessionStorageStore = { get, set, del }

export function formatDefaultSessionName(date: Date = new Date()): string {
  const day = date.getDate()
  const month = date.toLocaleDateString('en-US', { month: 'long' })
  let hours = date.getHours()
  const ampm = hours >= 12 ? 'pm' : 'am'
  hours = hours % 12 || 12
  const minutes = date.getMinutes()
  const timeStr = minutes === 0 ? `${hours}${ampm}` : `${hours}${minutes.toString().padStart(2, '0')}${ampm}`
  return `${day} ${month} ${timeStr} Set`
}

export class SessionStore {
  private readonly store: SessionStorageStore
  private readonly identityStore?: SetLinkIdentityStore
  private readonly listeners = new Set<SessionChangeListener>()

  constructor(store: SessionStorageStore = defaultStore, identityStore?: SetLinkIdentityStore) {
    this.store = store
    this.identityStore = identityStore
  }

  private identities(): SetLinkIdentityStore {
    return this.identityStore ?? getSetLinkIdentityStore()
  }

  subscribe(listener: SessionChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(event: SessionChangeEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch (error) {
        console.error('Session listener failed', error)
      }
    }
  }

  async getAllSessions(): Promise<Session[]> {
    const list = await this.store.get<Session[]>(SESSIONS_STORAGE_KEY)
    const sessions = list ?? []
    // Lightweight migration for sessions made before per-entry IDs existed.
    let changed = false
    for (const session of sessions) {
      // Sets saved before songs were guaranteed readable: failed rows become import failures.
      const legacy = session.songs as LegacySongItem[]
      if (legacy.some((item) => 'status' in item || 'errorMessage' in item)) {
        const failed = legacy.filter((item) => item.status === 'error' && item.url)
        session.songs = legacy.filter((item) => item.status !== 'error')
        for (const item of session.songs as LegacySongItem[]) {
          delete item.status
          delete item.errorMessage
        }
        if (failed.length > 0) {
          session.importFailures = mergeImportFailures(
            session.importFailures,
            failed.map((item) => ({ url: item.url, reason: item.errorMessage || 'Import failed' })),
          )
        }
        changed = true
      }
      for (const item of session.songs) {
        if (!item.entryId) {
          item.entryId = makeEntryId()
          changed = true
        }
      }
      if (!session.publicId) {
        // Silent migration: no listener events, so nothing is published here.
        const identity = await getOrCreateSetLinkIdentity(session.id, this.identities())
        session.publicId = identity.publicId
        changed = true
      }
    }
    if (changed) await this.store.set(SESSIONS_STORAGE_KEY, sessions)
    return sessions
  }

  /** Looks a session up by its local id first, then by its public id. */
  async getSession(idOrPublicId: string): Promise<Session | null> {
    const list = await this.getAllSessions()
    return (
      list.find((s) => s.id === idOrPublicId) ??
      list.find((s) => s.publicId === idOrPublicId) ??
      null
    )
  }

  async findByImportedLinkId(linkId: string): Promise<Session | null> {
    const list = await this.getAllSessions()
    return list.find((s) => s.importedFromLinkId === linkId) ?? null
  }

  async findByLiveSourceId(liveId: string): Promise<Session | null> {
    const list = await this.getAllSessions()
    return list.find((s) => s.liveSourceId === liveId) ?? null
  }

  async createSession(
    songs: SessionSongItem[],
    name?: string,
    options: CreateSessionOptions = {}
  ): Promise<Session> {
    const list = await this.getAllSessions()
    const now = Date.now()
    const id = `session_${now}_${Math.random().toString(36).substring(2, 7)}`
    const identity = await getOrCreateSetLinkIdentity(id, this.identities())
    const importFailures = mergeImportFailures(undefined, options.importFailures ?? [])
    const newSession: Session = {
      id,
      publicId: identity.publicId,
      ...(options.importedFromLinkId ? { importedFromLinkId: options.importedFromLinkId } : {}),
      ...(options.liveSourceId ? { liveSourceId: options.liveSourceId } : {}),
      ...(options.lastHostHash ? { lastHostHash: options.lastHostHash } : {}),
      ...(options.liveRev !== undefined ? { liveRev: options.liveRev } : {}),
      ...(importFailures ? { importFailures } : {}),
      ...(options.linkSnapshot ? { linkSnapshot: options.linkSnapshot } : {}),
      createdAt: now,
      name: name || formatDefaultSessionName(new Date(now)),
      songs: songs.map((song) => ({ ...song, entryId: song.entryId || makeEntryId() })),
    }

    list.unshift(newSession)
    await this.store.set(SESSIONS_STORAGE_KEY, list)
    this.emit({ type: 'created', sessionId: newSession.id, session: newSession })
    return newSession
  }

  /** Makes a normal set from this one: same songs and edits, none of the live or link fields. */
  async createSetCopy(session: Session): Promise<Session> {
    const names = (await this.getAllSessions()).map((existing) => existing.name)
    return this.createSession(structuredClone(session.songs), uniqueSetName(session.name, names))
  }

  async replaceSongsFromLink(
    sessionId: string,
    songs: SessionSongItem[],
    linkSnapshot: LinkSnapshotEntry[],
    importFailures: ImportFailure[],
  ): Promise<Session | null> {
    const session = await this.getSession(sessionId)
    if (!session) return null
    session.songs = songs
    session.linkSnapshot = linkSnapshot
    const failures = mergeImportFailures(undefined, importFailures)
    if (failures) session.importFailures = failures
    else delete session.importFailures
    await this.updateSession(session)
    return session
  }

  async renameSession(id: string, newName: string): Promise<Session | null> {
    const session = await this.getSession(id)
    if (!session) return null
    session.name = newName.trim() || session.name
    await this.updateSession(session)
    return session
  }

  async updateSession(session: Session): Promise<void> {
    for (const item of session.songs) {
      item.entryId ||= makeEntryId()
    }
    const list = await this.getAllSessions()
    const index = list.findIndex((s) => s.id === session.id)
    if (index >= 0) {
      const existing = list[index]
      session.publicId ??= existing.publicId
      session.importedFromLinkId ??= existing.importedFromLinkId
      session.liveSourceId ??= existing.liveSourceId
      session.liveEnded ??= existing.liveEnded
      session.linkSnapshot ??= existing.linkSnapshot
      // A save from an older copy of the set must not roll the host revision back.
      if ((session.liveRev ?? 0) < (existing.liveRev ?? 0)) {
        session.liveRev = existing.liveRev
        session.lastHostHash = existing.lastHostHash
      }
      list[index] = session
      await this.store.set(SESSIONS_STORAGE_KEY, list)
      this.emit({ type: 'updated', sessionId: session.id, session })
    }
  }

  async deleteSession(id: string): Promise<void> {
    const list = await this.getAllSessions()
    const filtered = list.filter((s) => s.id !== id)
    await this.store.set(SESSIONS_STORAGE_KEY, filtered)
    if (filtered.length !== list.length) {
      this.emit({ type: 'deleted', sessionId: id })
    }
  }

  async addSongsToSession(
    sessionId: string,
    songs: SessionSongItem[],
    failures: ImportFailure[] = [],
  ): Promise<{ session: Session; firstNewIndex: number } | null> {
    const session = await this.getSession(sessionId)
    if (!session) return null
    const firstNewIndex = session.songs.length
    if (songs.length === 0) return { session, firstNewIndex }
    session.songs.push(...songs.map((song) => ({ ...song, entryId: song.entryId || makeEntryId() })))
    session.importFailures = mergeImportFailures(session.importFailures, failures)
    await this.updateSession(session)
    return { session, firstNewIndex }
  }

  async dismissImportFailures(sessionId: string): Promise<Session | null> {
    const session = await this.getSession(sessionId)
    if (!session) return null
    if (!session.importFailures?.length) return session
    delete session.importFailures
    await this.updateSession(session)
    return session
  }

  async removeSongFromSession(sessionId: string, entryId: string): Promise<Session | null> {
    const session = await this.getSession(sessionId)
    if (!session) return null
    session.songs = session.songs.filter((s) => s.entryId !== entryId)
    await this.updateSession(session)
    return session
  }

  async reorderSongsInSession(sessionId: string, fromIndex: number, toIndex: number): Promise<Session | null> {
    const session = await this.getSession(sessionId)
    if (!session) return null
    if (
      fromIndex < 0 ||
      fromIndex >= session.songs.length ||
      toIndex < 0 ||
      toIndex >= session.songs.length ||
      fromIndex === toIndex
    ) {
      return session
    }

    const [moved] = session.songs.splice(fromIndex, 1)
    session.songs.splice(toIndex, 0, moved)
    await this.updateSession(session)
    return session
  }
}

export function makeEntryId(): string {
  return `entry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

export const sessionStore = new SessionStore()
