import { useEffect, useState } from 'react'
import { getSharedLyricsApi, ShareApiError, type GetSharedLyricsResult } from './api'
import { firebaseConfig } from './firestoreClient'
import { subscribeSharedLyrics, type LyricsLiveSummary } from './lyricsLive'
import type { SharedLyricsPayload } from '../types/song'

export type PresenterFeedStatus = 'loading' | 'live' | 'lost' | 'stopped' | 'missing'

export interface PresenterFeedState {
  status: PresenterFeedStatus
  lyrics: SharedLyricsPayload | null
  currentEntryId: string | null
}

export interface PresenterFeedDeps {
  getLyrics: (id: string) => Promise<GetSharedLyricsResult>
  subscribe: (
    id: string,
    handlers: {
      onUpdate: (summary: LyricsLiveSummary) => void
      onError: (error: unknown) => void
    },
  ) => () => void
  hasFirestore: () => boolean
  setInterval: (handler: () => void, ms: number) => TimerHandle
  clearInterval: (handle: TimerHandle) => void
  setTimeout: (handler: () => void, ms: number) => TimerHandle
  clearTimeout: (handle: TimerHandle) => void
  addWindowListener: (type: 'online' | 'offline', handler: () => void) => () => void
}

type FetchSource = 'initial' | 'retry' | 'rev' | 'online' | 'poll'

type TimerHandle = ReturnType<typeof setTimeout> | number

/** A network error on the very first load retries ten seconds later. */
const FIRST_LOAD_RETRY_MS = 10_000
/** A listener that is down (or absent) falls back to polling the API. */
const POLL_MS = 30_000

const INITIAL_STATE: PresenterFeedState = {
  status: 'loading',
  lyrics: null,
  currentEntryId: null,
}

function isGone(error: unknown): boolean {
  return error instanceof ShareApiError && (error.status === 404 || error.status === 410)
}

/**
 * Follows one lyrics publication. The listener carries the revision and the
 * host's current song; the API carries the lyrics themselves. Everything is
 * injectable so the state machine is testable without Firestore or timers.
 */
export function createPresenterFeed(
  id: string,
  deps: PresenterFeedDeps,
  onChange: (state: PresenterFeedState) => void,
): () => void {
  let state = INITIAL_STATE
  let stopped = false
  let generation = 0
  let fetchSeq = 0
  let loaded = false
  let initialSettled = false
  let knownRev: string | null | undefined
  let retryTimer: TimerHandle | undefined
  let pollTimer: TimerHandle | undefined
  let unsubscribe: (() => void) | undefined

  const emit = (patch: Partial<PresenterFeedState>) => {
    state = { ...state, ...patch }
    onChange(state)
  }

  const clearRetry = () => {
    if (retryTimer === undefined) return
    deps.clearTimeout(retryTimer)
    retryTimer = undefined
  }

  const scheduleRetry = () => {
    if (stopped || retryTimer !== undefined) return
    retryTimer = deps.setTimeout(() => {
      retryTimer = undefined
      void load('retry')
    }, FIRST_LOAD_RETRY_MS)
  }

  async function load(source: FetchSource): Promise<void> {
    if (stopped) return
    const startedAt = generation
    const seq = ++fetchSeq
    try {
      const result = await deps.getLyrics(id)
      if (stopped || startedAt !== generation || seq !== fetchSeq) return
      if (source === 'initial') initialSettled = true
      clearRetry()
      loaded = true
      emit({
        status: 'live',
        lyrics: result.lyrics,
        currentEntryId: result.currentEntryId ?? null,
      })
    } catch (error) {
      if (stopped || startedAt !== generation || seq !== fetchSeq) return
      if (source === 'initial') initialSettled = true
      if (isGone(error)) {
        const hadLyrics = loaded
        const recover = source === 'initial' && typeof knownRev === 'string'
        loaded = false
        knownRev = undefined
        clearRetry()
        emit({
          status: source === 'poll' || hadLyrics ? 'stopped' : 'missing',
          lyrics: null,
        })
        if (recover) void load('rev')
        return
      }
      emit({ status: 'lost' })
      if (source === 'initial' || source === 'retry') scheduleRetry()
    }
  }

  const startPolling = () => {
    if (stopped || pollTimer !== undefined) return
    pollTimer = deps.setInterval(() => {
      void load('poll')
    }, POLL_MS)
  }

  const handleSnapshot = (summary: LyricsLiveSummary) => {
    if (stopped) return
    if (summary.rev === null) {
      loaded = false
      knownRev = null
      fetchSeq += 1
      emit({ status: 'stopped', lyrics: null, currentEntryId: summary.currentEntryId })
      return
    }
    emit({ currentEntryId: summary.currentEntryId })
    if (knownRev === undefined) {
      knownRev = summary.rev
      if (!loaded && initialSettled) void load('rev')
      return
    }
    if (summary.rev !== knownRev) {
      knownRev = summary.rev
      void load('rev')
    }
  }

  onChange(state)

  unsubscribe = deps.subscribe(id, {
    onUpdate: handleSnapshot,
    onError: () => {
      if (stopped) return
      // Firestore may be blocked while the API still works, so poll before calling it lost.
      startPolling()
      void load('poll')
    },
  })

  if (!deps.hasFirestore()) startPolling()

  const offOffline = deps.addWindowListener('offline', () => {
    if (!stopped) emit({ status: 'lost' })
  })
  const offOnline = deps.addWindowListener('online', () => {
    if (!stopped) void load('online')
  })

  void load('initial')

  return () => {
    if (stopped) return
    stopped = true
    generation += 1
    fetchSeq += 1
    unsubscribe?.()
    unsubscribe = undefined
    clearRetry()
    if (pollTimer !== undefined) {
      deps.clearInterval(pollTimer)
      pollTimer = undefined
    }
    offOffline()
    offOnline()
  }
}

const defaultDeps: PresenterFeedDeps = {
  getLyrics: getSharedLyricsApi,
  subscribe: subscribeSharedLyrics,
  hasFirestore: () => firebaseConfig() !== null,
  setInterval: (handler, ms) => window.setInterval(handler, ms),
  clearInterval: (handle) => window.clearInterval(handle as number),
  setTimeout: (handler, ms) => window.setTimeout(handler, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
  addWindowListener: (type, handler) => {
    window.addEventListener(type, handler)
    return () => window.removeEventListener(type, handler)
  },
}

export function usePresenterFeed(id: string): PresenterFeedState {
  const [snapshot, setSnapshot] = useState<{ id: string; state: PresenterFeedState }>({
    id,
    state: INITIAL_STATE,
  })

  useEffect(() => {
    return createPresenterFeed(id, defaultDeps, (state) => setSnapshot({ id, state }))
  }, [id])

  return snapshot.id === id ? snapshot.state : INITIAL_STATE
}
