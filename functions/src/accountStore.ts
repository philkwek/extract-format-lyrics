import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { database } from './firestore.js'

export const PURGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
export const ORPHAN_SONG_MIN_AGE_MS = 24 * 60 * 60 * 1000
export const PURGE_BATCH_SIZE = 400

const USERS = 'users'
const SETS = 'sets'
const SONGS = 'songs'
const PURGE_STATE_DOC = 'system/accountPurge'

interface ParsedSet {
  songs?: Array<{ contentHash?: unknown }>
}

function isUserSetPath(path: string): boolean {
  const parts = path.split('/')
  return parts.length === 4 && parts[0] === USERS && parts[2] === SETS
}

function userIdFromSetPath(path: string): string {
  return path.split('/')[1]
}

function timestampMs(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null
}

export class AccountStore {
  private readonly db: Firestore
  private readonly now: () => Date

  constructor(db: Firestore = database(), now: () => Date = () => new Date()) {
    this.db = db
    this.now = now
  }

  /** Removes the meta doc and every set and song under the user. */
  async deleteAccountData(uid: string): Promise<void> {
    await this.db.recursiveDelete(this.db.doc(`${USERS}/${uid}`))
  }

  /**
   * Deletes tombstones older than 30 days, then sweeps orphan songs for every
   * user whose sets changed since the last run.
   */
  async purgeDeletedSets(): Promise<{ setsDeleted: number; songsDeleted: number }> {
    const runStart = this.now()
    const cutoff = Timestamp.fromMillis(runStart.getTime() - PURGE_RETENTION_MS)
    const stateRef = this.db.doc(PURGE_STATE_DOC)
    const stateSnap = await stateRef.get()
    const lastRunAt = timestampMs(stateSnap.data()?.lastRunAt)

    const expired = await this.db
      .collectionGroup(SETS)
      .where('deletedAt', '<', cutoff)
      .select()
      .get()
    const expiredDocs = expired.docs.filter((doc) => isUserSetPath(doc.ref.path))

    let setsDeleted = 0
    for (let index = 0; index < expiredDocs.length; index += PURGE_BATCH_SIZE) {
      const batch = this.db.batch()
      for (const doc of expiredDocs.slice(index, index + PURGE_BATCH_SIZE)) {
        batch.delete(doc.ref)
      }
      await batch.commit()
      setsDeleted += Math.min(PURGE_BATCH_SIZE, expiredDocs.length - index)
    }

    const touched = new Set(expiredDocs.map((doc) => userIdFromSetPath(doc.ref.path)))
    if (lastRunAt !== null) {
      const changed = await this.db
        .collectionGroup(SETS)
        .where('serverUpdatedAt', '>', Timestamp.fromMillis(lastRunAt - ORPHAN_SONG_MIN_AGE_MS))
        .select()
        .get()
      for (const doc of changed.docs) {
        if (isUserSetPath(doc.ref.path)) touched.add(userIdFromSetPath(doc.ref.path))
      }
    }

    let songsDeleted = 0
    for (const uid of touched) {
      songsDeleted += await this.collectOrphanSongs(uid)
    }

    await stateRef.set({ lastRunAt: Timestamp.fromDate(runStart) })
    return { setsDeleted, songsDeleted }
  }

  /**
   * Deletes song docs no set references (tombstones included) that are older
   * than a day. An unreadable set stops the cleanup for that user.
   */
  async collectOrphanSongs(uid: string): Promise<number> {
    const sets = await this.db.collection(`${USERS}/${uid}/${SETS}`).select('data').get()
    const referenced = new Set<string>()

    for (const doc of sets.docs) {
      const data = doc.data().data
      let parsed: ParsedSet | null
      try {
        parsed = typeof data === 'string' ? (JSON.parse(data) as ParsedSet) : null
      } catch {
        parsed = null
      }
      if (!parsed || !Array.isArray(parsed.songs)) {
        console.warn(`[account-purge] Could not read ${doc.ref.path}; skipping songs for ${uid}`)
        return 0
      }
      for (const entry of parsed.songs) {
        if (typeof entry?.contentHash === 'string') referenced.add(entry.contentHash)
      }
    }

    const cutoff = this.now().getTime() - ORPHAN_SONG_MIN_AGE_MS
    const songs = await this.db.collection(`${USERS}/${uid}/${SONGS}`).select('createdAt').get()
    const orphans = songs.docs.filter((doc) => {
      if (referenced.has(doc.id)) return false
      const createdAt = timestampMs(doc.data().createdAt)
      return createdAt !== null && createdAt < cutoff
    })

    for (let index = 0; index < orphans.length; index += PURGE_BATCH_SIZE) {
      const batch = this.db.batch()
      for (const doc of orphans.slice(index, index + PURGE_BATCH_SIZE)) {
        batch.delete(doc.ref)
      }
      await batch.commit()
    }
    return orphans.length
  }
}

export const accountStore = new AccountStore()
