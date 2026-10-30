import type { Firestore } from 'firebase-admin/firestore'
import { BoundedMap } from '../boundedMap.js'
import { database, documentId, ttlAt } from '../firestore.js'
import type { SearchCandidate, SearchSourceStatus } from './types.js'

/**
 * Search cache version. Bump when the selection policy or response shape
 * changes so old documents can never be mistaken for current results.
 */
export const SEARCH_CACHE_VERSION = 'search-v3'
export const SEARCH_CACHE_TTL_MS = 5 * 60_000
export const PARTIAL_SEARCH_CACHE_TTL_MS = 30_000
export const SEARCH_CACHE_MAX_ENTRIES = 100
const COLLECTION = 'searchCache'

export interface SearchResponseData {
  results: SearchCandidate[]
  sources: SearchSourceStatus[]
  partial: boolean
}

export interface CachedSearchEntry extends SearchResponseData {
  v: 1
  expiresAt: number
}

export type SearchCacheStatus = 'hit' | 'miss' | 'unavailable'

export interface SearchCacheStore {
  get(key: string): Promise<CachedSearchEntry | null>
  set(key: string, entry: CachedSearchEntry): Promise<void>
}

/** Normalises lookup only; the original query text is still sent upstream. */
export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function createSearchCacheKey(query: string, version = SEARCH_CACHE_VERSION): string {
  return `${version}:${normalizeSearchQuery(query)}`
}

export function isCachedSearchEntry(value: unknown, now = Date.now()): value is CachedSearchEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<CachedSearchEntry>
  return (
    entry.v === 1 &&
    typeof entry.expiresAt === 'number' &&
    entry.expiresAt > now &&
    Array.isArray(entry.results) &&
    Array.isArray(entry.sources) &&
    typeof entry.partial === 'boolean'
  )
}

/**
 * Firestore-backed cache shared between instances. Collection rules deny all
 * browser access; only the Admin SDK used by the function can read it.
 */
export class FirestoreSearchCacheStore implements SearchCacheStore {
  constructor(
    private readonly db: Firestore = database(),
    private readonly now: () => number = () => Date.now()
  ) {}

  async get(key: string): Promise<CachedSearchEntry | null> {
    const snapshot = await this.db.collection(COLLECTION).doc(documentId(key)).get()
    if (!snapshot.exists) return null
    const entry = snapshot.data()
    return isCachedSearchEntry(entry, this.now()) ? entry : null
  }

  async set(key: string, entry: CachedSearchEntry): Promise<void> {
    await this.db
      .collection(COLLECTION)
      .doc(documentId(key))
      .set({ ...entry, ttlAt: ttlAt(entry.expiresAt) })
  }
}

interface SearchCacheOptions {
  store?: SearchCacheStore
  now?: () => number
  completeTtlMs?: number
  partialTtlMs?: number
  maxEntries?: number
  version?: string
}

export interface SearchCacheLookup {
  data: SearchResponseData
  cacheStatus: SearchCacheStatus
  expiresAt: number
}

/**
 * Instance-local search cache with cross-instance Firestore reuse.
 *
 * Duplicate suppression is instance-local only: the in-flight map is not a
 * distributed lock. Two instances can still perform the same upstream search
 * on a cold cache; Firestore then lets later requests reuse either result.
 */
export class SearchCache {
  private store: SearchCacheStore | undefined
  private readonly now: () => number
  private readonly completeTtlMs: number
  private readonly partialTtlMs: number
  private readonly version: string
  private readonly memory: BoundedMap<CachedSearchEntry>
  private readonly inFlight = new Map<string, Promise<SearchCacheLookup>>()

  constructor(options: SearchCacheOptions = {}) {
    this.store = options.store
    this.now = options.now ?? (() => Date.now())
    this.completeTtlMs = options.completeTtlMs ?? SEARCH_CACHE_TTL_MS
    this.partialTtlMs = options.partialTtlMs ?? PARTIAL_SEARCH_CACHE_TTL_MS
    this.memory = new BoundedMap(Math.max(1, options.maxEntries ?? SEARCH_CACHE_MAX_ENTRIES))
    this.version = options.version ?? SEARCH_CACHE_VERSION
  }

  private memoryGet(key: string): CachedSearchEntry | null {
    const entry = this.memory.get(key)
    if (!entry) return null
    if (entry.expiresAt <= this.now()) {
      this.memory.delete(key)
      return null
    }
    return entry
  }

  private persistentStore(): SearchCacheStore {
    this.store ??= new FirestoreSearchCacheStore()
    return this.store
  }

  private async read(key: string): Promise<CachedSearchEntry | null> {
    const local = this.memoryGet(key)
    if (local) return local
    try {
      const persisted = await this.persistentStore().get(key)
      if (!persisted || !isCachedSearchEntry(persisted, this.now())) return null
      this.memory.set(key, persisted)
      return persisted
    } catch {
      // Persistent cache failures degrade to a normal upstream search.
      return null
    }
  }

  private async write(
    key: string,
    data: SearchResponseData
  ): Promise<CachedSearchEntry> {
    const ttl = data.partial ? this.partialTtlMs : this.completeTtlMs
    const entry: CachedSearchEntry = {
      v: 1,
      ...data,
      expiresAt: this.now() + ttl,
    }
    this.memory.set(key, entry)
    // Partial or failed-site results are short-lived and instance-local only.
    if (!data.partial) {
      try {
        await this.persistentStore().set(key, entry)
      } catch {
        // Cache writes are best-effort.
      }
    }
    return entry
  }

  /**
   * Returns cached data when fresh; otherwise runs `run` once per instance for
   * identical concurrent keys. Failed promises are always removed.
   */
  async search(
    query: string,
    run: (query: string) => Promise<SearchResponseData>
  ): Promise<SearchCacheLookup> {
    const key = createSearchCacheKey(query, this.version)
    const active = this.inFlight.get(key)
    if (active) return active

    const cached = await this.read(key)
    if (cached) {
      return { data: cached, cacheStatus: 'hit', expiresAt: cached.expiresAt }
    }

    const raced = this.inFlight.get(key)
    if (raced) return raced

    const task = (async (): Promise<SearchCacheLookup> => {
      const data = await run(query)
      const entry = await this.write(key, data)
      return { data, cacheStatus: 'miss', expiresAt: entry.expiresAt }
    })()

    this.inFlight.set(key, task)
    try {
      return await task
    } finally {
      this.inFlight.delete(key)
    }
  }
}

export const searchCache = new SearchCache()
