import { createHash } from 'node:crypto'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import type { Section } from './types.js'
import { FetchError, safeFetchHtml } from './safeFetch.js'
import { checkUrl, siteForHost } from './urls.js'
import { canonicalChartUrl, chartCache, type ChartCache } from './chartCache.js'
import { adapterForUrl } from './scraper.js'
import { deduplicateSongSections, normalizeSongText } from './normalizer.js'
import { elapsedMs, recordTiming } from './metrics.js'

export const SIMPLIFICATION_CACHE_VERSION = 'simplification-v2'
export const SIMPLIFICATION_CACHE_TTL_MS = 6 * 60 * 60 * 1000
export const SIMPLIFICATION_UNAVAILABLE_TTL_MS = 5 * 60 * 1000
export const SIMPLIFICATION_CACHE_MAX_ENTRIES = 100
const COLLECTION = 'chartSimplifications'

export type OfficialSimplificationResult =
  | {
      status: 'ok'
      simplifiedSections: Section[]
      simplifiedFlow?: number[]
      simplifiedSource: 'official'
      cached?: boolean
    }
  | {
      status: 'unavailable'
      code?: string
      message?: string
      cached?: boolean
    }

interface SimplificationCacheEntry {
  v: 1
  parserVersion: string
  canonicalUrl: string
  status: 'ok' | 'unavailable'
  simplifiedSections?: Section[]
  simplifiedFlow?: number[]
  code?: string
  message?: string
  expiresAt: number
}

export interface SimplificationCacheStore {
  get(key: string): Promise<SimplificationCacheEntry | null>
  set(key: string, entry: SimplificationCacheEntry): Promise<void>
}

function database(): Firestore {
  if (getApps().length === 0) initializeApp()
  return getFirestore()
}

