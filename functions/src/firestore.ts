import { createHash } from 'node:crypto'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore'

export function database(): Firestore {
  if (getApps().length === 0) initializeApp()
  return getFirestore()
}

export function documentId(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** Firestore TTL needs a Timestamp; cache entries keep their numeric expiresAt. */
export function ttlAt(expiresAtMs: number): Timestamp {
  return Timestamp.fromMillis(expiresAtMs)
}
