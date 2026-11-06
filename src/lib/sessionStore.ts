import { get, set, del } from 'idb-keyval'
import type { Section } from '../types/song'
import {
  getOrCreateSetLinkIdentity,
  getSetLinkIdentityStore,
  type SetLinkIdentityStore,
} from './setLinkIdentity'

export type PadKeyMode = 'match' | 'custom'

export interface SessionSongItem {
  /** Stable per-occurrence ID. This permits the same source song more than once. */
  entryId?: string
  url: string
  title?: string
  artist?: string
  status: 'ok' | 'error' | 'loading'
  errorMessage?: string
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
}

export interface SessionChangeEvent {
  type: 'created' | 'updated' | 'deleted'
  sessionId: string
  session?: Session
}

export type SessionChangeListener = (event: SessionChangeEvent) => void

export interface CreateSessionOptions {
  importedFromLinkId?: string
}

export function sessionPath(session: Pick<Session, 'id' | 'publicId'>): string {
  return `/session/${session.publicId ?? session.id}`
}

const SESSIONS_STORAGE_KEY = 'app_sessions'

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

  async createSession(
    songs: SessionSongItem[],
    name?: string,
    options: CreateSessionOptions = {}
  ): Promise<Session> {
    const list = await this.getAllSessions()
    const now = Date.now()
    const id = `session_${now}_${Math.random().toString(36).substring(2, 7)}`
    const identity = await getOrCreateSetLinkIdentity(id, this.identities())
    const newSession: Session = {
      id,
      publicId: identity.publicId,
      ...(options.importedFromLinkId ? { importedFromLinkId: options.importedFromLinkId } : {}),
      createdAt: now,
      name: name || formatDefaultSessionName(new Date(now)),
      songs: songs.map((song) => ({ ...song, entryId: song.entryId || makeEntryId() })),
    }

    list.unshift(newSession)
    await this.store.set(SESSIONS_STORAGE_KEY, list)
    this.emit({ type: 'created', sessionId: newSession.id, session: newSession })
    return newSession
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
    songs: SessionSongItem[]
  ): Promise<{ session: Session; firstNewIndex: number } | null> {
    const session = await this.getSession(sessionId)
    if (!session) return null
    const firstNewIndex = session.songs.length
    session.songs.push(...songs.map((song) => ({ ...song, entryId: song.entryId || makeEntryId() })))
    await this.updateSession(session)
    return { session, firstNewIndex }
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
