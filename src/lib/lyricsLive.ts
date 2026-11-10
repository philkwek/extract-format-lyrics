import { firebaseConfig, loadFirestore } from './firestoreClient'

export interface LyricsLiveHandlers {
  /** Called when the publication summary changes. Fetch the payload from the API. */
  onUpdate: () => void
  onError?: (error: unknown) => void
}

/**
 * Listens to a lyrics publication's root document. The root carries the revision and expiry;
 * the full lyrics stay in the songs subcollection and are fetched through the existing API.
 */
export function subscribeSharedLyrics(
  publicationId: string,
  handlers: LyricsLiveHandlers,
): () => void {
  if (!firebaseConfig()) return () => {}

  let stopped = false
  let first = true
  let unsubscribe: (() => void) | undefined

  void (async () => {
    try {
      const { db, doc, onSnapshot } = await loadFirestore()
      if (stopped) return
      const off = onSnapshot(
        doc(db as never, 'sharedLyrics', publicationId),
        (snap) => {
          if (stopped) return
          if (first) {
            first = false
            return
          }
          if (snap.exists()) handlers.onUpdate()
        },
        (error) => {
          if (!stopped) handlers.onError?.(error)
        },
      )
      if (stopped) off()
      else unsubscribe = off
    } catch (error) {
      if (!stopped) handlers.onError?.(error)
    }
  })()

  return () => {
    stopped = true
    unsubscribe?.()
    unsubscribe = undefined
  }
}
