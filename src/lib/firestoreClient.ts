export function firebaseConfig() {
  const { VITE_FIREBASE_API_KEY: apiKey, VITE_FIREBASE_APP_ID: appId } = import.meta.env
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
  return apiKey && appId && projectId ? { apiKey, appId, projectId } : null
}

/** Splits a local `host:port` emulator address; anything else means "use the real project". */
export function parseEmulatorHost(
  value: string | undefined,
): { host: string; port: number } | null {
  const match = /^([\w.-]+):(\d{1,5})$/.exec(value ?? '')
  return match ? { host: match[1], port: Number(match[2]) } : null
}

let firestore: Promise<typeof import('firebase/firestore') & { db: unknown }> | undefined

export function loadFirestore() {
  firestore ??= (async () => {
    const [{ getApps, initializeApp }, fs] = await Promise.all([
      import('firebase/app'),
      import('firebase/firestore'),
    ])
    const app = getApps()[0] ?? initializeApp(firebaseConfig()!)
    const db = fs.getFirestore(app)
    const emulator = import.meta.env.DEV
      ? parseEmulatorHost(import.meta.env.VITE_FIRESTORE_EMULATOR_HOST)
      : null
    if (emulator) fs.connectFirestoreEmulator(db, emulator.host, emulator.port)
    return { ...fs, db }
  })().catch((err) => {
    firestore = undefined
    throw err
  })
  return firestore
}
