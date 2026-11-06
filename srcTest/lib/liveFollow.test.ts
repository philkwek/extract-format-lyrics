import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyLiveSet,
  followLiveSet,
  type FollowDeps,
  type FollowStatus,
  openLiveShare,
  openLiveShareOnce,
  refreshFromLiveSet,
  type LiveFollowDeps,
} from '../../src/lib/liveFollow'
import { buildLivePayload, hashLivePayload, hashLiveSongContent } from '../../src/lib/liveShareSync'
import { ShareApiError, type GetLiveSetResult } from '../../src/lib/api'
import { SessionStore, type Session, type SessionStorageStore } from '../../src/lib/sessionStore'
import type { LiveSetManifest, LiveSongContent, Song } from '../../src/types/song'

const LIVE = 'L'.repeat(22)

const song = (n: string): Song => ({
  id: n,
  title: `Song ${n}`,
  artist: 'Nobody',
  sourceUrl: `https://x.test/${n}`,
  sourceSite: 'test',
  originalKey: 'C',
  sections: [
    {
      type: 'Verse',
      label: 'Verse 1',
      lines: [{ kind: 'lyric', text: 'la la la', chords: [{ pos: 3, chord: 'G' }] }],
    },
  ],
  flow: [0],
})

async function liveResponse(
  over: { rev?: number; status?: 'live' | 'stopped'; dropContent?: boolean } = {},
): Promise<GetLiveSetResult> {
  const a: LiveSongContent = {
    song: song('a'),
    customSections: [{ type: 'Chorus', label: 'Chorus', lines: [] }],
    customFlow: [0, 0],
  }
  const b: LiveSongContent = { song: song('b') }
  const ha = await hashLiveSongContent(a)
  const hb = await hashLiveSongContent(b)
  const status = over.status ?? 'live'
  return {
    id: LIVE,
    manifest: {
      v: 1,
      name: 'Sunday',
      status,
      rev: over.rev ?? 3,
      entries:
        status === 'stopped'
          ? []
          : [
              {
                entryId: 'e-a',
                contentHash: ha,
                targetKey: 'D',
                simplified: true,
                padKeyMode: 'custom',
                customPadKey: 'F',
              },
              { entryId: 'e-b', contentHash: hb },
            ],
    },
    contents:
      status === 'stopped' ? {} : over.dropContent ? { [ha]: a } : { [ha]: a, [hb]: b },
    expiresAt: new Date(Date.now() + 86400_000).toISOString(),
  }
}

function setup(response: () => Promise<GetLiveSetResult>) {
  let data: Session[] | undefined
  const storage: SessionStorageStore = {
    get: (async () => data) as never,
    set: (async (_k: unknown, v: Session[]) => void (data = v)) as never,
    del: (async () => {}) as never,
  }
  const identityStore = new Map<string, unknown>()
  const store = new SessionStore(storage, {
    get: async (k: string) => identityStore.get(k),
    set: async (k: string, v: unknown) => void identityStore.set(k, v),
    del: async (k: string) => void identityStore.delete(k),
  } as never)
  const songs = new Map<string, Song>()
  const fetchLive = vi.fn(response)
  const deps: LiveFollowDeps = {
    fetchLive,
    sessions: store,
    saveSong: async (s) => void songs.set(s.sourceUrl, s),
    getSong: async (url) => songs.get(url) ?? null,
  }
  return { store, songs, fetchLive, deps }
}

