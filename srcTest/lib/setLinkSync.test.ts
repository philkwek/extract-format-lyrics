import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildSetLinkPayload,
  createSetLinkSync,
  createSyncChannel,
  ensureSetLinkFresh,
  hashSetLinkPayload,
  type SetLinkSyncDeps,
} from '../../src/lib/setLinkSync'
import { SessionStore, type Session, type SessionStorageStore } from '../../src/lib/sessionStore'
import type { SetLinkIdentityRecord, SetLinkIdentityStore } from '../../src/lib/setLinkIdentity'
import { ShareApiError } from '../../src/lib/api'
import { withNamedLock } from '../../src/lib/lyricsPublishIdentity'

type Listener = Parameters<SetLinkSyncDeps['store']['subscribe']>[0]

function makeSession(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    createdAt: 0,
    name: 'Set',
    publicId: 'p'.repeat(22),
    songs: [{ entryId: 'e1', url: 'https://x.test/a', targetKey: 'C' }],
    ...over,
  }
}

const fakeHash = async (p: unknown) => JSON.stringify(p)

function setup(opts: { identities?: Map<string, SetLinkIdentityRecord>; seed?: Partial<SetLinkIdentityRecord> } = {}) {
  const identities = opts.identities ?? new Map<string, SetLinkIdentityRecord>()
  if (!identities.has('s1')) {
    identities.set('s1', { sessionId: 's1', publicId: 'p'.repeat(22), secret: 'k', ...opts.seed })
  }
  const listeners = new Set<Listener>()
  const callTimes: number[] = []
  const api = vi.fn(async (): Promise<{ id: string; expiresAt: string; unchanged: boolean }> => {
    callTimes.push(Date.now())
    return { id: 'x', expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(), unchanged: false }
  })
  const deps: SetLinkSyncDeps = {
    store: { subscribe: (l) => (listeners.add(l), () => listeners.delete(l)) },
    identity: {
      get: async (id) => identities.get(id) ?? null,
      update: async (id, patch) => {
        const r = identities.get(id)
        if (r) identities.set(id, { ...r, ...patch })
      },
      remove: async (id) => void identities.delete(id),
    },
    api: api as unknown as SetLinkSyncDeps['api'],
    now: () => Date.now(),
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    },
    hash: fakeHash,
    random: () => 0,
    withLock: async (_n, fn) => fn(),
    track: vi.fn(),
  }
  const sync = createSetLinkSync(deps)
  sync.start()
  const emit = (e: Parameters<Listener>[0]) => listeners.forEach((l) => l(e))
  return { sync, deps, api, identities, emit, callTimes }
}

const ev = (type: 'created' | 'updated', session: Session) => ({ type, sessionId: session.id, session })
const withKey = (key: string): Session => makeSession({ songs: [{ ...makeSession().songs[0], targetKey: key }] })

describe('buildSetLinkPayload', () => {
  it('excludes uploads and non-http urls, keeps everything else', () => {
    const session = makeSession({
      name: '  Sunday  ',
      songs: [
        {
          entryId: 'e1', url: 'https://x.test/a', title: 'T', artist: 'A', targetKey: 'D',
          simplified: true, padKeyMode: 'custom', customPadKey: 'E',
          customSections: [{ label: 'x' } as never], customFlow: [1],
        },
        { entryId: 'e2', url: 'upload://abc' },
        { entryId: 'e3', url: 'https://x.test/b' },
        { entryId: 'e4', url: 'ftp://x.test/c' },
      ],
    })
    const r = buildSetLinkPayload(session)
    expect(r.skippedUploads).toBe(1)
    expect(r.payload).toEqual({
      v: 1,
      name: 'Sunday',
      songs: [
        { entryId: 'e1', url: 'https://x.test/a', title: 'T', artist: 'A', targetKey: 'D', simplified: true, padKeyMode: 'custom', customPadKey: 'E' },
        { entryId: 'e3', url: 'https://x.test/b' },
      ],
    })
  })

  it('returns null for empty and too many songs', () => {
    expect(buildSetLinkPayload(makeSession({ songs: [] })).reason).toBe('empty')
    const many = Array.from({ length: 31 }, (_, i) => ({ entryId: `e${i}`, url: 'https://x.test/a' }))
    const r = buildSetLinkPayload(makeSession({ songs: many }))
    expect(r.payload).toBeNull()
    expect(r.reason).toBe('too_many')
  })

  it('hashes canonically', async () => {
    const a = await hashSetLinkPayload({ v: 1, name: 'n', songs: [] })
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashSetLinkPayload({ songs: [], name: 'n', v: 1 })).toBe(a)
  })
})

