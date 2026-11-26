import { firebaseConfig, loadFirestore } from './firestoreClient'

export interface LyricsLiveSummary {
  rev: string | null
  currentEntryId: string | null
}

export interface LyricsLiveHandlers {
  /** Called on every root-document snapshot. Fetch the payload when rev changes. */
  onUpdate: (summary: LyricsLiveSummary) => void
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
  let unsubscribe: (() => void) | undefined

  void (async () => {
    try {
      const { db, doc, onSnapshot } = await loadFirestore()
      if (stopped) return
      const off = onSnapshot(
        doc(db as never, 'sharedLyrics', publicationId),
        (snap) => {
          if (stopped) return
          const data = snap.exists() ? snap.data() : undefined
          handlers.onUpdate({
            rev: typeof data?.rev === 'string' ? data.rev : null,
            currentEntryId:
              typeof data?.currentEntryId === 'string' ? data.currentEntryId : null,
          })
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