describe('openLiveShare', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates one live set with the host content', async () => {
    const t = setup(() => liveResponse())
    const r = await openLiveShare(LIVE, { deps: t.deps })
    expect(r.kind).toBe('opened')
    const session = (r as { session: Session }).session
    expect(session).toMatchObject({
      liveSourceId: LIVE,
      liveRev: 3,
      name: 'Sunday',
    })
    expect(await t.store.getAllSessions()).toHaveLength(1)
    expect(session.songs[0]).toMatchObject({
      entryId: 'e-a',
      targetKey: 'D',
      simplified: true,
      padKeyMode: 'custom',
      customPadKey: 'F',
      customFlow: [0, 0],
      status: 'ok',
    })
    expect(session.songs[0].customSections).toHaveLength(1)
    expect(t.songs.has('https://x.test/a')).toBe(true)

    const { payload } = await buildLivePayload(session, t.deps.getSong)
    expect(session.lastHostHash).toBe(await hashLivePayload(payload!))
    expect((await t.store.findByLiveSourceId(LIVE))?.lastHostHash).toBe(session.lastHostHash)
  })

  it('reuses the set on a second open', async () => {
    const t = setup(() => liveResponse())
    const first = await openLiveShare(LIVE, { deps: t.deps })
    const second = await openLiveShare(LIVE, { deps: t.deps })
    expect(second.kind).toBe('reused')
    expect((second as { session: Session }).session.id).toBe(
      (first as { session: Session }).session.id,
    )
    expect(await t.store.getAllSessions()).toHaveLength(1)
  })

  it('refreshes a reused live set when the host moved on', async () => {
    let rev = 3
    const t = setup(() => liveResponse({ rev }))
    await openLiveShare(LIVE, { deps: t.deps })
    rev = 4
    const second = await openLiveShare(LIVE, { deps: t.deps })
    expect((second as { session: Session }).session.liveRev).toBe(4)
  })

  it('always refreshes an existing live set when the host moved on', async () => {
    let rev = 3
    const t = setup(() => liveResponse({ rev }))
    const first = (await openLiveShare(LIVE, { deps: t.deps })) as { session: Session }
    first.session.songs[0].targetKey = 'A'
    await t.store.updateSession(first.session)
    rev = 4
    const second = (await openLiveShare(LIVE, { deps: t.deps })) as { session: Session }
    expect(second.session.liveRev).toBe(4)
    expect(second.session.songs[0].targetKey).toBe('D')
  })

  it('keeps the local songs when a live set is reused after the host stopped', async () => {
    const t = setup(() => liveResponse())
    const opened = (await openLiveShare(LIVE, { deps: t.deps })) as { session: Session }
    const songs = structuredClone(opened.session.songs)

    t.fetchLive.mockResolvedValue(await liveResponse({ status: 'stopped', rev: 4 }))
    const second = await openLiveShare(LIVE, { deps: t.deps })

    expect(second.kind).toBe('reused')
    expect((second as { session: Session }).session.liveRev).toBe(3)
    expect((second as { session: Session }).session.songs).toEqual(songs)
    const stored = await t.store.getSession(opened.session.id)
    expect(stored?.liveRev).toBe(3)
    expect(stored?.songs).toEqual(songs)
  })

  it('opens a reused set offline', async () => {
    const t = setup(() => liveResponse())
    await openLiveShare(LIVE, { deps: t.deps })
    t.fetchLive.mockRejectedValue(new Error('offline'))
    expect((await openLiveShare(LIVE, { deps: t.deps })).kind).toBe('reused')
  })

  it('imports once for concurrent opens', async () => {
    const t = setup(() => liveResponse())
    const [a, b] = await Promise.all([
      openLiveShareOnce(LIVE, { deps: t.deps }),
      openLiveShareOnce(LIVE, { deps: t.deps }),
    ])
    expect(a).toBe(b)
    expect(await t.store.getAllSessions()).toHaveLength(1)
    expect(t.fetchLive).toHaveBeenCalledTimes(1)
  })

  it('keeps an entry with missing content as an error item', async () => {
    const t = setup(() => liveResponse({ dropContent: true }))
    const r = await openLiveShare(LIVE, { deps: t.deps })
    const songs = (r as { session: Session }).session.songs
    expect(songs[0].status).toBe('ok')
    expect(songs[1]).toMatchObject({ entryId: 'e-b', status: 'error' })
    expect(songs[1].errorMessage).toBeTruthy()
  })

  it('reports stopped, expired and missing', async () => {
    const stopped = setup(() => liveResponse({ status: 'stopped' }))
    expect((await openLiveShare(LIVE, { deps: stopped.deps })).kind).toBe('stopped')
    expect(await stopped.store.getAllSessions()).toHaveLength(0)

    const expired = setup(async () => {
      throw new ShareApiError('gone', 'EXPIRED', 410)
    })
    expect((await openLiveShare(LIVE, { deps: expired.deps })).kind).toBe('expired')

    const missing = setup(async () => {
      throw new ShareApiError('none', 'NOT_FOUND', 404)
    })
    expect((await openLiveShare(LIVE, { deps: missing.deps })).kind).toBe('missing')
  })

  it('rethrows other errors', async () => {
    const t = setup(async () => {
      throw new Error('boom')
    })
    await expect(openLiveShare(LIVE, { deps: t.deps })).rejects.toThrow('boom')
  })
})

