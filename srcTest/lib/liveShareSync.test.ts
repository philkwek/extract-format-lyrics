import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createLiveShareSync,
  hashLiveSongContent,
  LIVE_SHARE_MAX_SONGS,
  stopLiveShare,
  type LiveIdentityRecord,
  type LiveShareSyncDeps,
} from '../../src/lib/liveShareSync'
import { trackEvent } from '../../src/lib/analytics'
import { deleteLiveSetApi, LiveSetMissingContentError, ShareApiError } from '../../src/lib/api'
import {
  resetSetLinkIdentityStore,
  setSetLinkIdentityStoreForTesting,
} from '../../src/lib/setLinkIdentity'
import type { Session } from '../../src/lib/sessionStore'
import type { Song } from '../../src/types/song'

vi.mock('../../src/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('../../src/lib/api', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/api')>()),
  deleteLiveSetApi: vi.fn(async () => {}),
}))

type Listener = Parameters<LiveShareSyncDeps['store']['subscribe']>[0]

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

const item = (n: string, over: Record<string, unknown> = {}) => ({
  entryId: `e-${n}`,
  url: `https://x.test/${n}`,
  status: 'ok' as const,
  ...over,
})

const makeSession = (songs = [item('a'), item('b')]): Session => ({
  id: 's1',
  createdAt: 0,
  name: 'Set',
  songs,
})

function setup(opts: { identity?: boolean } = {}) {
  const identities = new Map<string, LiveIdentityRecord>()
  if (opts.identity !== false) {
    identities.set('s1', { sessionId: 's1', publicId: 'p'.repeat(22), secret: 'k' })
  }
  const listeners = new Set<Listener>()
  const expiresAt = () => new Date(Date.now() + 7 * 86400_000).toISOString()
  const putSong = vi.fn(async () => ({}))
  const putManifest = vi.fn(async () => ({ expiresAt: expiresAt() }))
  const onStatus = vi.fn()
  const deps: LiveShareSyncDeps = {
    store: { subscribe: (l) => (listeners.add(l), () => listeners.delete(l)) },
    identity: {
      get: async (id) => identities.get(id) ?? null,
      update: async (id, patch) => {
        const r = identities.get(id)
        if (r) identities.set(id, { ...r, ...patch })
      },
      remove: async (id) => void identities.delete(id),
    },
    api: { putSong, putManifest },
    getSong: async (url) => song(url.split('/').pop()!),
    now: () => Date.now(),
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    },
    random: () => 0,
    withLock: async (_n, fn) => fn(),
    onStatus,
  }
  const sync = createLiveShareSync(deps)
  sync.start()
  const emit = (type: 'created' | 'updated', session: Session) =>
    listeners.forEach((l) => l({ type, sessionId: session.id, session }))
  // Real SHA-256 resolves outside fake timers, so also wait for the engine to go idle.
  const settle = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms)
    await sync.idle()
  }
  return { settle, sync, putSong, putManifest, identities, emit, onStatus }
}

