import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Song } from '../../src/types/song'
import type { Session, SessionSongItem } from '../../src/lib/sessionStore'
import {
  buildLyricsSyncPayload,
  createLyricsIdentityAccess,
  createLyricsSync,
  type LyricsSyncDeps,
} from '../../src/lib/lyricsSync'
import { MAX_SHARED_LYRICS_SONGS } from '../../src/lib/exportLyrics'
import {
  hashSharedLyricsPayload,
  resetLyricsStorageStore,
  setLyricsStorageStoreForTesting,
  type LyricsPublicationRecord,
} from '../../src/lib/lyricsPublishIdentity'

type Listener = Parameters<LyricsSyncDeps['store']['subscribe']>[0]

const PUBLIC_ID = 'p'.repeat(64)
const SECRET = 'secret-1'

const makeSong = (name: string): Song => ({
  id: `song-${name}`,
  title: `Song ${name}`,
  artist: 'Demo Artist',
  sourceUrl: `https://x.test/${name}`,
  sourceSite: 'test',
  originalKey: 'C',
  sections: [
    {
      type: 'Verse',
      label: 'Verse 1',
      lines: [
        {
          kind: 'lyric',
          text: `Lyrics for ${name}`,
          chords: [{ chord: 'C', pos: 0 }],
        },
      ],
    },
  ],
})

const getSong = async (url: string): Promise<Song | null> =>
  makeSong(url.split('/').pop() || 'unknown')

const item = (name: string, over: Partial<SessionSongItem> = {}): SessionSongItem => ({
  entryId: `e-${name}`,
  url: `https://x.test/${name}`,
  ...over,
})

const makeSession = (
  songs: SessionSongItem[] = [item('a')],
  over: Partial<Session> = {},
): Session => ({
  id: 's1',
  createdAt: 0,
  name: 'Set',
  songs,
  ...over,
})

function setup(opts: { visibility?: LyricsSyncDeps['visibility'] } = {}) {
  const memory = new Map<string, unknown>()
  setLyricsStorageStoreForTesting({
    get: async <T>(key: string) => memory.get(key) as T | undefined,
    set: async (key, val) => void memory.set(key, val),
    del: async (key) => void memory.delete(key),
  })

  const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString()
  memory.set('s1', {
    sessionId: 's1',
    publicationId: PUBLIC_ID,
    updateSecret: SECRET,
    expiresAt,
  } satisfies LyricsPublicationRecord)

  const listeners = new Set<Listener>()
  const api = vi.fn<LyricsSyncDeps['api']>()
  api.mockResolvedValue({ expiresAt })
  const deps: LyricsSyncDeps = {
    store: {
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    identity: createLyricsIdentityAccess(),
    api,
    getSong,
    now: () => Date.now(),
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    withLock: async (_name, fn) => fn(),
    visibility: opts.visibility,
  }
  const sync = createLyricsSync(deps)
  const stop = sync.start()
  const emit = (event: Parameters<Listener>[0]) => listeners.forEach((listener) => listener(event))

  return { sync, api, memory, emit, stop, expiresAt }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})

afterEach(() => {
  resetLyricsStorageStore()
  vi.useRealTimers()
})

describe('buildLyricsSyncPayload', () => {
  it('builds lyric-only payloads from cached songs', async () => {
    const { payload } = await buildLyricsSyncPayload(makeSession([item('a'), item('b')]), getSong)

    expect(payload?.songs.map((song) => song.title)).toEqual(['Song a', 'Song b'])
    expect(payload?.songs[0].sections[0].lines).toEqual(['Lyrics for a'])
  })

  it('skips empty and oversized sets', async () => {
    expect((await buildLyricsSyncPayload(makeSession([]), getSong)).reason).toBe('empty')

    const many = Array.from({ length: MAX_SHARED_LYRICS_SONGS + 1 }, (_, i) => item(`s${i}`))
    expect((await buildLyricsSyncPayload(makeSession(many), getSong)).reason).toBe('too_many')
  })

  it('rejects when a song is missing from the cache', async () => {
    await expect(
      buildLyricsSyncPayload(makeSession([item('a')]), async () => null),
    ).rejects.toThrow('Song not found in cache: https://x.test/a')
  })
})

