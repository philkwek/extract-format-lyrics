import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyLiveSet,
  openLiveShare,
  openLiveShareOnce,
  refreshFromLiveSet,
  type LiveFollowDeps,
} from '../../src/lib/liveFollow'
import { buildLivePayload, hashLivePayload, hashLiveSongContent } from '../../src/lib/liveShareSync'
import { ShareApiError, type GetLiveSetResult } from '../../src/lib/api'
import { SessionStore, type Session, type SessionStorageStore } from '../../src/lib/sessionStore'
import type { LiveSongContent, Song } from '../../src/types/song'

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
  return {
    id: LIVE,
    manifest: {
      v: 1,
      name: 'Sunday',
      status: over.status ?? 'live',
      rev: over.rev ?? 3,
      entries: [
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
    contents: over.dropContent ? { [ha]: a } : { [ha]: a, [hb]: b },
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

  it('creates one following set with the host content', async () => {
    const t = setup(() => liveResponse())
    const r = await openLiveShare(LIVE, { deps: t.deps })
    expect(r.kind).toBe('opened')
    const session = (r as { session: Session }).session
    expect(session).toMatchObject({
      liveSourceId: LIVE,
      followHost: true,
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

  it('refreshes a reused following set when the host moved on', async () => {
    let rev = 3
    const t = setup(() => liveResponse({ rev }))
    await openLiveShare(LIVE, { deps: t.deps })
    rev = 4
    const second = await openLiveShare(LIVE, { deps: t.deps })
    expect((second as { session: Session }).session.liveRev).toBe(4)
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
    expect(saved).toMatchObject({ publicId, liveSourceId: LIVE, followHost: true, liveRev: 9 })
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