function documentId(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export class FirestoreSimplificationCacheStore implements SimplificationCacheStore {
  constructor(private readonly db: Firestore = database()) {}

  async get(key: string): Promise<SimplificationCacheEntry | null> {
    const snapshot = await this.db.collection(COLLECTION).doc(documentId(key)).get()
    return snapshot.exists ? (snapshot.data() as SimplificationCacheEntry) : null
  }

  async set(key: string, entry: SimplificationCacheEntry): Promise<void> {
    await this.db.collection(COLLECTION).doc(documentId(key)).set(entry)
  }
}

interface SimplificationCacheOptions {
  store?: SimplificationCacheStore
  now?: () => number
  ttlMs?: number
  unavailableTtlMs?: number
  maxEntries?: number
  version?: string
}

function isEntryValid(
  entry: unknown,
  now: number,
  version: string
): entry is SimplificationCacheEntry {
  if (!entry || typeof entry !== 'object') return false
  const value = entry as Partial<SimplificationCacheEntry>
  return (
    value.v === 1 &&
    value.parserVersion === version &&
    typeof value.expiresAt === 'number' &&
    value.expiresAt > now &&
    typeof value.canonicalUrl === 'string' &&
    (value.status === 'ok' || value.status === 'unavailable')
  )
}

export class SimplificationCache {
  private store: SimplificationCacheStore | undefined
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly unavailableTtlMs: number
  private readonly maxEntries: number
  private readonly version: string
  private readonly memory = new Map<string, { key: string; entry: SimplificationCacheEntry }>()

  constructor(options: SimplificationCacheOptions = {}) {
    this.store = options.store
    this.now = options.now ?? (() => Date.now())
    this.ttlMs = options.ttlMs ?? SIMPLIFICATION_CACHE_TTL_MS
    this.unavailableTtlMs = options.unavailableTtlMs ?? SIMPLIFICATION_UNAVAILABLE_TTL_MS
    this.maxEntries = Math.max(1, options.maxEntries ?? SIMPLIFICATION_CACHE_MAX_ENTRIES)
    this.version = options.version ?? SIMPLIFICATION_CACHE_VERSION
  }

  private persistentStore(): SimplificationCacheStore {
    this.store ??= new FirestoreSimplificationCacheStore()
    return this.store
  }

  private memorySet(key: string, entry: SimplificationCacheEntry): void {
    this.memory.delete(key)
    this.memory.set(key, { key, entry })
    while (this.memory.size > this.maxEntries) {
      const oldest = this.memory.keys().next().value
      if (oldest === undefined) break
      this.memory.delete(oldest)
    }
  }

  async get(url: string): Promise<OfficialSimplificationResult | null> {
    let canonical: string
    try {
      const check = checkUrl(url)
      if (!check.ok) return null
      canonical = canonicalChartUrl(check.url)
    } catch {
      return null
    }

    const local = this.memory.get(canonical)
    let entry: SimplificationCacheEntry | null = null
    if (local && isEntryValid(local.entry, this.now(), this.version)) {
      entry = local.entry
    } else {
      this.memory.delete(canonical)
      try {
        const persisted = await this.persistentStore().get(canonical)
        if (persisted && isEntryValid(persisted, this.now(), this.version)) {
          entry = persisted
          this.memorySet(canonical, persisted)
        }
      } catch {
        return null
      }
    }
    if (!entry) return null
    return entry.status === 'ok'
      ? {
          status: 'ok',
          simplifiedSections: entry.simplifiedSections ?? [],
          ...(entry.simplifiedFlow ? { simplifiedFlow: entry.simplifiedFlow } : {}),
          simplifiedSource: 'official',
          cached: true,
        }
      : {
          status: 'unavailable',
          code: entry.code,
          message: entry.message,
          cached: true,
        }
  }

  async set(url: string, result: OfficialSimplificationResult): Promise<void> {
    let canonical: string
    try {
      const check = checkUrl(url)
      if (!check.ok) return
      canonical = canonicalChartUrl(check.url)
    } catch {
      return
    }
    const ttl = result.status === 'ok' ? this.ttlMs : this.unavailableTtlMs
    const entry: SimplificationCacheEntry = {
      v: 1,
      parserVersion: this.version,
      canonicalUrl: canonical,
      status: result.status,
      expiresAt: this.now() + ttl,
      ...(result.status === 'ok'
        ? { simplifiedSections: result.simplifiedSections, simplifiedFlow: result.simplifiedFlow }
        : { code: result.code, message: result.message }),
    }
    this.memorySet(canonical, entry)
    try {
      await this.persistentStore().set(canonical, entry)
    } catch {
      // Enrichment still succeeds; cache writes are best-effort.
    }
  }
}

export const simplificationCache = new SimplificationCache()

const inFlight = new Map<string, Promise<OfficialSimplificationResult>>()

async function fetchOfficialSimplification(
  url: string,
  fetchFn: typeof safeFetchHtml
): Promise<OfficialSimplificationResult> {
  const startedAt = Date.now()
  try {
    const source = new URL(url)
    if (source.searchParams.get('simplified') === '1') {
      // Already the enrichment URL; fetch it once.
    } else {
      source.searchParams.set('simplified', '1')
    }
    const { text, finalUrl } = await fetchFn(source.toString())
    const adapter = adapterForUrl(finalUrl)
    const raw = adapter.extract(text, finalUrl)
    const { sections: simplifiedSections, flow: simplifiedFlow } = deduplicateSongSections(
      normalizeSongText(raw.content)
    )
    if (simplifiedSections.length === 0) {
      recordTiming({
        operation: 'chart.simplify',
        site: 'ultimate-guitar',
        durationMs: elapsedMs(startedAt),
        outcome: 'empty',
      })
      return { status: 'unavailable', code: 'EMPTY_SIMPLIFICATION', message: 'No official simplified chart was available' }
    }
    recordTiming({
      operation: 'chart.simplify',
      site: 'ultimate-guitar',
      durationMs: elapsedMs(startedAt),
      outcome: 'ok',
    })
    return { status: 'ok', simplifiedSections, simplifiedFlow, simplifiedSource: 'official' }
  } catch (err) {
    const fetchError = err as FetchError
    const code = fetchError?.code ?? 'SIMPLIFICATION_FAILED'
    const blocked = fetchError?.status === 403 || fetchError?.status === 429
    const outcome = code === 'TIMEOUT' ? 'timeout' : blocked ? 'blocked' : 'error'
    recordTiming({
      operation: 'chart.simplify',
      site: 'ultimate-guitar',
      durationMs: elapsedMs(startedAt),
      outcome,
    })
    return {
      status: 'unavailable',
      code,
      message: (err as Error)?.message || 'Could not load the official simplified chart',
    }
  }
}

/**
 * Lazily loads an official simplification and updates the shared source chart.
 * Concurrent identical requests coalesce per instance and results are cached.
 */
export interface SimplificationDeps {
  fetchFn?: typeof safeFetchHtml
  cache?: SimplificationCache
  sourceCache?: ChartCache
}

export async function loadOfficialSimplification(
  url: string,
  deps: SimplificationDeps = {}
): Promise<OfficialSimplificationResult> {
  const check = checkUrl(url)
  if (!check.ok) {
    throw new FetchError(`Invalid or disallowed URL: ${check.reason}`, 'INVALID_URL')
  }
  if (siteForHost(new URL(check.url).hostname) !== 'ultimate-guitar') {
    return { status: 'unavailable', code: 'UNSUPPORTED_SOURCE', message: 'This source has no official simplification' }
  }
  const mirror = deps.cache ?? simplificationCache
  const sourceCache = deps.sourceCache ?? chartCache
  const canonical = canonicalChartUrl(check.url)
  const cached = await mirror.get(canonical)
  if (cached) return cached

  const active = inFlight.get(canonical)
  if (active) return active

  const task = (async (): Promise<OfficialSimplificationResult> => {
    const result = await fetchOfficialSimplification(
      check.url,
      deps.fetchFn ?? safeFetchHtml
    )
    if (result.status === 'ok') {
      const existing = await sourceCache.get(check.url)
      if (existing) {
        const sameAsOriginal =
          JSON.stringify(existing.sections) === JSON.stringify(result.simplifiedSections)
        if (sameAsOriginal) {
          const unavailable: OfficialSimplificationResult = {
            status: 'unavailable',
            code: 'NO_DISTINCT_SIMPLIFICATION',
            message: 'The source returned the original chart for the simplified request',
          }
          await mirror.set(check.url, unavailable)
          return unavailable
        }
        await sourceCache.save(check.url, {
          ...existing,
          simplifiedSections: result.simplifiedSections,
          simplifiedFlow: result.simplifiedFlow,
          simplifiedSource: 'official',
          simplificationPending: false,
        })
      }
    }
    await mirror.set(check.url, result)
    return result
  })()

  inFlight.set(canonical, task)
  try {
    return await task
  } finally {
    inFlight.delete(canonical)
  }
}
