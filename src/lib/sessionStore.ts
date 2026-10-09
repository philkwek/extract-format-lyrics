import { get, set, del } from 'idb-keyval'
import type { Section } from '../types/song'

export interface SessionSongItem {
  url: string
  title?: string
  artist?: string
  status: 'ok' | 'error' | 'loading'
  errorMessage?: string
  customSections?: Section[]
  customSimplifiedSections?: Section[]
}

export interface Session {
  id: string
  createdAt: number
  name: string
  songs: SessionSongItem[]
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

  constructor(store: SessionStorageStore = defaultStore) {
    this.store = store
  }

  async getAllSessions(): Promise<Session[]> {
    const list = await this.store.get<Session[]>(SESSIONS_STORAGE_KEY)
    return list ?? []
  }

  async getSession(id: string): Promise<Session | null> {
    const list = await this.getAllSessions()
    return list.find((s) => s.id === id) ?? null
  }

  async createSession(songs: SessionSongItem[], name?: string): Promise<Session> {
    const list = await this.getAllSessions()
    const now = Date.now()
    const newSession: Session = {
      id: `session_${now}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: now,
      name: name || formatDefaultSessionName(new Date(now)),
      songs,
    }

    list.unshift(newSession)
    await this.store.set(SESSIONS_STORAGE_KEY, list)
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
    const list = await this.getAllSessions()
    const index = list.findIndex((s) => s.id === session.id)
    if (index >= 0) {
      list[index] = session
      await this.store.set(SESSIONS_STORAGE_KEY, list)
    }
  }

  async deleteSession(id: string): Promise<void> {
    const list = await this.getAllSessions()
    const filtered = list.filter((s) => s.id !== id)
    await this.store.set(SESSIONS_STORAGE_KEY, filtered)
  }

  async addSongToSession(sessionId: string, song: SessionSongItem): Promise<Session | null> {
    const session = await this.getSession(sessionId)
    if (!session) return null
    session.songs.push(song)
    await this.updateSession(session)
    return session
  }

  async removeSongFromSession(sessionId: string, url: string): Promise<Session | null> {
    const session = await this.getSession(sessionId)
    if (!session) return null
    session.songs = session.songs.filter((s) => s.url !== url)
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

export const sessionStore = new SessionStore()
