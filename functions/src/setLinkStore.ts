import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import crypto from 'node:crypto'
import { database } from './firestore.js'
import { isExpired } from './shareStore.js'
import type { SetLinkPayload, SetLinkSong } from './types.js'

export const MAX_SET_LINK_SONGS = 30
export const SET_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** A write whose hash is unchanged is skipped while more than this much lifetime remains. */
export const SET_LINK_REFRESH_BELOW_MS = 6 * 24 * 60 * 60 * 1000
export const SET_LINK_MIN_WRITE_INTERVAL_MS = 5000
export const SET_LINK_DAILY_WRITE_CAP = 200
export const SET_LINK_DOMAIN_SEPARATOR = 'set-link-v1:'
const COLLECTION = 'setLinks'

export type SetLinkLookup =
  | { kind: 'found'; payload: SetLinkPayload; expiresAt: Date }
  | { kind: 'expired' }
  | { kind: 'missing' }

export class SetLinkThrottledError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(`Set link updated too often. Try again in ${retryAfterSeconds}s`)
    this.name = 'SetLinkThrottledError'
  }
}

/** Public ID: first 16 bytes of SHA-256("set-link-v1:" + secret), base64url without padding (22 chars). */
export function derivePublicId(secret: string): string {
  return crypto
    .createHash('sha256')
    .update(`${SET_LINK_DOMAIN_SEPARATOR}${secret}`)
    .digest()
    .subarray(0, 16)
    .toString('base64url')
}

export function verifySetLinkSecret(secret: string, id: string): boolean {
  if (!secret || !id) return false
  try {
    const a = Buffer.from(derivePublicId(secret), 'base64url')
    const b = Buffer.from(id, 'base64url')
    if (a.length !== 16 || a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function optString(value: unknown, max: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= max)
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function isSetLinkSong(value: unknown): value is SetLinkSong {
  if (!value || typeof value !== 'object') return false
  const s = value as Record<string, unknown>
  return (
    typeof s.entryId === 'string' &&
    s.entryId.trim().length >= 1 &&
    s.entryId.trim().length <= 100 &&
    isHttpUrl(s.url) &&
    optString(s.title, 300) &&
    optString(s.artist, 300) &&
    optString(s.targetKey, 10) &&
    optString(s.customPadKey, 10) &&
    (s.simplified === undefined || typeof s.simplified === 'boolean') &&
    (s.padKeyMode === undefined || s.padKeyMode === 'match' || s.padKeyMode === 'custom')
  )
}

export function isSetLinkPayload(value: unknown): value is SetLinkPayload {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return (
    p.v === 1 &&
    typeof p.name === 'string' &&
    p.name.trim().length >= 1 &&
    p.name.trim().length <= 200 &&
    Array.isArray(p.songs) &&
    p.songs.length >= 1 &&
    p.songs.length <= MAX_SET_LINK_SONGS &&
    p.songs.every(isSetLinkSong)
  )
}

/** Rebuilds the payload from whitelisted fields only, in a fixed key order. */
export function sanitizeSetLinkPayload(payload: SetLinkPayload): SetLinkPayload {
  return {
    v: 1,
    name: payload.name.trim(),
    songs: payload.songs.map((s) => {
      const song: SetLinkSong = { entryId: s.entryId.trim(), url: s.url }
      if (s.title !== undefined) song.title = s.title
      if (s.artist !== undefined) song.artist = s.artist
      if (s.targetKey !== undefined) song.targetKey = s.targetKey
      if (s.simplified !== undefined) song.simplified = s.simplified
      if (s.padKeyMode !== undefined) song.padKeyMode = s.padKeyMode
      if (s.customPadKey !== undefined) song.customPadKey = s.customPadKey
      return song
    }),
  }
}

export function hashSetLinkPayload(payload: SetLinkPayload): string {
  // sanitize emits a fixed key order, so JSON.stringify is canonical.
  return crypto.createHash('sha256').update(JSON.stringify(sanitizeSetLinkPayload(payload))).digest('hex')
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export class SetLinkStore {
  private readonly db: Firestore
  private readonly now: () => Date

  constructor(db: Firestore = database(), now: () => Date = () => new Date()) {
    this.db = db
    this.now = now
  }

  /**
   * Creates or updates the set link. Skips the write when nothing changed and
   * the expiry is still fresh; a same-content write near expiry slides the TTL.
   */
  async publish(
    id: string,
    payload: SetLinkPayload
  ): Promise<{ id: string; expiresAt: Date; unchanged: boolean }> {
    if (!isSetLinkPayload(payload)) throw new Error('Invalid set link payload')
    const clean = sanitizeSetLinkPayload(payload)
    const payloadHash = hashSetLinkPayload(clean)
    const ref = this.db.collection(COLLECTION).doc(id)

    return this.db.runTransaction(async (transaction) => {
      const now = this.now()
      const snap = await transaction.get(ref)
      const existing = snap.exists ? snap.data() : undefined
      const existingExpires = existing?.expiresAt instanceof Timestamp ? existing.expiresAt.toDate() : null
      const live = existing !== undefined && !isExpired(existingExpires, now)

      if (
        live &&
        existing.payloadHash === payloadHash &&
        existingExpires!.getTime() - now.getTime() > SET_LINK_REFRESH_BELOW_MS
      ) {
        return { id, expiresAt: existingExpires!, unchanged: true }
      }

      const today = utcDay(now)
      let writeCount = 1
      if (existing) {
        const updatedAt = existing.updatedAt instanceof Timestamp ? existing.updatedAt.toDate() : null
        if (updatedAt) {
          const sinceMs = now.getTime() - updatedAt.getTime()
          if (sinceMs >= 0 && sinceMs < SET_LINK_MIN_WRITE_INTERVAL_MS) {
            throw new SetLinkThrottledError(Math.ceil((SET_LINK_MIN_WRITE_INTERVAL_MS - sinceMs) / 1000))
          }
        }
        if (existing.writeDay === today) {
          const prior = Number(existing.writeCount) || 0
          if (prior >= SET_LINK_DAILY_WRITE_CAP) {
            const nextDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
            throw new SetLinkThrottledError(Math.max(1, Math.ceil((nextDay - now.getTime()) / 1000)))
          }
          writeCount = prior + 1
        }
      }

      const expiresAt = new Date(now.getTime() + SET_LINK_TTL_MS)
      const nowTs = Timestamp.fromDate(now)
      transaction.set(ref, {
        v: 1,
        name: clean.name,
        songs: clean.songs,
        payloadHash,
        createdAt: existing?.createdAt ?? nowTs,
        updatedAt: nowTs,
        expiresAt: Timestamp.fromDate(expiresAt),
        writeDay: today,
        writeCount,
      })
      return { id, expiresAt, unchanged: false }
    })
  }

  async get(id: string): Promise<SetLinkLookup> {
    const snap = await this.db.collection(COLLECTION).doc(id).get()
    if (!snap.exists) return { kind: 'missing' }
    const data = snap.data()
    const expiresAt = data?.expiresAt instanceof Timestamp ? data.expiresAt.toDate() : null
    if (isExpired(expiresAt, this.now())) return { kind: 'expired' }
    const payload = { v: data?.v, name: data?.name, songs: data?.songs }
    if (!isSetLinkPayload(payload)) return { kind: 'missing' }
    return { kind: 'found', payload: sanitizeSetLinkPayload(payload), expiresAt: expiresAt! }
  }
}

export const setLinkStore = new SetLinkStore()
