import { get, set, del, entries } from 'idb-keyval'
import type { Song } from '../types/song'
import { simplifySections } from './chords'
import { canonicalChartUrl } from '../../functions/src/urls'

const CACHE_PREFIX = 'song:'
const FAILED_PREFIX = 'failed:'
const ALIAS_PREFIX = 'alias:'
const FAILED_TTL_MS = 60_000 // 60 seconds TTL for failed URLs

export interface StorageStore {
  get: typeof get
  set: typeof set
  del: typeof del
  entries: typeof entries
}

const defaultStore: StorageStore = { get, set, del, entries }

/** Normalizes URL by lowercasing host, dropping fragment, stripping tracking params and sorting the rest. */
export function normalizeSongUrl(input: string): string {
  try {
    const u = new URL(input)
    // upload:// and other non-web ids are keys, not chart URLs.
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return input.trim()
    return canonicalChartUrl(input)
  } catch {
    return input.trim()
  }
}

/** The pre-canonical rule. Only used to find entries saved before the rules were unified. */
function legacyNormalizeSongUrl(input: string): string {
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
    const normalized = normalizeSongUrl(url)
    const val = await this.readSong(normalized, url)
    if (!val) return null

    // Enrich older website songs that have no usable simplified sections
    const isUpload = Boolean(val.sourceUrl?.startsWith('upload://') || url.startsWith('upload://'))
    const hasUsableSimplified = Boolean(val.simplifiedSections && val.simplifiedSections.length > 0)

    if (!isUpload && !hasUsableSimplified && val.sections && val.sections.length > 0) {
      const { sections: fallbackSections, changedCount } = simplifySections(val.sections)
      if (changedCount > 0) {
        val.simplifiedSections = fallbackSections
        if (val.flow) val.simplifiedFlow = val.flow
        val.simplifiedSource = 'algorithmic'
        await this.store.set(`${CACHE_PREFIX}${normalizeSongUrl(val.sourceUrl)}`, val)
      }
    }

    return val
  }

  private async readSong(normalizedUrl: string, rawUrl: string): Promise<Song | null> {
    const direct = await this.store.get<Song>(`${CACHE_PREFIX}${normalizedUrl}`)
    if (direct) return direct

    // Older entries are keyed by their final URL. A validated redirect alias
    // lets lookups through the original URL still find them.
    const target = await this.store.get<string>(`${ALIAS_PREFIX}${normalizedUrl}`)
    if (typeof target === 'string') {
      const finalUrl = normalizeSongUrl(target)
      if (finalUrl !== normalizedUrl) {
        const viaAlias = await this.store.get<Song>(`${CACHE_PREFIX}${finalUrl}`)
        if (viaAlias) return viaAlias
      }
    }

    // Entries saved under the old rule: copy to the new key, keep the old one.
    const legacyKey = legacyNormalizeSongUrl(rawUrl)
    if (legacyKey === normalizedUrl) return null
    const legacy = await this.store.get<Song>(`${CACHE_PREFIX}${legacyKey}`)
    if (!legacy) return null
    await this.store.set(`${CACHE_PREFIX}${normalizedUrl}`, legacy)
    return legacy
  }

  async saveSong(song: Song, requestedUrl?: string): Promise<void> {
    const finalUrl = normalizeSongUrl(song.sourceUrl)
    const key = `${CACHE_PREFIX}${finalUrl}`
    await this.store.set(key, song)
    // Clear any temporary failed marker
    await this.store.del(`${FAILED_PREFIX}${finalUrl}`)

    if (requestedUrl) {
      const originalUrl = normalizeSongUrl(requestedUrl)
      if (originalUrl !== finalUrl) {
        await this.store.set(`${ALIAS_PREFIX}${originalUrl}`, finalUrl)
        await this.store.del(`${FAILED_PREFIX}${originalUrl}`)
      }
    }
  }

  async saveAlias(requestedUrl: string, finalUrl: string): Promise<void> {
    const from = normalizeSongUrl(requestedUrl)
    const to = normalizeSongUrl(finalUrl)
    if (from !== to) await this.store.set(`${ALIAS_PREFIX}${from}`, to)
  }

  async getAlias(url: string): Promise<string | null> {
    const target = await this.store.get<string>(`${ALIAS_PREFIX}${normalizeSongUrl(url)}`)
    return typeof target === 'string' ? target : null
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
      if (
        typeof key === 'string' &&
        (key.startsWith(CACHE_PREFIX) ||
          key.startsWith(FAILED_PREFIX) ||
          key.startsWith(ALIAS_PREFIX))
      ) {
        await this.store.del(key)
      }
    }
  }
}

export const songCache = new SongCache()
