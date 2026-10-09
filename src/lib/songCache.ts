import { get, set, del, entries } from 'idb-keyval'
import type { Song } from '../types/song'

const CACHE_PREFIX = 'song:'
const FAILED_PREFIX = 'failed:'
const FAILED_TTL_MS = 60_000 // 60 seconds TTL for failed URLs

export interface StorageStore {
  get: typeof get
  set: typeof set
  del: typeof del
  entries: typeof entries
}

const defaultStore: StorageStore = { get, set, del, entries }

/** Normalizes URL by lowercasing host, dropping fragment, and stripping tracking params. */
export function normalizeSongUrl(input: string): string {
  try {
    const u = new URL(input)
    u.hash = ''
    u.searchParams.delete('utm_source')
    u.searchParams.delete('utm_medium')
    u.searchParams.delete('utm_campaign')
    u.searchParams.delete('fbclid')
    u.searchParams.delete('gclid')
    return u.toString()
  } catch {
    return input.trim()
  }
}

export class SongCache {
  private readonly store: StorageStore

  constructor(store: StorageStore = defaultStore) {
    this.store = store
  }

  async getSong(url: string): Promise<Song | null> {
    const key = `${CACHE_PREFIX}${normalizeSongUrl(url)}`
    const val = await this.store.get<Song>(key)
    return val ?? null
  }

  async saveSong(song: Song): Promise<void> {
    const key = `${CACHE_PREFIX}${normalizeSongUrl(song.sourceUrl)}`
    await this.store.set(key, song)
    // Clear any temporary failed marker
    await this.store.del(`${FAILED_PREFIX}${normalizeSongUrl(song.sourceUrl)}`)
  }

  async recordFailed(url: string, reason: string): Promise<void> {
    const key = `${FAILED_PREFIX}${normalizeSongUrl(url)}`
    await this.store.set(key, { reason, expiresAt: Date.now() + FAILED_TTL_MS })
  }

  async getFailed(url: string): Promise<string | null> {
    const key = `${FAILED_PREFIX}${normalizeSongUrl(url)}`
    const val = await this.store.get<{ reason: string; expiresAt: number }>(key)
    if (!val) return null
    if (Date.now() > val.expiresAt) {
      await this.store.del(key)
      return null
    }
    return val.reason
  }

  async removeSong(url: string): Promise<void> {
    const key = `${CACHE_PREFIX}${normalizeSongUrl(url)}`
    await this.store.del(key)
  }

  async clearAll(): Promise<void> {
    const all = await this.store.entries()
    for (const [key] of all) {
      if (typeof key === 'string' && (key.startsWith(CACHE_PREFIX) || key.startsWith(FAILED_PREFIX))) {
        await this.store.del(key)
      }
    }
  }
}

export const songCache = new SongCache()
