import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import crypto from 'node:crypto'
import { database } from './firestore.js'
import { isExpired, isSharedSetSong } from './shareStore.js'
import {
  derivePublicId,
  verifySetLinkSecret,
  SET_LINK_TTL_MS,
  SET_LINK_REFRESH_BELOW_MS,
  SET_LINK_MIN_WRITE_INTERVAL_MS,
  SET_LINK_DAILY_WRITE_CAP,
  MAX_SET_LINK_SONGS,
} from './setLinkStore.js'
import type { LiveSetEntry, LiveSetManifest, LiveSongContent } from './types.js'

export const MAX_LIVE_SET_SONGS = MAX_SET_LINK_SONGS
export const LIVE_SET_DOMAIN_SEPARATOR = 'live-set-v1:'
export const LIVE_SET_MAX_CONTENT_BYTES = 256 * 1024
export const LIVE_SET_MAX_MANIFEST_BYTES = 64 * 1024
/** Unreferenced content docs younger than this survive the sweep, so a follower mid-fetch isn't cut off. */
const ORPHAN_MIN_AGE_MS = 10 * 60 * 1000
const MANIFESTS = 'liveSets'
const SONGS = 'liveSetSongs'

export type LiveSetManifestInput = Pick<LiveSetManifest, 'v' | 'name' | 'entries'>

export type LiveSetLookup =
  | {
      kind: 'found'
      manifest: LiveSetManifest
      contents: Record<string, LiveSongContent>
      expiresAt: Date
    }
  | { kind: 'expired' }
  | { kind: 'missing' }

export class LiveSetThrottledError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(`Live set updated too often. Try again in ${retryAfterSeconds}s`)
    this.name = 'LiveSetThrottledError'
  }
}

export class LiveSetError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'LiveSetError'
  }
}

export const deriveLiveSetId = (secret: string) => derivePublicId(secret, LIVE_SET_DOMAIN_SEPARATOR)

export const verifyLiveSetSecret = (secret: string, id: string) =>
  verifySetLinkSecret(secret, id, LIVE_SET_DOMAIN_SEPARATOR)

export const isContentHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

function optString(value: unknown, max: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= max)
}

function isLiveSetEntry(value: unknown): value is LiveSetEntry {
  if (!value || typeof value !== 'object') return false
  const e = value as Record<string, unknown>
  return (
    typeof e.entryId === 'string' &&
    e.entryId.trim().length >= 1 &&
    e.entryId.trim().length <= 100 &&
    isContentHash(e.contentHash) &&
    optString(e.targetKey, 10) &&
    optString(e.customPadKey, 10) &&
    (e.simplified === undefined || typeof e.simplified === 'boolean') &&
    (e.padKeyMode === undefined || e.padKeyMode === 'match' || e.padKeyMode === 'custom')
  )
}

export function isLiveSetManifestInput(value: unknown): value is LiveSetManifestInput {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  return (
    m.v === 1 &&
    typeof m.name === 'string' &&
    m.name.trim().length >= 1 &&
    m.name.trim().length <= 200 &&
    Array.isArray(m.entries) &&
    m.entries.length >= 1 &&
    m.entries.length <= MAX_LIVE_SET_SONGS &&
    m.entries.every(isLiveSetEntry)
  )
}

/** Rebuilds the manifest from whitelisted fields only, in a fixed key order. */
export function sanitizeLiveSetManifest(input: LiveSetManifestInput): LiveSetManifestInput {
  return {
    v: 1,
    name: input.name.trim(),
    entries: input.entries.map((e) => {
      const entry: LiveSetEntry = { entryId: e.entryId.trim(), contentHash: e.contentHash }
      if (e.targetKey !== undefined) entry.targetKey = e.targetKey
      if (e.simplified !== undefined) entry.simplified = e.simplified
      if (e.padKeyMode !== undefined) entry.padKeyMode = e.padKeyMode
      if (e.customPadKey !== undefined) entry.customPadKey = e.customPadKey
      return entry
    }),
  }
}