describe('setLinkSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  async function seedHash(env: ReturnType<typeof setup>, session: Session) {
    const { payload } = buildSetLinkPayload(session)
    env.identities.set('s1', {
      ...env.identities.get('s1')!,
      lastPublishedHash: await fakeHash(payload),
      expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
    })
  }

  it('publishes immediately on create', async () => {
    const env = setup()
    env.emit(ev('created', makeSession()))
    await vi.advanceTimersByTimeAsync(0)
    expect(env.api).toHaveBeenCalledTimes(1)
    expect(env.identities.get('s1')?.lastPublishedHash).toBeTruthy()
    expect(env.deps.track).toHaveBeenCalledWith('set_link_published', { song_count: 1, skipped_uploads: 0, trigger: 'create' })
  })

  it('does not publish a set opened from a live link', async () => {
    const env = setup()
    env.emit(ev('created', makeSession({ liveSourceId: 'live-abc' })))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(env.api).not.toHaveBeenCalled()
  })

  it('does not write for edits that do not change the payload', async () => {
    const env = setup()
    const base = makeSession()
    await seedHash(env, base)
    for (let i = 0; i < 50; i++) {
      const s = makeSession()
      s.songs[0].customSections = [{ label: `v${i}` } as never]
      env.emit(ev('updated', s))
      await vi.advanceTimersByTimeAsync(100)
    }
    await vi.advanceTimersByTimeAsync(10_000)
    expect(env.api).toHaveBeenCalledTimes(0)
  })

  it('debounces rapid set-level changes into one publish with the last value', async () => {
    const env = setup()
    await seedHash(env, makeSession())
    for (let i = 0; i < 10; i++) {
      env.emit(ev('updated', withKey(`K${i}`)))
      await vi.advanceTimersByTimeAsync(90)
    }
    await vi.advanceTimersByTimeAsync(3000)
    expect(env.api).toHaveBeenCalledTimes(1)
    const payload = (env.api.mock.calls[0] as unknown as [string, string, { songs: { targetKey: string }[] }])[2]
    expect(payload.songs[0].targetKey).toBe('K9')
  })

  it('spaces publishes at least 5s apart', async () => {
    const env = setup()
    await seedHash(env, makeSession())
    env.emit(ev('updated', withKey('A')))
    await vi.advanceTimersByTimeAsync(2000)
    env.emit(ev('updated', withKey('B')))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(env.api).toHaveBeenCalledTimes(2)
    expect(env.callTimes[1] - env.callTimes[0]).toBeGreaterThanOrEqual(5000)
    expect(env.callTimes[1] - env.callTimes[0]).toBeLessThan(10_000)
  })

  it('sends exactly one follow-up when changes arrive during an in-flight publish', async () => {
    const env = setup()
    let release!: () => void
    env.api.mockImplementationOnce(async () => {
      await new Promise<void>((r) => (release = r))
      return { id: 'x', expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(), unchanged: false }
    })
    env.emit(ev('created', withKey('A')))
    await vi.advanceTimersByTimeAsync(0)
    env.emit(ev('updated', withKey('B')))
    env.emit(ev('updated', withKey('C')))
    await vi.advanceTimersByTimeAsync(2000)
    expect(env.api).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(env.api).toHaveBeenCalledTimes(2)
    const p = (env.api.mock.calls[1] as unknown as [string, string, { songs: { targetKey: string }[] }])[2]
    expect(p.songs[0].targetKey).toBe('C')
  })

  it('two instances sharing identity and state publish once', async () => {
    const a = setup()
    const apiB = vi.fn(a.api)
    const sync2 = createSetLinkSync({
      ...a.deps,
      api: apiB as unknown as SetLinkSyncDeps['api'],
      withLock: withNamedLock,
    })
    const sync1 = createSetLinkSync({ ...a.deps, withLock: withNamedLock })
    const s = makeSession()
    sync1.handleEvent(ev('created', s))
    sync2.handleEvent(ev('created', s))
    await vi.advanceTimersByTimeAsync(0)
    await sync1.idle()
    await sync2.idle()
    expect(a.api).toHaveBeenCalledTimes(1)
  })

  it('retries 5xx three times then stops', async () => {
    const env = setup()
    env.api.mockRejectedValue(new ShareApiError('boom', 'INTERNAL', 500))
    env.emit(ev('created', makeSession()))
    await vi.advanceTimersByTimeAsync(0)
    expect(env.api).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(env.api).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(env.api).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(env.api).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(1_000_000)
    expect(env.api).toHaveBeenCalledTimes(4)
  })

  it('does not retry 403', async () => {
    const env = setup()
    env.api.mockRejectedValue(new ShareApiError('no', 'FORBIDDEN', 403))
    env.emit(ev('created', makeSession()))
    await vi.advanceTimersByTimeAsync(1_000_000)
    expect(env.api).toHaveBeenCalledTimes(1)
  })

  it('reports failing when building the payload throws, without an escaping rejection', async () => {
    vi.useRealTimers()
    const env = setup()
    const onStatus = vi.fn()
    const sync = createSyncChannel({
      ...env.deps,
      name: 'throwing-build',
      buildPayload: () => {
        throw new Error('boom')
      },
      publish: (identity, payload, options) =>
        env.deps.api(identity.publicId, identity.secret, payload, options),
      onStatus,
    })
    sync.handleEvent(ev('created', makeSession()))
    // idle() awaits the in-flight publish, so a rejection escaping it would fail here.
    await sync.idle()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(onStatus).toHaveBeenLastCalledWith('s1', 'failing')
    expect(env.api).not.toHaveBeenCalled()
  })

  it('retries 429 after Retry-After seconds without spending the backoff budget', async () => {
    const env = setup()
    env.api.mockRejectedValueOnce(new ShareApiError('slow', 'RATE_LIMITED', 429, 3))
    env.emit(ev('created', makeSession()))
    await vi.advanceTimersByTimeAsync(2900)
    expect(env.api).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(200)
    expect(env.api).toHaveBeenCalledTimes(2)
  })

  it('uses 120s without Retry-After and gives up on a daily cap', async () => {
    const env = setup()
    env.api.mockRejectedValueOnce(new ShareApiError('slow', 'RATE_LIMITED', 429))
    env.emit(ev('created', makeSession()))
    await vi.advanceTimersByTimeAsync(119_000)
    expect(env.api).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(env.api).toHaveBeenCalledTimes(2)

    const capped = setup()
    capped.api.mockRejectedValue(new ShareApiError('cap', 'RATE_LIMITED', 429, 7200))
    capped.emit(ev('created', makeSession()))
    await vi.advanceTimersByTimeAsync(1_000_000)
    expect(capped.api).toHaveBeenCalledTimes(1)
  })

  it('flushes a pending debounce with keepalive when the page is hidden', async () => {
    let hide!: () => void
    const env = setup()
    const sync = createSetLinkSync({
      ...env.deps,
      visibility: { subscribe: (cb) => ((hide = cb), () => {}) },
    })
    sync.start()
    await seedHash(env, makeSession())
    sync.handleEvent(ev('updated', withKey('Z')))
    hide()
    await vi.advanceTimersByTimeAsync(0)
    expect(env.api).toHaveBeenCalledTimes(1)
    expect((env.api.mock.calls[0] as unknown[])[3]).toEqual({ keepalive: true })
  })

  it('ensureFresh publishes near expiry or when stale, not when fresh', async () => {
    const session = makeSession()
    const near = setup()
    await seedHash(near, session)
    near.identities.set('s1', { ...near.identities.get('s1')!, expiresAt: new Date(Date.now() + 86400_000).toISOString() })
    expect(await near.sync.ensureFresh(session)).toEqual({ ok: true })
    expect(near.api).toHaveBeenCalledTimes(1)
    expect(near.deps.track).toHaveBeenCalledWith('set_link_published', expect.objectContaining({ trigger: 'refresh' }))

    const fresh = setup()
    await seedHash(fresh, session)
    expect(await fresh.sync.ensureFresh(session)).toEqual({ ok: true })
    expect(fresh.api).toHaveBeenCalledTimes(0)

    const never = setup()
    expect(await never.sync.ensureFresh(session)).toEqual({ ok: true })
    expect(never.api).toHaveBeenCalledTimes(1)

    const changed = setup()
    await seedHash(changed, session)
    expect(await changed.sync.ensureFresh(withKey('G'))).toEqual({ ok: true })
    expect(changed.api).toHaveBeenCalledTimes(1)

    const empty = setup()
    expect(await empty.sync.ensureFresh(makeSession({ songs: [] }))).toEqual({
      ok: false,
      reason: 'empty',
    })
    expect(empty.api).not.toHaveBeenCalled()

    const many = setup()
    const songs = Array.from({ length: 31 }, (_, i) => ({
      entryId: `e${i}`,
      url: 'https://x.test/a',
    }))
    expect(await many.sync.ensureFresh(makeSession({ songs }))).toEqual({
      ok: false,
      reason: 'too_many',
    })
    expect(many.api).not.toHaveBeenCalled()

    const broken = setup()
    broken.api.mockRejectedValue(new ShareApiError('no', 'FORBIDDEN', 403))
    expect(await broken.sync.ensureFresh(session)).toEqual({ ok: false, reason: 'failed' })
  })


  it('saving bookkeeping triggers no session events', async () => {
    const data = new Map<string, unknown>()
    const sessionBacking: SessionStorageStore = {
      get: (async (k: string) => data.get(k)) as never,
      set: (async (k: string, v: unknown) => void data.set(k, v)) as never,
      del: (async (k: string) => void data.delete(k)) as never,
    }
    const idData = new Map<string, unknown>()
    const idStore: SetLinkIdentityStore = {
      get: async <T>(k: string) => idData.get(k) as T | undefined,
      set: async (k, v) => void idData.set(k, v),
      del: async (k) => void idData.delete(k),
    }
    const store = new SessionStore(sessionBacking, idStore)
    const events = vi.fn()
    store.subscribe(events)
    const env = setup()
    const sync = createSetLinkSync({
      ...env.deps,
      store,
      identity: {
        get: async (id) => (await idStore.get<SetLinkIdentityRecord>(id)) ?? null,
        update: async (id, patch) => {
          const r = await idStore.get<SetLinkIdentityRecord>(id)
          if (r) await idStore.set(id, { ...r, ...patch })
        },
        remove: async (id) => idStore.del(id),
      },
    })
    sync.start()
    await store.createSession([{ url: 'https://x.test/a' }])
    await vi.advanceTimersByTimeAsync(10_000)
    await sync.idle()
    expect(env.api).toHaveBeenCalledTimes(1)
    expect(events).toHaveBeenCalledTimes(1)
  })

  it('deleting a session cancels timers and removes its identity', async () => {
    const env = setup()
    await seedHash(env, makeSession())
    env.emit(ev('updated', withKey('Q')))
    env.emit({ type: 'deleted', sessionId: 's1' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(env.api).toHaveBeenCalledTimes(0)
    expect(env.identities.has('s1')).toBe(false)
  })
})