describe('refreshFromLiveSet', () => {
  it('replaces the content but keeps the session id and public id', async () => {
    const t = setup(() => liveResponse())
    const opened = (await openLiveShare(LIVE, { deps: t.deps })) as { session: Session }
    const { id, publicId } = opened.session
    const next = await liveResponse({ rev: 9 })
    next.manifest.name = 'Evening'
    next.manifest.entries = next.manifest.entries.slice(1)
    const session = await refreshFromLiveSet(opened.session, next, t.deps)
    expect(session).toMatchObject({ id, publicId, name: 'Evening', liveRev: 9 })
    expect(session.songs).toHaveLength(1)
    const saved = await t.store.getSession(id)
    expect(saved).toMatchObject({ publicId, liveSourceId: LIVE, liveRev: 9 })
    expect(saved?.lastHostHash).not.toBe(undefined)
  })
})

describe('applyLiveSet', () => {
  it('keeps manifest order', async () => {
    const saveSong = vi.fn(async () => {})
    const { songs } = await applyLiveSet(await liveResponse(), { saveSong })
    expect(songs.map((s) => s.entryId)).toEqual(['e-a', 'e-b'])
    expect(saveSong).toHaveBeenCalledTimes(2)
  })
})

describe('stale saves', () => {
  it('keeps the newer host revision and hash when an older copy is saved', async () => {
    const t = setup(() => liveResponse({ rev: 3 }))
    const { session } = (await openLiveShare(LIVE, { deps: t.deps })) as { session: Session }
    const stale = structuredClone(session)
    await refreshFromLiveSet(session, await liveResponse({ rev: 7 }), t.deps)
    const newerHash = session.lastHostHash
    stale.songs = stale.songs.slice(1)
    await t.store.updateSession(stale)
    const saved = await t.store.getSession(session.id)
    expect(saved).toMatchObject({ liveRev: 7, lastHostHash: newerHash })
  })
})