describe('liveShareSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('uploads each content hash once, and a key change sends only the manifest', async () => {
    const env = setup()
    env.emit('created', makeSession())
    await env.settle(0)
    expect(env.putSong).toHaveBeenCalledTimes(2)
    expect(env.putManifest).toHaveBeenCalledTimes(1)
    expect(env.identities.get('s1')?.knownContentHashes).toHaveLength(2)

    await env.settle(10_000)
    env.emit('updated', makeSession([item('a', { targetKey: 'D' }), item('b')]))
    await env.settle(2_000)
    expect(env.putSong).toHaveBeenCalledTimes(2)
    expect(env.putManifest).toHaveBeenCalledTimes(2)
  })

  it('a section change uploads one new content doc and the manifest', async () => {
    const env = setup()
    env.emit('created', makeSession())
    await env.settle(0)
    await env.settle(10_000)
    env.putSong.mockClear()
    env.emit('updated', makeSession([item('a', { customFlow: [0, 0] }), item('b')]))
    await env.settle(2_000)
    expect(env.putSong).toHaveBeenCalledTimes(1)
    expect(env.putManifest).toHaveBeenCalledTimes(2)
    expect(env.identities.get('s1')?.knownContentHashes).toHaveLength(2)
  })

  it('re-uploads on a 409 and retries the manifest once', async () => {
    const env = setup()
    env.emit('created', makeSession([item('a')]))
    await env.settle(0)
    const hash = env.identities.get('s1')!.knownContentHashes![0]
    env.putSong.mockClear()
    env.putManifest.mockClear()
    env.putManifest.mockRejectedValueOnce(new LiveSetMissingContentError([hash]))
    await env.settle(10_000)
    env.emit('updated', makeSession([item('a', { targetKey: 'D' })]))
    await env.settle(2_000)
    expect(env.putSong).toHaveBeenCalledTimes(1)
    expect(env.putManifest).toHaveBeenCalledTimes(2)
  })

  it('does not publish without a live identity', async () => {
    const env = setup({ identity: false })
    env.emit('created', makeSession())
    await env.settle(0)
    await env.settle(10_000)
    expect(env.putSong).not.toHaveBeenCalled()
    expect(env.putManifest).not.toHaveBeenCalled()
  })

  it('does not publish a set that follows a host', async () => {
    const env = setup()
    env.emit('created', { ...makeSession(), followHost: true })
    await env.settle(0)
    await env.settle(10_000)
    expect(env.putSong).not.toHaveBeenCalled()
    expect(env.putManifest).not.toHaveBeenCalled()
  })

  it('stops at 30 songs', async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => item(`s${i}`))
    const env = setup()
    env.emit('created', makeSession(many(LIVE_SHARE_MAX_SONGS + 1)))
    await env.settle(0)
    expect(env.putManifest).not.toHaveBeenCalled()
    await env.settle(10_000)
    env.emit('updated', makeSession(many(LIVE_SHARE_MAX_SONGS)))
    await env.settle(2_000)
    expect(env.putManifest).toHaveBeenCalledTimes(1)
  })

  it('reports failing when the server refuses, and ok after a publish', async () => {
    const env = setup()
    env.putManifest.mockRejectedValueOnce(new ShareApiError('no', 'FORBIDDEN', 403))
    env.emit('created', makeSession([item('a')]))
    await env.settle(0)
    expect(env.onStatus).toHaveBeenLastCalledWith('s1', 'failing')
    await env.settle(10_000)
    env.emit('updated', makeSession([item('a', { targetKey: 'D' })]))
    await env.settle(2_000)
    expect(env.onStatus).toHaveBeenLastCalledWith('s1', 'ok')
  })

  it('removes the identity when the session is deleted', async () => {
    const env = setup()
    env.sync.handleEvent({ type: 'deleted', sessionId: 's1' })
    await env.settle(0)
    expect(env.identities.has('s1')).toBe(false)
  })
})

describe('stopLiveShare', () => {
  const memory = new Map<string, unknown>()
  beforeEach(() => {
    memory.clear()
    memory.set('live:s1', { sessionId: 's1', publicId: 'p'.repeat(22), secret: 'k' })
    setSetLinkIdentityStoreForTesting({
      get: async <T,>(k: string) => memory.get(k) as T | undefined,
      set: async (k, v) => void memory.set(k, v),
      del: async (k) => void memory.delete(k),
    })
    vi.mocked(deleteLiveSetApi).mockReset()
    vi.mocked(trackEvent).mockClear()
  })
  afterEach(() => resetSetLinkIdentityStore())

  it('sends DELETE and removes the identity', async () => {
    vi.mocked(deleteLiveSetApi).mockResolvedValue()
    await stopLiveShare('s1')
    expect(deleteLiveSetApi).toHaveBeenCalledWith('p'.repeat(22), 'k')
    expect(memory.has('live:s1')).toBe(false)
    expect(trackEvent).toHaveBeenCalledWith('live_share_stopped', {})
  })

  it('keeps the identity when the network fails', async () => {
    vi.mocked(deleteLiveSetApi).mockRejectedValue(new TypeError('offline'))
    await expect(stopLiveShare('s1')).rejects.toThrow('offline')
    expect(memory.has('live:s1')).toBe(true)
    expect(trackEvent).not.toHaveBeenCalledWith('live_share_stopped', {})
  })
})

describe('content hash', () => {
  it('equals the server hash for the same content', async () => {
    // The same fixture and value are pinned against the server's hashLiveSongContent
    // in functions/srcTest/liveSetStore.test.ts.
    const demo: Song = {
      id: 'demo',
      title: 'Demo',
      artist: 'Nobody',
      sourceUrl: 'https://example.test/demo',
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
    }
    expect(await hashLiveSongContent({ song: demo, customFlow: [0, 0] })).toBe(
      'ead3f44b931987e257aa7b2dda593bc2f1c8c7893eee3ab8571958d682598b80'
    )
  })
})