export function isLiveSongContent(value: unknown): value is LiveSongContent {
  // A content doc is a shared-set song without its per-entry fields.
  return (
    !!value &&
    typeof value === 'object' &&
    isSharedSetSong({ ...(value as object), entryId: 'content' })
  )
}

/** Rebuilds the content from whitelisted fields only. */
export function sanitizeLiveSongContent(content: LiveSongContent): LiveSongContent {
  const clean: LiveSongContent = { song: content.song }
  if (content.customSections !== undefined) clean.customSections = content.customSections
  if (content.customFlow !== undefined) clean.customFlow = content.customFlow
  if (content.customSimplifiedSections !== undefined) {
    clean.customSimplifiedSections = content.customSimplifiedSections
  }
  if (content.customSimplifiedFlow !== undefined) {
    clean.customSimplifiedFlow = content.customSimplifiedFlow
  }
  return clean
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const fields = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    return `{${fields.join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * SHA-256 hex of the compact JSON of {song, customSections, customFlow,
 * customSimplifiedSections, customSimplifiedFlow}: object keys sorted at every
 * depth, undefined fields left out, array order kept.
 */
export function hashLiveSongContent(content: LiveSongContent): string {
  return crypto
    .createHash('sha256')
    .update(canonicalJson(sanitizeLiveSongContent(content)))
    .digest('hex')
}

export function hashLiveSetManifest(manifest: LiveSetManifestInput): string {
  // sanitize emits a fixed key order, so JSON.stringify is canonical.
  return crypto.createHash('sha256').update(JSON.stringify(sanitizeLiveSetManifest(manifest))).digest('hex')
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function toDate(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null
}

/** Applies the 5 s spacing (manifest writes only) and the daily cap; returns the new count. */
function nextWriteCount(
  existing: Record<string, unknown> | undefined,
  now: Date,
  checkSpacing: boolean,
): number {
  if (!existing) return 1
  if (checkSpacing) {
    const updatedAt = toDate(existing.updatedAt)
    if (updatedAt) {
      const sinceMs = now.getTime() - updatedAt.getTime()
      if (sinceMs >= 0 && sinceMs < SET_LINK_MIN_WRITE_INTERVAL_MS) {
        throw new LiveSetThrottledError(Math.ceil((SET_LINK_MIN_WRITE_INTERVAL_MS - sinceMs) / 1000))
      }
    }
  }
  if (existing.writeDay !== utcDay(now)) return 1
  const prior = Number(existing.writeCount) || 0
  if (prior >= SET_LINK_DAILY_WRITE_CAP) {
    const nextDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
    throw new LiveSetThrottledError(Math.max(1, Math.ceil((nextDay - now.getTime()) / 1000)))
  }
  return prior + 1
}

export class LiveSetStore {
  private readonly db: Firestore
  private readonly now: () => Date

  constructor(db: Firestore = database(), now: () => Date = () => new Date()) {
    this.db = db
    this.now = now
  }

  /** Creates one content doc, or only extends the expiry if it already exists. */
  async putSong(
    id: string,
    hash: string,
    content: LiveSongContent,
  ): Promise<{ created: boolean; expiresAt: Date }> {
    if (!isLiveSongContent(content)) throw new LiveSetError(400, 'BAD_REQUEST', 'Invalid song content')
    const clean = sanitizeLiveSongContent(content)
    if (Buffer.byteLength(JSON.stringify(clean)) > LIVE_SET_MAX_CONTENT_BYTES) {
      throw new LiveSetError(413, 'PAYLOAD_TOO_LARGE', 'Song content is too large')
    }
    if (hashLiveSongContent(clean) !== hash) {
      throw new LiveSetError(400, 'HASH_MISMATCH', 'Content does not match its hash')
    }
    const manifestRef = this.db.collection(MANIFESTS).doc(id)
    const songRef = this.db.collection(SONGS).doc(`${id}_${hash}`)

    return this.db.runTransaction(async (transaction) => {
      const now = this.now()
      const [manifestSnap, songSnap] = await Promise.all([
        transaction.get(manifestRef),
        transaction.get(songRef),
      ])
      const manifest = manifestSnap.exists ? manifestSnap.data() : undefined
      if (manifest?.status === 'stopped') throw new LiveSetError(410, 'STOPPED', 'This live share was stopped')

      const expiresAt = new Date(now.getTime() + SET_LINK_TTL_MS)
      const expiresTs = Timestamp.fromDate(expiresAt)
      if (songSnap.exists) {
        transaction.update(songRef, { expiresAt: expiresTs })
        return { created: false, expiresAt }
      }

      const nowTs = Timestamp.fromDate(now)
      const writeCount = nextWriteCount(manifest, now, false)
      transaction.set(songRef, { liveId: id, ...clean, expiresAt: expiresTs, createdAt: nowTs })
      if (manifest) {
        transaction.update(manifestRef, { writeDay: utcDay(now), writeCount })
      } else {
        // Placeholder so uploads before the first manifest still count toward the cap.
        transaction.set(manifestRef, {
          v: 1,
          name: '',
          entries: [],
          status: 'live',
          rev: 0,
          payloadHash: '',
          createdAt: nowTs,
          expiresAt: expiresTs,
          writeDay: utcDay(now),
          writeCount,
        })
      }
      return { created: true, expiresAt }
    })
  }

  /**
   * Writes the manifest after checking every referenced content doc exists.
   * Skips the write when nothing changed and the expiry is still fresh.
   */
  async publish(
    id: string,
    input: LiveSetManifestInput,
  ): Promise<{ id: string; expiresAt: Date; rev: number; unchanged: boolean }> {
    if (!isLiveSetManifestInput(input)) throw new Error('Invalid live set manifest')
    const clean = sanitizeLiveSetManifest(input)
    const payloadHash = hashLiveSetManifest(clean)
    const hashes = [...new Set(clean.entries.map((e) => e.contentHash))]
    const ref = this.db.collection(MANIFESTS).doc(id)
    const songRef = (hash: string) => this.db.collection(SONGS).doc(`${id}_${hash}`)

    const result = await this.db.runTransaction(async (transaction) => {
      const now = this.now()
      const snap = await transaction.get(ref)
      const existing = snap.exists ? snap.data() : undefined
      if (existing?.status === 'stopped') throw new LiveSetError(410, 'STOPPED', 'This live share was stopped')
      const existingExpires = toDate(existing?.expiresAt)
      const live = existing !== undefined && !isExpired(existingExpires, now)
      const rev = Number(existing?.rev) || 0

      if (
        live &&
        existing.payloadHash === payloadHash &&
        existingExpires!.getTime() - now.getTime() > SET_LINK_REFRESH_BELOW_MS
      ) {
        return { id, expiresAt: existingExpires!, rev, unchanged: true }
      }

      const songs = await Promise.all(hashes.map((hash) => transaction.get(songRef(hash))))
      const missing = hashes.filter((_, i) => !songs[i].exists)
      if (missing.length > 0) {
        throw new LiveSetError(409, 'MISSING_CONTENT', 'Some song content has not been uploaded', { missing })
      }

      const writeCount = nextWriteCount(existing, now, true)
      const expiresAt = new Date(now.getTime() + SET_LINK_TTL_MS)
      const expiresTs = Timestamp.fromDate(expiresAt)
      const nowTs = Timestamp.fromDate(now)
      // Keep content alive as long as the manifest that references it.
      songs.forEach((songSnap, i) => {
        const songExpires = toDate(songSnap.data()?.expiresAt)
        if (!songExpires || songExpires.getTime() - now.getTime() <= SET_LINK_REFRESH_BELOW_MS) {
          transaction.update(songRef(hashes[i]), { expiresAt: expiresTs })
        }
      })
      transaction.set(ref, {
        ...clean,
        status: 'live',
        rev: rev + 1,
        payloadHash,
        createdAt: existing?.createdAt ?? nowTs,
        updatedAt: nowTs,
        expiresAt: expiresTs,
        writeDay: utcDay(now),
        writeCount,
      })
      return { id, expiresAt, rev: rev + 1, unchanged: false }
    })

    if (!result.unchanged) await this.sweepOrphans(id, new Set(hashes))
    return result
  }

  private async sweepOrphans(id: string, referenced: Set<string>): Promise<void> {
    try {
      const cutoff = this.now().getTime() - ORPHAN_MIN_AGE_MS
      const prefix = `${id}_`
      const snap = await this.db.collection(SONGS).where('liveId', '==', id).get()
      await Promise.all(
        snap.docs
          .filter((doc) => {
            const createdAt = toDate(doc.data().createdAt)
            return (
              !referenced.has(doc.id.slice(prefix.length)) && createdAt && createdAt.getTime() < cutoff
            )
          })
          .map((doc) => doc.ref.delete()),
      )
    } catch {
      // Best effort: the TTL removes leftovers anyway.
    }
  }

  /** Marks the share stopped and clears its entries. Safe to repeat. */
  async stop(id: string): Promise<{ id: string; rev: number }> {
    const ref = this.db.collection(MANIFESTS).doc(id)
    return this.db.runTransaction(async (transaction) => {
      const now = this.now()
      const snap = await transaction.get(ref)
      const existing = snap.exists ? snap.data() : undefined
      const rev = (Number(existing?.rev) || 0) + 1
      const nowTs = Timestamp.fromDate(now)
      transaction.set(ref, {
        v: 1,
        name: existing?.name ?? '',
        entries: [],
        status: 'stopped',
        rev,
        payloadHash: '',
        createdAt: existing?.createdAt ?? nowTs,
        updatedAt: nowTs,
        expiresAt: Timestamp.fromDate(new Date(now.getTime() + SET_LINK_TTL_MS)),
        writeDay: existing?.writeDay ?? utcDay(now),
        writeCount: existing?.writeCount ?? 0,
      })
      return { id, rev }
    })
  }

  async get(id: string): Promise<LiveSetLookup> {
    const snap = await this.db.collection(MANIFESTS).doc(id).get()
    if (!snap.exists) return { kind: 'missing' }
    const data = snap.data()
    const expiresAt = toDate(data?.expiresAt)
    if (isExpired(expiresAt, this.now())) return { kind: 'expired' }
    const rev = Number(data?.rev) || 0
    // rev 0 is the placeholder made by an upload that came before any manifest.
    if (rev === 0) return { kind: 'missing' }

    const stopped = data?.status === 'stopped'
    const entries: LiveSetEntry[] = stopped ? [] : (data?.entries ?? [])
    const manifest: LiveSetManifest = {
      v: 1,
      name: data?.name ?? '',
      entries,
      status: stopped ? 'stopped' : 'live',
      rev,
    }
    const contents: Record<string, LiveSongContent> = {}
    const hashes = [...new Set(entries.map((e) => e.contentHash))]
    const docs = await Promise.all(hashes.map((hash) => this.db.collection(SONGS).doc(`${id}_${hash}`).get()))
    docs.forEach((doc, i) => {
      if (!doc.exists) return
      const { song, customSections, customFlow, customSimplifiedSections, customSimplifiedFlow } =
        doc.data() as LiveSongContent
      contents[hashes[i]] = sanitizeLiveSongContent({
        song,
        customSections,
        customFlow,
        customSimplifiedSections,
        customSimplifiedFlow,
      })
    })
    return { kind: 'found', manifest, contents, expiresAt: expiresAt! }
  }
}

export const liveSetStore = new LiveSetStore()
