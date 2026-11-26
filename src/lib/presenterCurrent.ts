import { putLyricsCurrentApi } from './api'
import { getLyricsPublicationIdentity } from './lyricsPublishIdentity'

export const CURRENT_SONG_DEBOUNCE_MS = 400
const RETRY_MS = 5000

export interface CurrentSongIdentity {
  publicationId: string
  secret: string
  expiresAt?: string
}

export interface CurrentSongSenderDeps {
  getIdentity: (sessionId: string) => Promise<CurrentSongIdentity | null>
  api: typeof putLyricsCurrentApi
  now: () => number
}

export interface CurrentSongSender {
  notify(sessionId: string, entryId: string): void
  resend(sessionId: string): void
}

interface SessionState {
  /** Latest entry requested in this tab. */
  entryId: string
  timer?: ReturnType<typeof setTimeout>
  retryTimer?: ReturnType<typeof setTimeout>
  /** The entry the server last accepted, so repeats are skipped. */
  sentEntryId?: string
  queue: Promise<void>
}

export function createCurrentSongSender(deps: CurrentSongSenderDeps): CurrentSongSender {
  const sessions = new Map<string, SessionState>()

  function isExpired(identity: CurrentSongIdentity): boolean {
    if (!identity.expiresAt) return false
    const expiry = Date.parse(identity.expiresAt)
    return Number.isFinite(expiry) && expiry <= deps.now()
  }

  async function deliver(sessionId: string, entryId: string, force: boolean, retry: boolean) {
    const state = sessions.get(sessionId)
    if (!state) return

    let identity: CurrentSongIdentity | null
    try {
      identity = await deps.getIdentity(sessionId)
    } catch {
      return
    }
    if (!identity || isExpired(identity)) return
    if (!force && state.sentEntryId === entryId) return

    try {
      await deps.api(identity.publicationId, identity.secret, entryId)
      if (state.entryId === entryId) state.sentEntryId = entryId
    } catch {
      if (!retry || state.entryId !== entryId) return
      clearTimeout(state.retryTimer)
      state.retryTimer = setTimeout(() => {
        state.retryTimer = undefined
        if (state.entryId === entryId) enqueue(sessionId, entryId, true, false)
      }, RETRY_MS)
    }
  }

  function enqueue(sessionId: string, entryId: string, force: boolean, retry: boolean) {
    const state = sessions.get(sessionId)
    if (!state) return
    // Serialise sends so an older request can never land after a newer one.
    state.queue = state.queue.then(() => deliver(sessionId, entryId, force, retry))
  }

  function request(sessionId: string, entryId: string, force: boolean) {
    if (!entryId) return
    const existing = sessions.get(sessionId)
    const state = existing ?? { entryId, queue: Promise.resolve() }
    if (!existing) sessions.set(sessionId, state)
    state.entryId = entryId
    clearTimeout(state.retryTimer)
    state.retryTimer = undefined
    clearTimeout(state.timer)
    state.timer = setTimeout(() => {
      state.timer = undefined
      enqueue(sessionId, state.entryId, force, true)
    }, CURRENT_SONG_DEBOUNCE_MS)
  }

  return {
    notify(sessionId: string, entryId: string) {
      request(sessionId, entryId, false)
    },
    resend(sessionId: string) {
      const state = sessions.get(sessionId)
      if (state) request(sessionId, state.entryId, true)
    },
  }
}

export const currentSongSender = createCurrentSongSender({
  getIdentity: async (sessionId) => {
    const record = await getLyricsPublicationIdentity(sessionId)
    if (!record) return null
    return {
      publicationId: record.publicationId,
      secret: record.updateSecret,
      expiresAt: record.expiresAt,
    }
  },
  api: putLyricsCurrentApi,
  now: () => Date.now(),
})
