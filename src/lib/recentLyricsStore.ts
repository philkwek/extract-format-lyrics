import { createStore, get, set, del } from 'idb-keyval'
import type { SharedLyricsPayload, SharedLyricsSong } from '../types/song'

export interface RecentSharedLyrics {
  id: string
  name: string
  songCount: number
  expiresAt: string
  openedAt: number
  songs: SharedLyricsSong[]
}

export interface RecentLyricsStorageStore {
  get: <T>(key: string) => Promise<T | undefined>
  set: (key: string, val: unknown) => Promise<void>
  del: (key: string) => Promise<void>
}

const STORE_NAME = 'app_lyrics_recent_db'
const TABLE_NAME = 'recent_shares'
const RECENT_LIST_KEY = 'recent_shared_lyrics_list'
const MAX_RECENT_ITEMS = 20

function createDefaultRecentStore(): RecentLyricsStorageStore {
  if (typeof indexedDB !== 'undefined') {
    const customStore = createStore(STORE_NAME, TABLE_NAME)
    return {
      get: <T>(key: string) => get<T>(key, customStore),
      set: (key: string, val: unknown) => set(key, val, customStore),
      del: (key: string) => del(key, customStore),
    }
  }

  // Memory fallback for environments without IndexedDB (e.g. Node tests)
  const memory = new Map<string, unknown>()
  return {
    get: async <T>(key: string) => memory.get(key) as T | undefined,
    set: async (key: string, val: unknown) => {
      memory.set(key, val)
    },
    del: async (key: string) => {
      memory.delete(key)
    },
  }
}

let activeStore: RecentLyricsStorageStore = createDefaultRecentStore()

export function setRecentLyricsStoreForTesting(store: RecentLyricsStorageStore): void {
  activeStore = store
}

export function resetRecentLyricsStore(): void {
  activeStore = createDefaultRecentStore()
}

/**
 * Saves a recently opened shared lyrics set to local IndexedDB.
 */
export async function saveRecentSharedLyrics(
  id: string,
  payload: SharedLyricsPayload,
  expiresAt: string
): Promise<RecentSharedLyrics> {
  const current = (await activeStore.get<RecentSharedLyrics[]>(RECENT_LIST_KEY)) || []
  const filtered = current.filter((item) => item.id !== id)

  const record: RecentSharedLyrics = {
    id,
    name: payload.name || 'Shared Lyrics',
    songCount: payload.songs.length,
    expiresAt,
    openedAt: Date.now(),
    songs: payload.songs,
  }

  const updated = [record, ...filtered].slice(0, MAX_RECENT_ITEMS)
  await activeStore.set(RECENT_LIST_KEY, updated)
  return record
}

/**
 * Retrieves all saved recently opened shared lyrics, sorted by openedAt descending.
 */
export async function getRecentSharedLyrics(): Promise<RecentSharedLyrics[]> {
  const list = (await activeStore.get<RecentSharedLyrics[]>(RECENT_LIST_KEY)) || []
  return list.sort((a, b) => b.openedAt - a.openedAt)
}

/**
 * Retrieves a single cached shared lyrics set by its shortId.
 */
export async function getCachedSharedLyrics(id: string): Promise<RecentSharedLyrics | undefined> {
  const list = (await activeStore.get<RecentSharedLyrics[]>(RECENT_LIST_KEY)) || []
  return list.find((item) => item.id === id)
}

/**
 * Removes a specific shared lyrics set from local recent history.
 */
export async function removeRecentSharedLyrics(id: string): Promise<void> {
  const current = (await activeStore.get<RecentSharedLyrics[]>(RECENT_LIST_KEY)) || []
  const updated = current.filter((item) => item.id !== id)
  await activeStore.set(RECENT_LIST_KEY, updated)
}

/**
 * Clears all saved recently opened shared lyrics.
 */
export async function clearRecentSharedLyrics(): Promise<void> {
  await activeStore.del(RECENT_LIST_KEY)
}
