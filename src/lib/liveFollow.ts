import { getLiveSetApi, ShareApiError, type GetLiveSetResult } from './api'
import { buildLivePayload, hashLivePayload } from './liveShareSync'
import { sessionStore, type Session, type SessionSongItem } from './sessionStore'
import { sessionSongsFromSnapshot } from './shareSnapshot'
import { songCache } from './songCache'
import type { SharedSetSnapshot, Song } from '../types/song'

export type LiveFollowResult =
  | { kind: 'opened'; session: Session }
  | { kind: 'reused'; session: Session }
  | { kind: 'expired' }
  | { kind: 'missing' }
  | { kind: 'stopped' }

export interface LiveFollowDeps {
  fetchLive: (id: string) => Promise<GetLiveSetResult>
  sessions: Pick<typeof sessionStore, 'findByLiveSourceId' | 'createSession' | 'updateSession'>
  saveSong: (song: Song) => Promise<unknown>
  getSong: (url: string) => Promise<Song | null>
}

const defaultDeps: LiveFollowDeps = {
  fetchLive: getLiveSetApi,
  sessions: sessionStore,
  saveSong: (song) => songCache.saveSong(song),
  getSong: (url) => songCache.getSong(url),
}

/** Turns the host's manifest and content into set songs, caching each song for the session page. */
export async function applyLiveSet(
  response: GetLiveSetResult,
  deps: Pick<LiveFollowDeps, 'saveSong'> = defaultDeps,
): Promise<{ name: string; songs: SessionSongItem[] }> {
  const { manifest, contents } = response
  const present: SharedSetSnapshot['songs'] = []
  for (const entry of manifest.entries) {
    const content = contents[entry.contentHash]
    if (!content) continue
    await deps.saveSong(content.song)
    present.push({
      entryId: entry.entryId,
      song: content.song,
      customSections: content.customSections,
      customFlow: content.customFlow,
      customSimplifiedSections: content.customSimplifiedSections,
      customSimplifiedFlow: content.customSimplifiedFlow,
      targetKey: entry.targetKey,
      padKeyMode: entry.padKeyMode,
      customPadKey: entry.customPadKey,
      simplified: entry.simplified,
    })
  }
  const mapped = sessionSongsFromSnapshot({ v: 2, name: manifest.name, songs: present })
  let next = 0
  const songs = manifest.entries.map((entry): SessionSongItem =>
    contents[entry.contentHash]
      ? mapped[next++]
      : {
          entryId: entry.entryId,
          url: '',
          title: 'Song unavailable',
          status: 'error',
          errorMessage: 'The host’s version of this song could not be loaded.',
        },
  )
  return { name: manifest.name, songs }
}

/** Replaces the set's songs and name with the host's version, keeping its id and public id. */
export async function refreshFromLiveSet(
  session: Session,
  response: GetLiveSetResult,
  deps: LiveFollowDeps = defaultDeps,
): Promise<Session> {
  const { name, songs } = await applyLiveSet(response, deps)
  session.name = name
  session.songs = songs
  session.liveRev = response.manifest.rev
  const { payload } = await buildLivePayload(session, deps.getSong)
  session.lastHostHash = payload ? await hashLivePayload(payload) : undefined
  await deps.sessions.updateSession(session)
  return session
}

export async function openLiveShare(
  liveId: string,
  options: { deps?: LiveFollowDeps } = {},
): Promise<LiveFollowResult> {
  const deps = options.deps ?? defaultDeps
  const existing = await deps.sessions.findByLiveSourceId(liveId)

  if (existing) {
    if (existing.followHost === true) {
      try {
        const response = await deps.fetchLive(liveId)
        if (response.manifest.rev > (existing.liveRev ?? 0)) {
          await refreshFromLiveSet(existing, response, deps)
        }
      } catch {
        // Offline or expired: the local copy still opens.
      }
    }
    return { kind: 'reused', session: existing }
  }

  let response: GetLiveSetResult
  try {
    response = await deps.fetchLive(liveId)
  } catch (err) {
    if (err instanceof ShareApiError && err.code === 'EXPIRED') return { kind: 'expired' }
    if (err instanceof ShareApiError && err.code === 'NOT_FOUND') return { kind: 'missing' }
    throw err
  }
  if (response.manifest.status === 'stopped') return { kind: 'stopped' }

  const { name, songs } = await applyLiveSet(response, deps)
  const session = await deps.sessions.createSession(songs, name, {
    liveSourceId: liveId,
    followHost: true,
    liveRev: response.manifest.rev,
  })
  const { payload } = await buildLivePayload(session, deps.getSong)
  if (payload) {
    session.lastHostHash = await hashLivePayload(payload)
    await deps.sessions.updateSession(session)
  }
  return { kind: 'opened', session }
}

const inFlight = new Map<string, Promise<LiveFollowResult>>()

/** Shares one open per live id, so StrictMode's double effect never imports twice. */
export function openLiveShareOnce(
  liveId: string,
  options: { deps?: LiveFollowDeps } = {},
): Promise<LiveFollowResult> {
  let promise = inFlight.get(liveId)
  if (!promise) {
    promise = openLiveShare(liveId, options).finally(() => inFlight.delete(liveId))
    inFlight.set(liveId, promise)
  }
  return promise
}
