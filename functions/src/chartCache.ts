import { createHash } from 'node:crypto'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import type { Song } from './types.js'
import { checkUrl } from './urls.js'

/** Bump when the normalized Song schema or adapter output changes. */
export const CHART_CACHE_VERSION = 'chart-v2'
export const CHART_CACHE_TTL_MS = 6 * 60 * 60 * 1000
export const CHART_ALIAS_TTL_MS = 24 * 60 * 60 * 1000
export const CHART_CACHE_MAX_ENTRIES = 50
export const MAX_CACHED_CHART_BYTES = 700_000

const CHARTS_COLLECTION = 'sourceCharts'
const ALIASES_COLLECTION = 'chartAliases'

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'ref',
  'referrer',
])

/**
 * Canonical chart URL. Host case, tracking parameters and fragments are
 * ignored; meaningful parameters such as UG `version` and `simplified` remain.
 */
export function canonicalChartUrl(input: string): string {
  const url = new URL(input)
  url.hash = ''
  url.hostname = url.hostname.toLowerCase()
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b))
  url.search = ''
  for (const [key, value] of params) url.searchParams.append(key, value)
  return url.toString()
}

export interface ChartCacheEntry {
  v: 1
  parserVersion: string
  canonicalUrl: string
  song: Song
  expiresAt: number
}

export interface ChartAliasEntry {
  v: 1
  target: string
  expiresAt: number
}

export interface ChartCacheStore {
  getChart(key: string): Promise<ChartCacheEntry | null>
  setChart(key: string, entry: ChartCacheEntry): Promise<void>
  getAlias(key: string): Promise<ChartAliasEntry | null>
  setAlias(key: string, entry: ChartAliasEntry): Promise<void>
}

function database(): Firestore {
  if (getApps().length === 0) initializeApp()
  return getFirestore()
}

function documentId(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** Admin-only Firestore store. Rules deny browser reads and writes. */
export class FirestoreChartCacheStore implements ChartCacheStore {
  constructor(private readonly db: Firestore = database()) {}

  async getChart(key: string): Promise<ChartCacheEntry | null> {
    const snapshot = await this.db.collection(CHARTS_COLLECTION).doc(documentId(key)).get()
    return snapshot.exists ? (snapshot.data() as ChartCacheEntry) : null
  }

  async setChart(key: string, entry: ChartCacheEntry): Promise<void> {
    await this.db.collection(CHARTS_COLLECTION).doc(documentId(key)).set(entry)
  }

  async getAlias(key: string): Promise<ChartAliasEntry | null> {
    const snapshot = await this.db.collection(ALIASES_COLLECTION).doc(documentId(key)).get()
    return snapshot.exists ? (snapshot.data() as ChartAliasEntry) : null
  }

  async setAlias(key: string, entry: ChartAliasEntry): Promise<void> {
    await this.db.collection(ALIASES_COLLECTION).doc(documentId(key)).set(entry)
  }
}

interface ChartCacheOptions {
  store?: ChartCacheStore
  now?: () => number
  chartTtlMs?: number
  aliasTtlMs?: number
  maxEntries?: number
  parserVersion?: string
}

interface MemoryChartEntry {
  key: string
  entry: ChartCacheEntry
}

function isValidChartEntry(
  entry: unknown,
  now: number,
  version: string
): entry is ChartCacheEntry {
  if (!entry || typeof entry !== 'object') return false
  const value = entry as Partial<ChartCacheEntry>
  return (
    value.v === 1 &&
    value.parserVersion === version &&
    typeof value.expiresAt === 'number' &&
    value.expiresAt > now &&
    typeof value.canonicalUrl === 'string' &&
    Boolean(value.song) &&
    typeof value.song === 'object'
  )
}

/** Keeps shared source data only; browser/session-specific fields never enter the cache. */
export function toSourceSong(song: Song): Song {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    sourceUrl: song.sourceUrl,
    sourceSite: song.sourceSite,
    originalKey: song.originalKey,
    capo: song.capo,
    sections: song.sections,
    ...(song.flow ? { flow: song.flow } : {}),
    ...(song.simplifiedSections ? { simplifiedSections: song.simplifiedSections } : {}),
    ...(song.simplifiedFlow ? { simplifiedFlow: song.simplifiedFlow } : {}),
    ...(song.simplifiedSource ? { simplifiedSource: song.simplifiedSource } : {}),
    ...(song.simplificationPending ? { simplificationPending: song.simplificationPending } : {}),
  }
}

