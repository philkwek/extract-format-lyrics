import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore'
import type { SharedSetSnapshot, SharedSetSong } from './types.js'

export const MAX_SHARED_SET_SONGS = 15
export const SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const COLLECTION = 'sharedSets'

export type SharedSetLookup =
  | { kind: 'found'; snapshot: SharedSetSnapshot; expiresAt: Date }
  | { kind: 'expired' }
  | { kind: 'missing' }

function database(): Firestore {
  if (getApps().length === 0) initializeApp()
  return getFirestore()
}

export function isSharedSetSnapshot(value: unknown): value is SharedSetSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<SharedSetSnapshot>
  return snapshot.v === 2 && typeof snapshot.name === 'string' && snapshot.name.trim().length > 0 &&
    Array.isArray(snapshot.songs) && snapshot.songs.length > 0 && snapshot.songs.length <= MAX_SHARED_SET_SONGS &&
    snapshot.songs.every((entry) =>
      entry && typeof entry.entryId === 'string' && entry.entryId.length > 0 &&
      entry.song && typeof entry.song === 'object' && typeof entry.song.id === 'string' &&
      typeof entry.song.sourceUrl === 'string' && Array.isArray(entry.song.sections)
    )
}

export function isExpired(expiresAt: Date | null, now: Date): boolean {
  return !expiresAt || expiresAt.getTime() <= now.getTime()
}

export class ShareStore {
  constructor(private readonly db: Firestore = database(), private readonly now: () => Date = () => new Date()) {}

  async create(snapshot: SharedSetSnapshot): Promise<{ id: string; expiresAt: Date }> {
    const createdAt = this.now()
    const expiresAt = new Date(createdAt.getTime() + SHARE_TTL_MS)
    const ref = this.db.collection(COLLECTION).doc()
    const batch = this.db.batch()
    batch.set(ref, {
      v: snapshot.v,
      name: snapshot.name,
      songCount: snapshot.songs.length,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAt),
    })
    snapshot.songs.forEach((entry, index) => {
      batch.set(ref.collection('songs').doc(String(index).padStart(2, '0')), { index, entry })
    })
    await batch.commit()
    return { id: ref.id, expiresAt }
  }

  async get(id: string): Promise<SharedSetLookup> {
    const ref = this.db.collection(COLLECTION).doc(id)
    const root = await ref.get()
    if (!root.exists) return { kind: 'missing' }
    const data = root.data()
    const expiresAt = data?.expiresAt instanceof Timestamp ? data.expiresAt.toDate() : null
    if (isExpired(expiresAt, this.now())) return { kind: 'expired' }
    if (data?.v !== 2 || typeof data.name !== 'string' || !Number.isInteger(data.songCount)) return { kind: 'missing' }
    const songDocs = await ref.collection('songs').orderBy('index').get()
    const songs = songDocs.docs.map((doc) => doc.data().entry as SharedSetSong)
    const snapshot: SharedSetSnapshot = { v: 2, name: data.name, songs }
    return isSharedSetSnapshot(snapshot) && songs.length === data.songCount
      ? { kind: 'found', snapshot, expiresAt: expiresAt! }
      : { kind: 'missing' }
  }
}

export const shareStore = new ShareStore()