describe('followLiveSet', () => {
  let visibility: 'visible' | 'hidden'
  let visibilityListeners: Array<() => void>

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    visibility = 'visible'
    visibilityListeners = []
    vi.stubGlobal('document', {
      get visibilityState() {
        return visibility
      },
      addEventListener: (_: string, fn: () => void) => visibilityListeners.push(fn),
      removeEventListener: (_: string, fn: () => void) => {
        visibilityListeners = visibilityListeners.filter((l) => l !== fn)
      },
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const settle = () => new Promise((r) => setTimeout(r, 30))

  async function follow(
    options: { listener?: boolean; defer?: () => boolean; catchUpFails?: boolean } = {},
  ) {
    const remote = { current: await liveResponse({ rev: 3 }) }
    const t = setup(async () => remote.current)
    const { session } = (await openLiveShare(LIVE, { deps: t.deps })) as { session: Session }
    if (options.catchUpFails) t.fetchLive.mockRejectedValueOnce(new Error('offline'))
    const table = new Map<string, LiveSongContent>(Object.entries(remote.current.contents))
    let emit: (m: LiveSetManifest) => void = () => {}
    let fail: (e: unknown) => void = () => {}
    const unsubscribe = vi.fn()
    const getContent = vi.fn(async (_: string, hash: string) => table.get(hash) ?? null)
    const deps: FollowDeps = {
      ...t.deps,
      getContent,
      pollMs: 30_000,
      subscribeManifest:
        options.listener === false
          ? null
          : vi.fn(async (_id, onNext, onError) => {
              emit = onNext
              fail = onError
              return unsubscribe
            }),
    }
    const statuses: FollowStatus[] = []
    const updates: number[] = []
    const handlers = {
      onUpdate: (s: Session) => void updates.push(s.liveRev ?? -1),
      onStatus: (s: FollowStatus) => void statuses.push(s),
      shouldDefer: options.defer,
    }
    const controller = followLiveSet(session, handlers, { deps })
    await settle()
    updates.length = 0
    t.fetchLive.mockClear()

    /** A manifest at `rev`, optionally with one more song whose content the table holds. */
    const manifestAt = async (rev: number, extra?: string): Promise<LiveSetManifest> => {
      const manifest: LiveSetManifest = structuredClone(remote.current.manifest)
      manifest.rev = rev
      if (extra) {
        const content: LiveSongContent = { song: song(extra) }
        const contentHash = await hashLiveSongContent(content)
        table.set(contentHash, content)
        manifest.entries.push({ entryId: `e-${extra}`, contentHash })
      }
      return manifest
    }
    return {
      ...t,
      session,
      controller,
      deps,
      statuses,
      updates,
      getContent,
      unsubscribe,
      manifestAt,
      remote,
      emit: (m: LiveSetManifest) => emit(m),
      fail: (e: unknown) => fail(e),
    }
  }

  it('applies a newer rev and ignores a stale one', async () => {
    const f = await follow()
    f.emit(await f.manifestAt(4))
    await settle()
    expect(f.updates).toEqual([4])
    f.emit(await f.manifestAt(2))
    f.emit(await f.manifestAt(4))
    await settle()
    expect(f.updates).toEqual([4])
    f.controller.stop()
  })

  it('fetches only the content it does not have', async () => {
    const f = await follow()
    f.emit(await f.manifestAt(4))
    await settle()
    expect(f.getContent).not.toHaveBeenCalled()
    f.emit(await f.manifestAt(5, 'c'))
    await settle()
    expect(f.getContent).toHaveBeenCalledTimes(1)
    expect((await f.store.getSession(f.session.id))?.songs).toHaveLength(3)
    f.controller.stop()
  })

  it('forgets content the latest manifest no longer uses', async () => {
    const f = await follow()
    f.emit(await f.manifestAt(4, 'c'))
    await settle()
    expect(f.getContent).toHaveBeenCalledTimes(1)

    f.emit(await f.manifestAt(5))
    await settle()
    f.emit(await f.manifestAt(6, 'c'))
    await settle()

    expect(f.getContent).toHaveBeenCalledTimes(2)
    f.controller.stop()
  })

  it('applies only the newest of several quick revs after the current one', async () => {
    const f = await follow()
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    f.getContent.mockImplementationOnce(async () => {
      await gate
      return { song: song('c') }
    })
    f.emit(await f.manifestAt(4, 'c'))
    await settle()
    f.emit(await f.manifestAt(5, 'c'))
    f.emit(await f.manifestAt(6, 'c'))
    release()
    await settle()
    expect(f.updates).toEqual([4, 6])
    f.controller.stop()
  })

  it('reports stopped and keeps the last version', async () => {
    const f = await follow()
    const manifest = await f.manifestAt(4)
    f.emit({ ...manifest, status: 'stopped', entries: [] })
    await settle()
    expect(f.statuses.at(-1)).toBe('stopped')
    expect(f.updates).toEqual([])
    expect((await f.store.getSession(f.session.id))?.songs).toHaveLength(2)
    f.controller.stop()
  })

  it('saves on the set that the live share ended', async () => {
    const f = await follow()
    const manifest = await f.manifestAt(4)
    f.emit({ ...manifest, status: 'stopped', entries: [] })
    await settle()
    expect((await f.store.getSession(f.session.id))?.liveEnded).toBe('stopped')
    f.controller.stop()
  })

  it('ignores the rev 0 placeholder', async () => {
    const f = await follow()
    f.emit(await f.manifestAt(0))
    await settle()
    expect(f.updates).toEqual([])
    f.controller.stop()
  })

  it('reports reconnecting and keeps polling on permission-denied', async () => {
    const f = await follow()
    f.fail({ code: 'permission-denied' })
    expect(f.statuses.at(-1)).toBe('reconnecting')
    f.remote.current = await liveResponse({ rev: 5 })
    await vi.advanceTimersByTimeAsync(30_000)
    await settle()
    expect(f.fetchLive).toHaveBeenCalledTimes(1)
    expect(f.statuses.at(-1)).toBe('live')
    f.controller.stop()
  })

  it('reports expired when the server says the share is gone', async () => {
    const f = await follow()
    f.fail(new ShareApiError('gone', 'EXPIRED', 410))
    expect(f.statuses.at(-1)).toBe('expired')
    await vi.advanceTimersByTimeAsync(90_000)
    expect(f.fetchLive).not.toHaveBeenCalled()
    f.controller.stop()
  })

  it('reports expired when a poll says the share is gone', async () => {
    const f = await follow()
    f.fetchLive.mockRejectedValue(new ShareApiError('gone', 'EXPIRED', 410))
    f.fail(new Error('network'))
    expect(f.statuses.at(-1)).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(30_000)
    await settle()
    expect(f.statuses.at(-1)).toBe('expired')
    f.controller.stop()
  })

  it('polls every 30 seconds after a listener error, and pauses while hidden', async () => {
    const f = await follow()
    f.fail(new Error('blocked'))
    expect(f.statuses.at(-1)).toBe('reconnecting')
    f.remote.current = await liveResponse({ rev: 5 })
    await vi.advanceTimersByTimeAsync(30_000)
    await settle()
    expect(f.fetchLive).toHaveBeenCalledTimes(1)
    expect(f.updates).toEqual([5])
    expect(f.statuses.at(-1)).toBe('live')

    visibility = 'hidden'
    await vi.advanceTimersByTimeAsync(90_000)
    expect(f.fetchLive).toHaveBeenCalledTimes(1)

    visibility = 'visible'
    visibilityListeners.forEach((l) => l())
    await settle()
    expect(f.fetchLive).toHaveBeenCalledTimes(2)
    f.controller.stop()
  })

  it('reports reconnecting when the first catch-up cannot reach the server', async () => {
    const f = await follow({ listener: false, catchUpFails: true })
    expect(f.statuses.at(-1)).toBe('reconnecting')
    f.remote.current = await liveResponse({ rev: 5 })
    await vi.advanceTimersByTimeAsync(30_000)
    await settle()
    expect(f.statuses.at(-1)).toBe('live')
    f.controller.stop()
  })

  it('polls without a listener when Firestore is not configured', async () => {
    const f = await follow({ listener: false })
    f.remote.current = await liveResponse({ rev: 6 })
    await vi.advanceTimersByTimeAsync(30_000)
    await settle()
    expect(f.updates).toEqual([6])
    f.controller.stop()
  })

  it('stop() unsubscribes and ends polling and in-flight applies', async () => {
    const f = await follow()
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    f.getContent.mockImplementationOnce(async () => {
      await gate
      return { song: song('c') }
    })
    f.emit(await f.manifestAt(4, 'c'))
    await settle()
    f.controller.stop()
    release()
    await settle()
    expect(f.unsubscribe).toHaveBeenCalled()
    expect(f.updates).toEqual([])
    expect((await f.store.getSession(f.session.id))?.liveRev).toBe(3)
    f.fail(new Error('late'))
    await vi.advanceTimersByTimeAsync(90_000)
    expect(f.fetchLive).not.toHaveBeenCalled()
  })

  it('holds updates while deferred, then flushes only the latest', async () => {
    let defer = true
    const f = await follow({ defer: () => defer })
    f.emit(await f.manifestAt(4))
    f.emit(await f.manifestAt(5))
    await settle()
    expect(f.updates).toEqual([])
    defer = false
    f.controller.flushDeferred()
    await settle()
    expect(f.updates).toEqual([5])
    f.controller.stop()
  })

  it('drops a held update', async () => {
    let defer = true
    const f = await follow({ defer: () => defer })
    f.emit(await f.manifestAt(4))
    f.controller.dropDeferred()
    defer = false
    f.controller.flushDeferred()
    await settle()
    expect(f.updates).toEqual([])
    f.controller.stop()
  })
})

describe('parseEmulatorHost', () => {
  it('reads host:port and ignores anything else', async () => {
    const { parseEmulatorHost } = await import('../../src/lib/liveFollow')
    expect(parseEmulatorHost('127.0.0.1:8080')).toEqual({ host: '127.0.0.1', port: 8080 })
    expect(parseEmulatorHost('localhost:9000')).toEqual({ host: 'localhost', port: 9000 })
    expect(parseEmulatorHost(undefined)).toBeNull()
    expect(parseEmulatorHost('')).toBeNull()
    expect(parseEmulatorHost('https://x.test')).toBeNull()
  })
})