function isValidAlias(entry: unknown, now: number): entry is ChartAliasEntry {
  return Boolean(
    entry &&
      typeof entry === 'object' &&
      (entry as ChartAliasEntry).v === 1 &&
      typeof (entry as ChartAliasEntry).target === 'string' &&
      typeof (entry as ChartAliasEntry).expiresAt === 'number' &&
      (entry as ChartAliasEntry).expiresAt > now
  )
}

/**
 * Source-chart cache shared by all users. It stores only scraped Song data,
 * never browser edits, preferences, selected songs or session state.
 */
export class ChartCache {
  private store: ChartCacheStore | undefined
  private readonly now: () => number
  private readonly chartTtlMs: number
  private readonly aliasTtlMs: number
  private readonly maxEntries: number
  private readonly parserVersion: string
  private readonly memory = new Map<string, MemoryChartEntry>()

  constructor(options: ChartCacheOptions = {}) {
    this.store = options.store
    this.now = options.now ?? (() => Date.now())
    this.chartTtlMs = options.chartTtlMs ?? CHART_CACHE_TTL_MS
    this.aliasTtlMs = options.aliasTtlMs ?? CHART_ALIAS_TTL_MS
    this.maxEntries = Math.max(1, options.maxEntries ?? CHART_CACHE_MAX_ENTRIES)
    this.parserVersion = options.parserVersion ?? CHART_CACHE_VERSION
  }

  private persistentStore(): ChartCacheStore {
    this.store ??= new FirestoreChartCacheStore()
    return this.store
  }

  private memorySet(key: string, entry: ChartCacheEntry): void {
    this.memory.delete(key)
    this.memory.set(key, { key, entry })
    while (this.memory.size > this.maxEntries) {
      const oldest = this.memory.keys().next().value
      if (oldest === undefined) break
      this.memory.delete(oldest)
    }
  }

  private cachedMemory(key: string): ChartCacheEntry | null {
    const item = this.memory.get(key)
    if (!item) return null
    if (!isValidChartEntry(item.entry, this.now(), this.parserVersion)) {
      this.memory.delete(key)
      return null
    }
    return item.entry
  }

  /** Reads by canonical URL. Cache reads still require an allow-listed URL. */
  async get(url: string): Promise<Song | null> {
    let requested: string
    try {
      const check = checkUrl(url)
      if (!check.ok) return null
      requested = canonicalChartUrl(check.url)
    } catch {
      return null
    }

    const direct = await this.readChart(requested)
    if (direct) return direct

    // Follow a previously validated redirect alias.
    let alias: ChartAliasEntry | null
    try {
      alias = await this.persistentStore().getAlias(requested)
    } catch {
      return null
    }
    if (!alias || !isValidAlias(alias, this.now())) return null
    const target = checkUrl(alias.target)
    if (!target.ok) return null
    return this.readChart(canonicalChartUrl(target.url))
  }

  private async readChart(key: string): Promise<Song | null> {
    const local = this.cachedMemory(key)
    if (local) return local.song
    try {
      const persisted = await this.persistentStore().getChart(key)
      if (!persisted || !isValidChartEntry(persisted, this.now(), this.parserVersion)) return null
      this.memorySet(key, persisted)
      return persisted.song
    } catch {
      return null
    }
  }

  /**
   * Saves a validated source chart and the requested -> final redirect alias.
   * Cache write failures are ignored; extraction remains authoritative.
   */
  async save(requestedUrl: string, song: Song): Promise<void> {
    let requested: string
    let final: string
    try {
      const requestedCheck = checkUrl(requestedUrl)
      const finalCheck = checkUrl(song.sourceUrl)
      if (!requestedCheck.ok || !finalCheck.ok) return
      requested = canonicalChartUrl(requestedCheck.url)
      final = canonicalChartUrl(finalCheck.url)
    } catch {
      return
    }

    const expiresAt = this.now() + this.chartTtlMs
    const entry: ChartCacheEntry = {
      v: 1,
      parserVersion: this.parserVersion,
      canonicalUrl: final,
      song: toSourceSong(song),
      expiresAt,
    }
    if (JSON.stringify(entry).length > MAX_CACHED_CHART_BYTES) return

    this.memorySet(final, entry)
    try {
      await this.persistentStore().setChart(final, entry)
      if (requested !== final) {
        await this.persistentStore().setAlias(requested, {
          v: 1,
          target: final,
          expiresAt: this.now() + this.aliasTtlMs,
        })
      }
    } catch {
      // Cache is best-effort.
    }
  }
}

export const chartCache = new ChartCache()
