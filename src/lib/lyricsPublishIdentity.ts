import { createStore, get, set, del } from 'idb-keyval'
import type { SharedLyricsPayload } from '../types/song'
import { putSharedLyricsApi } from './api'

export const LYRICS_DOMAIN_SEPARATOR = 'lyrics-share-v1:'
const LYRICS_STORE_NAME = 'app_lyrics_shares_db'
const LYRICS_STORE_TABLE = 'identities'

export interface LyricsPublicationRecord {
  sessionId: string
  publicationId: string
  updateSecret: string
  expiresAt?: string
}

export interface LyricsStorageStore {
  get: <T>(key: string) => Promise<T | undefined>
  set: (key: string, val: unknown) => Promise<void>
  del: (key: string) => Promise<void>
}

function createDefaultStorageStore(): LyricsStorageStore {
  if (typeof indexedDB !== 'undefined') {
    const customStore = createStore(LYRICS_STORE_NAME, LYRICS_STORE_TABLE)
    return {
      get: <T>(key: string) => get<T>(key, customStore),
      set: (key: string, val: unknown) => set(key, val, customStore),
      del: (key: string) => del(key, customStore),
    }
  }

  // Memory store fallback when IndexedDB is unavailable (e.g. Node test environment)
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


let activeStorageStore: LyricsStorageStore = createDefaultStorageStore()

export function setLyricsStorageStoreForTesting(store: LyricsStorageStore): void {
  activeStorageStore = store
}

export function resetLyricsStorageStore(): void {
  activeStorageStore = createDefaultStorageStore()
}

/**
 * Generates a cryptographically random 32-byte secret encoded as 64 hex characters.
 */
export function generateUpdateSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Derives the publication ID from an update secret using domain-separated SHA-256.
 */
export async function deriveLyricsPublicationId(secret: string): Promise<string> {
  const enc = new TextEncoder()
  const data = enc.encode(`${LYRICS_DOMAIN_SEPARATOR}${secret}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function getLyricsPublicationIdentity(
  sessionId: string
): Promise<LyricsPublicationRecord | null> {
  const record = await activeStorageStore.get<LyricsPublicationRecord>(sessionId)
  return record || null
}

export async function saveLyricsPublicationIdentity(
  record: LyricsPublicationRecord
): Promise<void> {
  await activeStorageStore.set(record.sessionId, record)
}

export async function deleteLyricsPublicationIdentity(sessionId: string): Promise<void> {
  await activeStorageStore.del(sessionId)
}

/**
 * Retrieves existing publication identity for the given session ID,
 * or generates and persists a new one before any publication attempt.
 */
export async function getOrCreateLyricsPublicationIdentity(
  sessionId: string
): Promise<LyricsPublicationRecord> {
  const existing = await getLyricsPublicationIdentity(sessionId)
  if (existing) return existing

  const updateSecret = generateUpdateSecret()
  const publicationId = await deriveLyricsPublicationId(updateSecret)
  const record: LyricsPublicationRecord = {
    sessionId,
    publicationId,
    updateSecret,
  }
  // Persist identity before any network call
  await saveLyricsPublicationIdentity(record)
  return record
}

/**
 * Persists the returned expiry metadata after a successful publication.
 */
export async function recordLyricsPublicationSuccess(
  sessionId: string,
  expiresAt: string
): Promise<LyricsPublicationRecord> {
  const record = await getLyricsPublicationIdentity(sessionId)
  if (!record) {
    throw new Error(`No lyrics publication identity found for session: ${sessionId}`)
  }
  const updated: LyricsPublicationRecord = {
    ...record,
    expiresAt,
  }
  await saveLyricsPublicationIdentity(updated)
  return updated
}

// In-memory mutex for environments where Web Locks API is absent (e.g. testing)
const memoryLocks = new Map<string, Promise<unknown>>()

/**
 * Serializes publication operations for a given session across browser tabs.
 */
export async function withLyricsPublicationLock<T>(
  sessionId: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockName = `lyrics-publish:${sessionId}`
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(lockName, () => fn())
  }

  while (memoryLocks.has(lockName)) {
    try {
      await memoryLocks.get(lockName)
    } catch {
      // Ignore errors from preceding lock holder
    }
  }

  let releaseLock!: () => void
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve
  })
  memoryLocks.set(lockName, lockPromise)

  try {
    return await fn()
  } finally {
    memoryLocks.delete(lockName)
    releaseLock()
  }
}

export interface PublishLyricsResult {
  id: string
  expiresAt: string
  shareUrl: string
}

/**
 * Atomically publishes lyrics for a session using the session's stable publication identity.
 */
export async function publishLyricsForSession(
  sessionId: string,
  payload: SharedLyricsPayload,
  apiPublisher: (
    id: string,
    secret: string,
    data: SharedLyricsPayload
  ) => Promise<{ id: string; expiresAt: string }> = putSharedLyricsApi
): Promise<PublishLyricsResult> {
  return withLyricsPublicationLock(sessionId, async () => {
    const identity = await getOrCreateLyricsPublicationIdentity(sessionId)
    const result = await apiPublisher(identity.publicationId, identity.updateSecret, payload)
    await recordLyricsPublicationSuccess(sessionId, result.expiresAt)
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return {
      id: result.id,
      expiresAt: result.expiresAt,
      shareUrl: `${origin}/lyrics/${result.id}`,
    }
  })
}
