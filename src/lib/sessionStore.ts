import { get, set, del } from 'idb-keyval'

export interface SessionSongItem {
  url: string
  title?: string
  artist?: string
  status: 'ok' | 'error' | 'loading'
  errorMessage?: string
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
      name: name || `Setlist ${new Date(now).toLocaleDateString()}`,
      songs,
    }

    list.unshift(newSession)
    await this.store.set(SESSIONS_STORAGE_KEY, list)
    return newSession
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
}

export const sessionStore = new SessionStore()
