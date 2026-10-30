import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import crypto from 'node:crypto'
import { database } from './firestore.js'
import { isExpired } from './shareStore.js'
import type { SharedLyricsPayload, SharedLyricsSong, SharedLyricsSection } from './types.js'

export const MAX_SHARED_LYRICS_SONGS = 15
export const SHARE_LYRICS_TTL_MS = 7 * 24 * 60 * 60 * 1000
const COLLECTION = 'sharedLyrics'
export const LYRICS_DOMAIN_SEPARATOR = 'lyrics-share-v1:'

export type SharedLyricsLookup =
  | { kind: 'found'; lyrics: SharedLyricsPayload; expiresAt: Date }
  | { kind: 'expired' }
  | { kind: 'missing' }

/**
 * Derives the publication ID from an update secret using domain-separated SHA-256.
 */
export function derivePublicationId(secret: string): string {
  return crypto
    .createHash('sha256')
    .update(`${LYRICS_DOMAIN_SEPARATOR}${secret}`)
    .digest('hex')
}

/**
 * Validates that an update secret corresponds to the target publication ID using constant-time comparison.
 */
export function verifyPublicationSecret(secret: string, publicationId: string): boolean {
  if (!secret || !publicationId) return false
  const derived = derivePublicationId(secret)
  try {
    const a = Buffer.from(derived, 'hex')
    const b = Buffer.from(publicationId, 'hex')
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export function isSharedLyricsPayload(value: unknown): value is SharedLyricsPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<SharedLyricsPayload>
  return (
    payload.v === 1 &&
    typeof payload.name === 'string' &&
    payload.name.trim().length > 0 &&
    Array.isArray(payload.songs) &&
    payload.songs.length > 0 &&
    payload.songs.length <= MAX_SHARED_LYRICS_SONGS &&
    payload.songs.every((entry) => isSharedLyricsSong(entry))
  )
}

function isSharedLyricsSong(value: unknown): value is SharedLyricsSong {
  if (!value || typeof value !== 'object') return false
  const song = value as Partial<SharedLyricsSong>
  return (
    typeof song.entryId === 'string' &&
    song.entryId.trim().length > 0 &&
    typeof song.title === 'string' &&
    Array.isArray(song.sections) &&
    song.sections.every(
      (sec) =>
        sec &&
        typeof sec === 'object' &&
        typeof sec.label === 'string' &&
        Array.isArray(sec.lines) &&
        sec.lines.every((line) => typeof line === 'string')
    )
  )
}

export class SharedLyricsStore {
  private readonly db: Firestore
  private readonly now: () => Date

  constructor(
    db: Firestore = database(),
    now: () => Date = () => new Date()
  ) {
    this.db = db
    this.now = now
  }


  private generateRev(): string {
    return crypto.randomBytes(16).toString('hex')
  }

  /**
   * Atomically creates or replaces lyrics publication, resetting expiry to 7 days from now.
   * Cleans up obsolete song documents if the set shrunk.
   */
  async publish(id: string, payload: SharedLyricsPayload): Promise<{ id: string; expiresAt: Date }> {
    if (!isSharedLyricsPayload(payload)) {
      throw new Error('Invalid shared lyrics payload')
    }

    const ref = this.db.collection(COLLECTION).doc(id)
    const now = this.now()
    const expiresAt = new Date(now.getTime() + SHARE_LYRICS_TTL_MS)
    const rev = this.generateRev()

    await this.db.runTransaction(async (transaction) => {
      const rootSnap = await transaction.get(ref)
      const prevCount = rootSnap.exists ? (rootSnap.data()?.songCount ?? 0) : 0
      const createdAt = rootSnap.exists && rootSnap.data()?.createdAt
        ? rootSnap.data()?.createdAt
        : FieldValue.serverTimestamp()

      // Whitelist only approved fields for the root document
      transaction.set(ref, {
        v: 1,
        name: payload.name.trim(),
        songCount: payload.songs.length,
        createdAt,
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromDate(expiresAt),
        rev,
      })

      // Write each song document with whitelisted display-ready fields
      payload.songs.forEach((song, index) => {
        const songRef = ref.collection('songs').doc(String(index).padStart(2, '0'))
        const whitelistedSections: SharedLyricsSection[] = song.sections.map((sec) => ({
          label: sec.label.trim(),
          lines: sec.lines.map((line) => String(line)),
        }))

        transaction.set(songRef, {
          index,
          entryId: song.entryId.trim(),
          title: song.title.trim(),
          sections: whitelistedSections,
          rev,
          expiresAt: Timestamp.fromDate(expiresAt),
        })
      })

      // Delete obsolete song documents if the set shrunk
      const cleanupTarget = Math.max(prevCount, MAX_SHARED_LYRICS_SONGS)
      for (let i = payload.songs.length; i < cleanupTarget; i++) {
        const obsoleteRef = ref.collection('songs').doc(String(i).padStart(2, '0'))
        transaction.delete(obsoleteRef)
      }
    })

    return { id, expiresAt }
  }

  /**
   * Consistent read of a lyrics publication. Verifies expiry, songCount, and revision match.
   */
  async get(id: string): Promise<SharedLyricsLookup> {
    const ref = this.db.collection(COLLECTION).doc(id)

    // Attempt consistent read (with retry if a concurrent write was detected)
    for (let attempt = 0; attempt < 3; attempt++) {
      const root = await ref.get()
      if (!root.exists) return { kind: 'missing' }

      const data = root.data()
      const expiresAt = data?.expiresAt instanceof Timestamp ? data.expiresAt.toDate() : null
      if (isExpired(expiresAt, this.now())) return { kind: 'expired' }

      if (
        data?.v !== 1 ||
        typeof data.name !== 'string' ||
        !Number.isInteger(data.songCount) ||
        data.songCount < 1
      ) {
        return { kind: 'missing' }
      }

      const songDocs = await ref.collection('songs').orderBy('index').get()

      // Consistency check: ensure all returned songs match the root document's songCount and revision
      const rootRev = data.rev
      const songsMatch =
        songDocs.docs.length === data.songCount &&
        (!rootRev || songDocs.docs.every((d) => d.data().rev === rootRev))

      if (!songsMatch) {
        // Concurrent update in progress; retry read
        continue
      }

      const songs: SharedLyricsSong[] = songDocs.docs.map((doc) => {
        const songData = doc.data()
        return {
          entryId: String(songData.entryId || ''),
          title: String(songData.title || ''),
          sections: Array.isArray(songData.sections)
            ? (songData.sections as Record<string, unknown>[]).map((s) => ({
                label: String(s.label || ''),
                lines: Array.isArray(s.lines) ? (s.lines as unknown[]).map((l) => String(l)) : [],
              }))
            : [],
        }
      })


      const lyrics: SharedLyricsPayload = {
        v: 1,
        name: data.name,
        songs,
      }

      if (!isSharedLyricsPayload(lyrics)) {
        return { kind: 'missing' }
      }

      return {
        kind: 'found',
        lyrics,
        expiresAt: expiresAt!,
      }
    }

    return { kind: 'missing' }
  }
}

export const sharedLyricsStore = new SharedLyricsStore()