describe('ensureSetLinkFresh', () => {
  it('reports why a set link cannot be published', async () => {
    expect(await ensureSetLinkFresh(makeSession({ id: 'fresh-empty', songs: [] }))).toEqual({
      ok: false,
      reason: 'empty',
    })
    const songs = Array.from({ length: 31 }, (_, i) => ({
      entryId: `e${i}`,
      url: 'https://x.test/a',
    }))
    expect(
      await ensureSetLinkFresh(makeSession({ id: 'fresh-many', songs })),
    ).toEqual({ ok: false, reason: 'too_many' })
  })
})

describe('createSyncChannel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('keeps channels with different names independent', async () => {
    const listeners = new Set<Listener>()
    const identity = {
      get: async () => ({ sessionId: 's1', publicId: 'p'.repeat(22), secret: 'k' }),
      update: async () => {},
      remove: async () => {},
    }
    const locks: string[] = []
    const base = {
      store: { subscribe: (l: Listener) => (listeners.add(l), () => listeners.delete(l)) },
      identity,
      buildPayload: buildSetLinkPayload,
      now: () => Date.now(),
      timers: {
        setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
        clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
      },
      hash: fakeHash,
      random: () => 0,
      withLock: async <T,>(name: string, fn: () => Promise<T>) => (locks.push(name), fn()),
    }
    const expiresAt = new Date(Date.now() + 30 * 86400_000).toISOString()
    const failing = vi.fn(async () => {
      throw new ShareApiError('boom', undefined, 500)
    })
    let release!: () => void
    const slow = vi.fn(() => new Promise<{ expiresAt: string }>((r) => (release = () => r({ expiresAt }))))
    createSyncChannel({ ...base, name: 'a', publish: failing }).start()
    createSyncChannel({ ...base, name: 'b', publish: slow }).start()

    listeners.forEach((l) => l(ev('created', makeSession())))
    await vi.advanceTimersByTimeAsync(0)

    expect(failing).toHaveBeenCalledTimes(1)
    expect(slow).toHaveBeenCalledTimes(1)
    expect(locks.sort()).toEqual(['a:s1', 'b:s1'])

    // a's failure and b's in-flight publish don't block each other: a retries while b is pending.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(failing).toHaveBeenCalledTimes(2)
    expect(slow).toHaveBeenCalledTimes(1)
    release()
  })

  it('skips sessions that shouldSync rejects', async () => {
    const publish = vi.fn(async () => ({ expiresAt: '' }))
    const listeners = new Set<Listener>()
    createSyncChannel({
      name: 'x',
      store: { subscribe: (l) => (listeners.add(l), () => listeners.delete(l)) },
      identity: { get: async () => null, update: async () => {}, remove: async () => {} },
      shouldSync: () => false,
      buildPayload: buildSetLinkPayload,
      publish,
      now: () => Date.now(),
      timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
      hash: fakeHash,
      withLock: async (_n, fn) => fn(),
    }).start()
    listeners.forEach((l) => l(ev('created', makeSession())))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(publish).not.toHaveBeenCalled()
  })
})
