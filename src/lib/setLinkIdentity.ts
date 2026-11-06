import { createStore, get, set, del } from 'idb-keyval'
import { withNamedLock } from './lyricsPublishIdentity'

export const SET_LINK_DOMAIN_SEPARATOR = 'set-link-v1:'
export const LIVE_SET_DOMAIN_SEPARATOR = 'live-set-v1:'
const SET_LINK_STORE_NAME = 'app_set_links_db'
const SET_LINK_STORE_TABLE = 'identities'
const SET_LINK_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/

/**
 * Per-set write identity plus sync bookkeeping. Bookkeeping lives here and never in the
 * session record, so saving it cannot trigger the session change listener.
 */
export interface SetLinkIdentityRecord {
  sessionId: string
  publicId: string
  secret: string
  lastPublishedHash?: string
  expiresAt?: string
}

export interface SetLinkIdentityStore {
  get: <T>(key: string) => Promise<T | undefined>
  set: (key: string, val: unknown) => Promise<void>
  del: (key: string) => Promise<void>
}

export function createDefaultSetLinkIdentityStore(): SetLinkIdentityStore {
  if (typeof indexedDB !== 'undefined') {
    const customStore = createStore(SET_LINK_STORE_NAME, SET_LINK_STORE_TABLE)
    return {
      get: <T>(key: string) => get<T>(key, customStore),
      set: (key: string, val: unknown) => set(key, val, customStore),
      del: (key: string) => del(key, customStore),
    }
  }

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

let activeStore: SetLinkIdentityStore = createDefaultSetLinkIdentityStore()

export function setSetLinkIdentityStoreForTesting(store: SetLinkIdentityStore): void {
  activeStore = store
}

export function resetSetLinkIdentityStore(): void {
  activeStore = createDefaultSetLinkIdentityStore()
}

export function getSetLinkIdentityStore(): SetLinkIdentityStore {
  return activeStore
}

export function isSetLinkId(value: string): boolean {
  return SET_LINK_ID_PATTERN.test(value)
}

/** 32 random bytes as 64 lowercase hex characters. */
export function generateSetLinkSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** First 16 bytes of SHA-256(domain + secret), base64url without padding. */
export async function deriveSetLinkId(
  secret: string,
  domain: string = SET_LINK_DOMAIN_SEPARATOR
): Promise<string> {
  const data = new TextEncoder().encode(`${domain}${secret}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toBase64Url(new Uint8Array(digest).slice(0, 16))
}

export async function getSetLinkIdentity(
  sessionId: string,
  store: SetLinkIdentityStore = activeStore
): Promise<SetLinkIdentityRecord | null> {
  return (await store.get<SetLinkIdentityRecord>(sessionId)) ?? null
}

export async function saveSetLinkIdentity(
  record: SetLinkIdentityRecord,
  store: SetLinkIdentityStore = activeStore
): Promise<void> {
  await store.set(record.sessionId, record)
}

export async function deleteSetLinkIdentity(
  sessionId: string,
  store: SetLinkIdentityStore = activeStore
): Promise<void> {
  await store.del(sessionId)
}

export async function getOrCreateSetLinkIdentity(
  sessionId: string,
  store: SetLinkIdentityStore = activeStore
): Promise<SetLinkIdentityRecord> {
  const existing = await getSetLinkIdentity(sessionId, store)
  if (existing) return existing
  // Concurrent getAllSessions() calls (and other tabs) can migrate the same session at once.
  // Without serialising, each would mint a different secret and the session's publicId could
  // end up not matching the stored secret, leaving a link that can never be published.
  const key = `set-link-identity:${sessionId}`
  const pending = pendingCreates.get(key)
  if (pending) return pending
  const task = withNamedLock(key, async () => {
    const raced = await getSetLinkIdentity(sessionId, store)
    if (raced) return raced
    const secret = generateSetLinkSecret()
    const record: SetLinkIdentityRecord = {
      sessionId,
      publicId: await deriveSetLinkId(secret),
      secret,
    }
    await saveSetLinkIdentity(record, store)
    return record
  }).finally(() => pendingCreates.delete(key))
  pendingCreates.set(key, task)
  return task
}

const pendingCreates = new Map<string, Promise<SetLinkIdentityRecord>>()
