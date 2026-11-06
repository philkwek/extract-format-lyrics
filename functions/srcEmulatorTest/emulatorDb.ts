import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

export const EMULATOR_PROJECT = 'demo-chords'
process.env.GCLOUD_PROJECT ??= EMULATOR_PROJECT

/** Admin Firestore wired to the emulator that `emulators:exec` started. */
export function emulatorDb(): Firestore {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Run these tests with `npm run test:emulator` so the emulator is running.')
  }
  if (getApps().length === 0) initializeApp({ projectId: EMULATOR_PROJECT })
  return getFirestore()
}

export async function clearEmulatorData(): Promise<void> {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${EMULATOR_PROJECT}/databases/(default)/documents`
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Could not clear the emulator: ${res.status}`)
}