describe('lyricsSync', () => {
  it('publishes an added song to the same publication', async () => {
    const env = setup()
    env.emit({
      type: 'updated',
      sessionId: 's1',
      session: makeSession([item('a'), item('b')]),
    })
    await vi.advanceTimersByTimeAsync(2_000)
    await env.sync.idle()

    expect(env.api).toHaveBeenCalledTimes(1)
    const [id, secret, payload] = env.api.mock.calls[0]
    expect(id).toBe(PUBLIC_ID)
    expect(secret).toBe(SECRET)
    expect(payload.songs).toHaveLength(2)

    const stored = env.memory.get('s1') as LyricsPublicationRecord
    expect(stored.lastPublishedHash).toBe(await hashSharedLyricsPayload(payload))
    expect(stored.expiresAt).toBe(env.expiresAt)
  })

  it('does not publish without an existing publication', async () => {
    const env = setup()
    env.memory.delete('s1')
    env.emit({
      type: 'updated',
      sessionId: 's1',
      session: makeSession([item('a'), item('b')]),
    })
    await vi.advanceTimersByTimeAsync(2_000)
    await env.sync.idle()

    expect(env.api).not.toHaveBeenCalled()
  })

  it('does not publish an identity that was never successfully published', async () => {
    const env = setup()
    env.memory.set('s1', {
      sessionId: 's1',
      publicationId: PUBLIC_ID,
      updateSecret: SECRET,
    } satisfies LyricsPublicationRecord)
    env.emit({
      type: 'updated',
      sessionId: 's1',
      session: makeSession([item('a'), item('b')]),
    })
    await vi.advanceTimersByTimeAsync(2_000)
    await env.sync.idle()

    expect(env.api).not.toHaveBeenCalled()
  })

  it('does not write for edits that do not change the lyrics', async () => {
    const env = setup()
    const base = makeSession()
    const { payload } = await buildLyricsSyncPayload(base, getSong)
    env.memory.set('s1', {
      sessionId: 's1',
      publicationId: PUBLIC_ID,
      updateSecret: SECRET,
      expiresAt: env.expiresAt,
      lastPublishedHash: await hashSharedLyricsPayload(payload!),
    } satisfies LyricsPublicationRecord)

    env.emit({
      type: 'updated',
      sessionId: 's1',
      session: makeSession([item('a', { targetKey: 'D' })]),
    })
    await vi.advanceTimersByTimeAsync(2_000)
    await env.sync.idle()

    expect(env.api).not.toHaveBeenCalled()
  })

  it('skips sets followed from a live link', async () => {
    const env = setup()
    env.emit({
      type: 'updated',
      sessionId: 's1',
      session: makeSession([item('a'), item('b')], { liveSourceId: 'live-abc' }),
    })
    await vi.advanceTimersByTimeAsync(10_000)
    await env.sync.idle()

    expect(env.api).not.toHaveBeenCalled()
  })

  it('debounces rapid changes and publishes the latest version', async () => {
    const env = setup()
    for (let i = 0; i < 10; i++) {
      env.emit({
        type: 'updated',
        sessionId: 's1',
        session: makeSession([item('a'), item('b')], { name: `Set ${i}` }),
      })
      await vi.advanceTimersByTimeAsync(90)
    }
    await vi.advanceTimersByTimeAsync(2_000)
    await env.sync.idle()

    expect(env.api).toHaveBeenCalledTimes(1)
    expect(env.api.mock.calls[0][2].name).toBe('Set 9')
  })

  it('flushes a pending update with keepalive when the page is hidden', async () => {
    let hide!: () => void
    const env = setup({
      visibility: {
        subscribe(onHidden) {
          hide = onHidden
          return () => {}
        },
      },
    })
    env.emit({
      type: 'updated',
      sessionId: 's1',
      session: makeSession([item('a'), item('b')]),
    })
    hide()
    await vi.advanceTimersByTimeAsync(0)
    await env.sync.idle()

    expect(env.api).toHaveBeenCalledTimes(1)
    expect(env.api.mock.calls[0][3]).toEqual({ keepalive: true })
  })

  it('removes the local identity when the session is deleted', async () => {
    const env = setup()
    env.emit({ type: 'deleted', sessionId: 's1' })
    await vi.advanceTimersByTimeAsync(0)
    await env.sync.idle()

    expect(env.memory.has('s1')).toBe(false)
  })
})
