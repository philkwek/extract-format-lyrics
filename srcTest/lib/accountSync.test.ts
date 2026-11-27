import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCOUNT_SYNC_RETRY_DELAYS_MS,
  AccountOfflineError,
  createAccountSync,
  type AccountFirestore,
  type AccountSync,
  type AccountSyncDeps,
  type RemoteSetSnapshot,
  type SetWriteDecision,
} from '../../src/lib/accountSync'
import { SessionStore, type Session, type SessionStorageStore } from '../../src/lib/sessionStore'
import type { SetLinkIdentityStore } from '../../src/lib/setLinkIdentity'
import type { Song } from '../../src/types/song'
import type { SyncedEntry, SyncedSet } from '../../src/lib/setMerge'
import type { SyncStatus } from '../../src/lib/syncStatus'
import type { AccountUser } from '../../src/lib/auth'

const USER = 'uid-a'
const OTHER_USER = 'uid-b'
const DAY_MS = 24 * 60 * 60 * 1000

const song = (name: string, key = 'C'): Song => ({
  id: name,
  title: `Demo ${name}`,
  artist: 'Nobody',
  sourceUrl: `https://x.test/${name}`,
  sourceSite: 'test',
  originalKey: key,
  sections: [],
})

const item = (name: string, over: Record<string, unknown> = {}) => ({
  entryId: `e-${name}`,
  url: `https://x.test/${name}`,
  title: `Demo ${name}`,
  ...over,
})

const hashSong = async (value: Song) => JSON.stringify(value)

interface MemoryKv {
  data: Map<string, unknown>
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
}

function memoryKv(): MemoryKv {
  const data = new Map<string, unknown>()
  return {
    data,
    get: async <T>(key: string) => data.get(key) as T | undefined,
    set: async (key, value) => {
      data.set(key, structuredClone(value))
    },
    del: async (key) => {
      data.delete(key)
    },
  }
}

function memorySessionStore() {
  let stored: Session[] = []
  const identities = new Map<string, unknown>()
  const identityStore: SetLinkIdentityStore = {
    get: async <T>(key: string) => identities.get(key) as T | undefined,
    set: async (key, value) => {
      identities.set(key, value)
    },
    del: async (key) => {
      identities.delete(key)
    },
  }
  const storage = {
    get: async <T>(key: string) =>
      key === 'app_sessions' ? (structuredClone(stored) as T) : undefined,
    set: async (_key: string, value: unknown) => {
      stored = structuredClone(value as Session[])
    },
    del: async () => {
      stored = []
    },
  } as unknown as SessionStorageStore
  return { store: new SessionStore(storage, identityStore), identities }
}

type SongListener = (url: string, value: Song) => void

function memorySongCache() {
  const songs = new Map<string, Song>()
  const listeners = new Set<SongListener>()
  return {
    songs,
    getSong: async (url: string) => songs.get(url) ?? null,
    saveSong: async (value: Song) => {
      songs.set(value.sourceUrl, structuredClone(value))
      for (const listener of [...listeners]) listener(value.sourceUrl, value)
    },
    subscribe: (listener: SongListener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

class FakeFirestore implements AccountFirestore {
  meta = new Map<string, { setCount: number; lastSetId: string }>()
  sets = new Map<string, RemoteSetSnapshot>()
  songs = new Map<string, Song>()
  writes: { setId: string; rev: number; deleted: boolean }[] = []
  transactions = 0
  online = true
  private listeners = new Set<(setId: string, snapshot: RemoteSetSnapshot | null) => void>()

  async getSong(_uid: string, contentHash: string) {
    return this.songs.get(contentHash) ?? null
  }

  async ensureSong(_uid: string, contentHash: string, value: Song) {
    if (!this.songs.has(contentHash)) this.songs.set(contentHash, structuredClone(value))
  }

  async transactSet<T>(
    uid: string,
    setId: string,
    decide: (current: RemoteSetSnapshot | null, setCount: number) => SetWriteDecision<T>,
  ): Promise<T> {
    if (!this.online) throw new Error('The account is offline.')
    this.transactions += 1
    const current = this.sets.get(setId)
    const decision = decide(
      current ? structuredClone(current) : null,
      this.meta.get(uid)?.setCount ?? 0,
    )
    if (decision.write) {
      const write = decision.write
      const doc: RemoteSetSnapshot = {
        rev: write.rev,
        data: write.data,
        songCount: write.songCount,
        updatedAt: write.updatedAt,
        deletedAt: write.deletedAt ?? null,
      }
      this.sets.set(setId, doc)
      this.writes.push({ setId, rev: doc.rev, deleted: doc.deletedAt != null })
      if (decision.countDelta) {
        this.meta.set(uid, {
          setCount: (this.meta.get(uid)?.setCount ?? 0) + decision.countDelta,
          lastSetId: setId,
        })
      }
      // A real listener delivers the write asynchronously, after the lock is released.
      setTimeout(() => {
        const latest = this.sets.get(setId)
        if (latest) this.pushRemote(setId, latest)
      }, 0)
    }
    return decision.outcome
  }

  async listDeletedSets(_uid: string, since: number) {
    return [...this.sets.entries()]
      .filter(([, snapshot]) => snapshot.deletedAt != null && snapshot.deletedAt >= since)
      .sort(([, a], [, b]) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
      .map(([setId, snapshot]) => ({ setId, snapshot: structuredClone(snapshot) }))
  }

  subscribeSets(
    _uid: string,
    onChange: (setId: string, snapshot: RemoteSetSnapshot | null) => void,
  ) {
    this.listeners.add(onChange)
    return () => {
      this.listeners.delete(onChange)
    }
  }

  pushRemote(setId: string, snapshot: RemoteSetSnapshot) {
    this.sets.set(setId, snapshot)
    for (const listener of [...this.listeners]) listener(setId, structuredClone(snapshot))
  }
}

function remoteDoc(synced: SyncedSet, rev: number, over: Partial<RemoteSetSnapshot> = {}) {
  return {
    rev,
    data: JSON.stringify(synced),
    songCount: synced.songs.length,
    updatedAt: rev * 1000,
    ...over,
  }
}

function withReorderedEntryKeys(synced: SyncedSet): SyncedSet {
  return {
    name: synced.name,
    createdAt: synced.createdAt,
    songs: synced.songs.map((entry) => ({
      url: entry.url,
      title: entry.title,
      entryId: entry.entryId,
      contentHash: entry.contentHash,
    })),
  }
}

async function syncedFrom(session: Session, cache: ReturnType<typeof memorySongCache>) {
  const songs: SyncedEntry[] = []
  for (const entry of session.songs) {
    const value = await cache.getSong(entry.url)
    if (!value) throw new Error(`missing song ${entry.url}`)
    songs.push({ ...entry, entryId: entry.entryId!, contentHash: await hashSong(value) })
  }
  return { name: session.name, createdAt: session.createdAt, songs }
}

interface Harness {
  fire: FakeFirestore
  kv: MemoryKv
  store: SessionStore
  cache: ReturnType<typeof memorySongCache>
  deps: AccountSyncDeps
  statuses: SyncStatus[]
  engines: AccountSync[]
  stops: (() => void)[]
  startEngine(): AccountSync
  signIn(uid?: string): Promise<void>
  setOnline(value: boolean): void
  dispose(): void
}

const harnesses: Harness[] = []

function createHarness(fire: FakeFirestore = new FakeFirestore()): Harness {
  const kv = memoryKv()
  const { store } = memorySessionStore()
  const cache = memorySongCache()
  const statuses: SyncStatus[] = []
  const userCallbacks = new Set<(user: AccountUser | null) => void>()
  let online = true

  const deps: AccountSyncDeps = {
    store,
    songCache: cache,
    firestore: fire,
    kv,
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    withLock: async (_name, fn) => fn(),
    onUser: (callback) => {
      userCallbacks.add(callback)
      return () => {
        userCallbacks.delete(callback)
      }
    },
    online: () => online,
    hashSong,
    now: () => 1_000,
    setStatus: (status) => statuses.push(status),
  }

  const harness: Harness = {
    fire,
    kv,
    store,
    cache,
    deps,
    statuses,
    engines: [],
    stops: [],
    startEngine() {
      const engine = createAccountSync(deps)
      harness.stops.push(engine.start())
      harness.engines.push(engine)
      return engine
    },
    async signIn(uid = USER) {
      for (const callback of [...userCallbacks]) {
        callback({ uid, email: null, displayName: null })
      }
      for (const engine of harness.engines) await engine.idle()
    },
    setOnline(value: boolean) {
      online = value
      fire.online = value
    },
    dispose() {
      for (const stop of harness.stops.splice(0)) stop()
      harness.engines.length = 0
    },
  }
  harnesses.push(harness)
  return harness
}

async function seedSession(
  store: SessionStore,
  songs = [item('a')],
  name = 'Sunday set',
  over: Partial<Session> = {},
): Promise<Session> {
  const created = await store.createSession(songs, name)
  const stored = (await store.getSession(created.id))!
  Object.assign(stored, { accountUid: USER, ...over })
  await store.updateSession(stored)
  return (await store.getSession(created.id))!
}

async function advance(engine: AccountSync, ms = 1500) {
  await vi.advanceTimersByTimeAsync(ms)
  await engine.idle()
}

async function seedBase(h: Harness, session: Session, base: SyncedSet) {
  await h.kv.set(`syncBase:${session.id}`, { rev: 1, synced: base })
  h.fire.sets.set(session.id, remoteDoc(base, 1))
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose()
  vi.useRealTimers()
})

describe('account sync', () => {
  it('waits to apply a remote change to the open set until Update set', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()
    engine.setOpenSet(session.id)

    h.fire.pushRemote(session.id, remoteDoc({ ...base, name: 'Sunday set updated' }, 2))
    await engine.idle()

    expect((await h.store.getSession(session.id))?.name).toBe('Sunday set')
    expect(engine.getSyncState().pendingRemote.has(session.id)).toBe(true)

    await engine.applyPendingRemote(session.id)
    await engine.idle()

    expect((await h.store.getSession(session.id))?.name).toBe('Sunday set updated')
    expect(engine.getSyncState().pendingRemote.has(session.id)).toBe(false)
    expect(await h.kv.get(`syncBase:${session.id}`)).toMatchObject({ rev: 2 })
  })

  it('uploads an offline edit when the connection returns', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    h.setOnline(false)
    const engine = h.startEngine()
    await h.signIn()

    await h.store.renameSession(session.id, 'Hall rehearsal')
    await advance(engine)

    expect(h.fire.sets.has(session.id)).toBe(false)
    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([session.id])
    expect(h.statuses.at(-1)).toBe('offline')

    h.setOnline(true)
    await engine.flush()
    await engine.idle()

    expect(h.fire.sets.get(session.id)?.rev).toBe(1)
    expect(JSON.parse(h.fire.sets.get(session.id)!.data).name).toBe('Hall rehearsal')
    expect(h.fire.meta.get(USER)).toEqual({ setCount: 1, lastSetId: session.id })
    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([])
  })

  it('merges edits to different songs without asking', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    h.cache.songs.set(song('b').sourceUrl, song('b'))
    const session = await seedSession(h.store, [item('a'), item('b')])
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()

    const local = (await h.store.getSession(session.id))!
    local.songs[0].targetKey = 'D'
    await h.store.updateSession(local)

    const remote = structuredClone(base)
    remote.songs[1].targetKey = 'E'
    h.fire.pushRemote(session.id, remoteDoc(remote, 2))
    await engine.idle()

    expect(engine.getSyncState().conflicts.size).toBe(0)
    expect((await h.store.getSession(session.id))!.songs.map((entry) => entry.targetKey)).toEqual([
      'D',
      'E',
    ])

    await advance(engine)

    const uploaded = JSON.parse(h.fire.sets.get(session.id)!.data) as SyncedSet
    expect(uploaded.songs.map((entry) => entry.targetKey)).toEqual(['D', 'E'])
    expect(h.fire.sets.get(session.id)!.rev).toBe(3)
  })

  it('makes one conflict when both devices change the same key, and uploads nothing', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()

    const local = (await h.store.getSession(session.id))!
    local.songs[0].targetKey = 'D'
    await h.store.updateSession(local)

    const remote = structuredClone(base)
    remote.songs[0].targetKey = 'E'
    h.fire.pushRemote(session.id, remoteDoc(remote, 2))
    await engine.idle()

    expect(engine.getSyncState().conflicts.size).toBe(1)
    expect(engine.getSyncState().conflicts.get(session.id)?.diffs).toHaveLength(1)
    expect(h.statuses.at(-1)).toBe('needs-choice')
    expect(h.fire.sets.get(session.id)!.rev).toBe(2)
    expect(h.fire.writes).toEqual([])

    await advance(engine, 5000)
    expect(h.fire.sets.get(session.id)!.rev).toBe(2)
    expect((await h.store.getSession(session.id))!.songs[0].targetKey).toBe('D')
  })

  it('keeps the conflict after a reload', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const first = h.startEngine()
    await h.signIn()

    const local = (await h.store.getSession(session.id))!
    local.songs[0].targetKey = 'D'
    await h.store.updateSession(local)
    const remote = structuredClone(base)
    remote.songs[0].targetKey = 'E'
    h.fire.pushRemote(session.id, remoteDoc(remote, 2))
    await first.idle()
    expect(first.getSyncState().conflicts.size).toBe(1)

    h.stops.shift()?.()
    h.engines.length = 0
    const second = h.startEngine()
    await h.signIn()

    expect(second.getSyncState().conflicts.get(session.id)?.diffs).toHaveLength(1)
    expect(h.statuses.at(-1)).toBe('needs-choice')
  })

  it('uploads a new content hash when a used song is saved again', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()

    const refreshed = song('a', 'D')
    await h.cache.saveSong(refreshed)
    await engine.idle()
    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([session.id])
    await advance(engine)

    const uploaded = JSON.parse(h.fire.sets.get(session.id)!.data) as SyncedSet
    expect(uploaded.songs[0].contentHash).toBe(await hashSong(refreshed))
    expect(h.fire.songs.has(await hashSong(refreshed))).toBe(true)
    expect(h.fire.sets.get(session.id)!.rev).toBe(2)
  })

  it('does not re-upload a store event that came from the account', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()

    await h.store.applyRemote({ ...session, name: 'From the account' })
    await engine.idle()
    await advance(engine, 3000)

    expect(h.fire.transactions).toBe(0)
    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([])
  })

  it('claims a set created while signed in and uploads it with the meta change', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const engine = h.startEngine()
    await h.signIn()

    const created = await h.store.createSession([item('a')], 'New Sunday set')
    await engine.idle()
    await advance(engine)

    const stored = (await h.store.getSession(created.id))!
    expect(stored.accountUid).toBe(USER)
    expect(h.fire.sets.get(created.id)?.rev).toBe(1)
    expect(h.fire.meta.get(USER)).toEqual({ setCount: 1, lastSetId: created.id })
    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([])
  })

  it('removes an unchanged set deleted on another device', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()

    h.fire.pushRemote(session.id, remoteDoc(base, 2, { deletedAt: 5_000 }))
    await engine.idle()

    expect(await h.store.getSession(session.id)).toBeNull()
    expect(await h.kv.get(`syncBase:${session.id}`)).toBeUndefined()
    expect(engine.getSyncState().deletedElsewhere.size).toBe(0)
  })

  it('marks an open set deleted on another device instead of removing it', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()
    engine.setOpenSet(session.id)

    h.fire.pushRemote(session.id, remoteDoc(base, 2, { deletedAt: 5_000 }))
    await engine.idle()

    expect(await h.store.getSession(session.id)).not.toBeNull()
    expect(engine.getSyncState().deletedElsewhere.has(session.id)).toBe(true)
  })

  it('does not touch sets owned by another account or a live share', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const other = await seedSession(h.store, [item('a')], 'Other account', {
      accountUid: OTHER_USER,
    })
    const live = await seedSession(h.store, [item('a')], 'Live set', {
      liveSourceId: 'live-1',
      accountUid: undefined,
    })
    const engine = h.startEngine()
    await h.signIn()

    h.fire.pushRemote(other.id, remoteDoc({ name: 'Cloud other', createdAt: 0, songs: [] }, 4))
    h.fire.pushRemote(live.id, remoteDoc({ name: 'Cloud live', createdAt: 0, songs: [] }, 4))
    await engine.idle()

    const liveDoc = await h.store.getSession(live.id)
    expect((await h.store.getSession(other.id))?.name).toBe('Other account')
    expect(liveDoc?.name).toBe('Live set')
    expect(liveDoc?.liveSourceId).toBe('live-1')
    expect(h.fire.transactions).toBe(0)
  })
})

describe('account sync fixes', () => {
  it('ignores entry key order when a remote set matches this device', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const local = await syncedFrom(session, h.cache)
    const reordered = withReorderedEntryKeys(local)
    await seedBase(h, session, reordered)
    const engine = h.startEngine()
    await h.signIn()

    h.fire.pushRemote(session.id, remoteDoc(reordered, 2))
    await engine.idle()

    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([])
    expect(await h.kv.get(`syncBase:${session.id}`)).toMatchObject({ rev: 2 })
    expect(h.fire.transactions).toBe(0)
  })

  it('removes an unchanged set deleted elsewhere despite entry key order', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const local = await syncedFrom(session, h.cache)
    const base = withReorderedEntryKeys(local)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()

    h.fire.pushRemote(session.id, remoteDoc(base, 2, { deletedAt: 5_000 }))
    await engine.idle()

    expect(await h.store.getSession(session.id)).toBeNull()
    expect(engine.getSyncState().deletedElsewhere.has(session.id)).toBe(false)
  })

  it('treats a remote echo of the open set as already synced', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()
    engine.setOpenSet(session.id)

    h.fire.pushRemote(session.id, remoteDoc(base, 2))
    await engine.idle()

    expect(engine.getSyncState().pendingRemote.has(session.id)).toBe(false)
    expect(await h.kv.get(`syncBase:${session.id}`)).toMatchObject({ rev: 2 })
    expect(h.fire.transactions).toBe(0)
  })

  it('takes the account sync lock before applying a remote snapshot', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)

    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let lockName = ''
    h.deps.withLock = async <T>(name: string, fn: () => Promise<T>) => {
      lockName = name
      await gate
      return fn()
    }

    const engine = h.startEngine()
    await h.signIn()
    h.fire.pushRemote(session.id, remoteDoc({ ...base, name: 'Remote rename' }, 2))
    await Promise.resolve()

    expect(lockName).toBe('account-sync')
    expect((await h.store.getSession(session.id))?.name).toBe('Sunday set')

    release()
    await engine.idle()
    expect((await h.store.getSession(session.id))?.name).toBe('Remote rename')
  })

  it('does not merge an upload into a newer cloud set while the set is open', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    h.cache.songs.set(song('b').sourceUrl, song('b'))
    const session = await seedSession(h.store, [item('a'), item('b')])
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()
    engine.setOpenSet(session.id)

    const local = (await h.store.getSession(session.id))!
    local.songs[0].targetKey = 'D'
    await h.store.updateSession(local)

    const remote = structuredClone(base)
    remote.songs[1].targetKey = 'E'
    h.fire.sets.set(session.id, remoteDoc(remote, 2))

    await advance(engine)

    expect(h.fire.sets.get(session.id)!.rev).toBe(2)
    expect(h.fire.writes).toEqual([])
    expect(engine.getSyncState().pendingRemote.has(session.id)).toBe(true)
    const stored = (await h.store.getSession(session.id))!
    expect(stored.songs.map((entry) => entry.targetKey)).toEqual(['D', undefined])
  })

  it('applies a clean merge from a behind upload before uploading it', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    h.cache.songs.set(song('b').sourceUrl, song('b'))
    const session = await seedSession(h.store, [item('a'), item('b')])
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()

    const local = (await h.store.getSession(session.id))!
    local.songs[0].targetKey = 'D'
    await h.store.updateSession(local)

    const remote = structuredClone(base)
    remote.songs[1].targetKey = 'E'
    h.fire.sets.set(session.id, remoteDoc(remote, 2))

    await advance(engine)

    expect((await h.store.getSession(session.id))!.songs.map((entry) => entry.targetKey)).toEqual([
      'D',
      'E',
    ])
    expect(await h.kv.get(`syncBase:${session.id}`)).toMatchObject({ rev: 2 })
    expect(h.fire.sets.get(session.id)!.rev).toBe(2)
    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([session.id])

    await advance(engine)

    expect(h.fire.sets.get(session.id)!.rev).toBe(3)
    const uploaded = JSON.parse(h.fire.sets.get(session.id)!.data) as SyncedSet
    expect(uploaded.songs.map((entry) => entry.targetKey)).toEqual(['D', 'E'])
    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([])
  })

  it('does not upload a merged set that breaks the account limits', async () => {
    const h = createHarness()
    const baseSongs = Array.from({ length: 15 }, (_, index) => item(`base-${index}`))
    const localSongs = Array.from({ length: 15 }, (_, index) => item(`local-${index}`))
    const remoteSongs = Array.from({ length: 15 }, (_, index) => item(`remote-${index}`))
    for (const entry of [...baseSongs, ...localSongs, ...remoteSongs]) {
      h.cache.songs.set(entry.url, song(entry.entryId))
    }
    const session = await seedSession(h.store, baseSongs)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()

    const local = (await h.store.getSession(session.id))!
    local.songs.push(...localSongs)
    await h.store.updateSession(local)

    const remote = structuredClone(base)
    remote.songs.push(
      ...remoteSongs.map((entry) => ({
        ...entry,
        contentHash: JSON.stringify(song(entry.entryId)),
      })),
    )
    h.fire.sets.set(session.id, remoteDoc(remote, 2))

    await advance(engine)

    expect(h.fire.sets.get(session.id)!.rev).toBe(2)
    expect((await h.store.getSession(session.id))!.songs).toHaveLength(45)
    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([session.id])

    await advance(engine)

    expect(h.fire.sets.get(session.id)!.rev).toBe(2)
    expect(h.fire.writes).toEqual([])
    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([])
  })

  it('skips an upload when nothing changed since the base', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()

    await h.store.renameSession(session.id, session.name)
    await advance(engine)

    expect(h.fire.writes).toEqual([])
    expect(h.fire.sets.get(session.id)!.rev).toBe(1)
    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([])
  })

  it('queues an offline delete and tombstones it when the connection returns', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    h.fire.meta.set(USER, { setCount: 1, lastSetId: session.id })
    const engine = h.startEngine()
    await h.signIn()
    h.setOnline(false)

    await h.store.deleteSession(session.id)
    await engine.idle()

    expect(await h.store.getSession(session.id)).toBeNull()
    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([session.id])
    expect(h.fire.sets.get(session.id)!.rev).toBe(1)

    h.setOnline(true)
    await engine.flush()
    await engine.idle()

    const deleted = h.fire.sets.get(session.id)!
    expect(deleted.rev).toBe(2)
    expect(deleted.deletedAt).not.toBeNull()
    expect(h.fire.meta.get(USER)).toEqual({ setCount: 0, lastSetId: session.id })
    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([])
    expect(await h.kv.get(`syncBase:${session.id}`)).toBeUndefined()
  })

  it('does not bring back a set deleted here while offline', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()
    h.setOnline(false)

    await h.store.deleteSession(session.id)
    await engine.idle()
    h.fire.pushRemote(session.id, remoteDoc({ ...base, name: 'Changed elsewhere' }, 2))
    await engine.idle()

    expect(await h.store.getSession(session.id)).toBeNull()
    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([session.id])
  })

  it('clears a conflict when a later snapshot merges cleanly and uploads the merge', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    h.cache.songs.set(song('b').sourceUrl, song('b'))
    const session = await seedSession(h.store, [item('a'), item('b')])
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()

    const local = (await h.store.getSession(session.id))!
    local.songs[0].targetKey = 'D'
    await h.store.updateSession(local)

    const clash = structuredClone(base)
    clash.songs[0].targetKey = 'E'
    h.fire.pushRemote(session.id, remoteDoc(clash, 2))
    await engine.idle()
    expect(engine.getSyncState().conflicts.size).toBe(1)

    const resolved = structuredClone(base)
    resolved.songs[1].targetKey = 'E'
    h.fire.pushRemote(session.id, remoteDoc(resolved, 3))
    await engine.idle()

    expect(engine.getSyncState().conflicts.size).toBe(0)
    expect(h.statuses.at(-1)).not.toBe('needs-choice')

    await advance(engine)

    expect(h.fire.sets.get(session.id)!.rev).toBe(4)
    const uploaded = JSON.parse(h.fire.sets.get(session.id)!.data) as SyncedSet
    expect(uploaded.songs.map((entry) => entry.targetKey)).toEqual(['D', 'E'])
  })

  it('writes nothing when Keep this device meets a tombstoned cloud doc', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()

    const local = (await h.store.getSession(session.id))!
    local.songs[0].targetKey = 'D'
    await h.store.updateSession(local)

    const remote = structuredClone(base)
    remote.songs[0].targetKey = 'E'
    h.fire.pushRemote(session.id, remoteDoc(remote, 2))
    await engine.idle()
    expect(engine.getSyncState().conflicts.size).toBe(1)

    await h.store.removeRemote(session.id)
    h.fire.sets.set(session.id, remoteDoc(remote, 3, { deletedAt: 5_000 }))

    await engine.resolveConflict(session.id, 'keep-local')
    await engine.idle()

    expect(h.fire.sets.get(session.id)!.rev).toBe(3)
    expect(h.fire.writes).toEqual([])
    expect(engine.getSyncState().conflicts.size).toBe(0)
    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([])
  })

  it('saves the base when Update set applies a clean merge', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    h.cache.songs.set(song('b').sourceUrl, song('b'))
    const session = await seedSession(h.store, [item('a'), item('b')])
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()
    engine.setOpenSet(session.id)

    const local = (await h.store.getSession(session.id))!
    local.songs[0].targetKey = 'D'
    await h.store.updateSession(local)

    const remote = structuredClone(base)
    remote.songs[1].targetKey = 'E'
    h.fire.pushRemote(session.id, remoteDoc(remote, 2))
    await engine.idle()
    expect(engine.getSyncState().pendingRemote.has(session.id)).toBe(true)

    await engine.applyPendingRemote(session.id)
    await engine.idle()

    expect((await h.store.getSession(session.id))!.songs.map((entry) => entry.targetKey)).toEqual([
      'D',
      'E',
    ])
    expect(await h.kv.get(`syncBase:${session.id}`)).toMatchObject({ rev: 2 })

    await advance(engine)

    expect(h.fire.sets.get(session.id)!.rev).toBe(3)
    const uploaded = JSON.parse(h.fire.sets.get(session.id)!.data) as SyncedSet
    expect(uploaded.songs.map((entry) => entry.targetKey)).toEqual(['D', 'E'])
  })
})

describe('account sync second fix round', () => {
  it('uploads an edit that arrives while an upload is running', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    await seedBase(h, session, await syncedFrom(session, h.cache))
    h.fire.sets.set(session.id, remoteDoc(await syncedFrom(session, h.cache), 1))

    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let first = true
    const transact = h.fire.transactSet.bind(h.fire)
    h.fire.transactSet = async (uid, setId, decide) => {
      if (first) {
        first = false
        await gate
      }
      return transact(uid, setId, decide)
    }

    const engine = h.startEngine()
    await h.signIn()

    await h.store.renameSession(session.id, 'First edit')
    await vi.advanceTimersByTimeAsync(1500)

    await h.store.renameSession(session.id, 'Second edit')
    await vi.advanceTimersByTimeAsync(1500)
    expect(h.fire.writes).toEqual([])

    release()
    await engine.idle()

    expect(h.fire.sets.get(session.id)?.rev).toBe(3)
    expect((JSON.parse(h.fire.sets.get(session.id)!.data) as SyncedSet).name).toBe('Second edit')
    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([])
  })

  it('saves the base inside the upload lock so a newer snapshot wins', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)

    const tails = new Map<string, Promise<void>>()
    let acquisitions = 0
    let afterFirstCallback = false
    h.deps.withLock = async <T>(name: string, fn: () => Promise<T>) => {
      const previous = tails.get(name) ?? Promise.resolve()
      let release!: () => void
      const done = new Promise<void>((resolve) => {
        release = resolve
      })
      tails.set(name, done)
      await previous
      try {
        return await fn()
      } finally {
        acquisitions += 1
        if (acquisitions === 1) afterFirstCallback = true
        release()
      }
    }

    const baseKey = `syncBase:${session.id}`
    const writeKv = h.kv.set.bind(h.kv)
    let newerBaseSaved!: () => void
    const newerBase = new Promise<void>((resolve) => {
      newerBaseSaved = resolve
    })
    h.kv.set = async (key, value) => {
      const rev = (value as { rev?: number }).rev
      if (key === baseKey && rev === 2 && afterFirstCallback) await newerBase
      await writeKv(key, value)
      if (key === baseKey && rev === 3) newerBaseSaved()
    }

    const transact = h.fire.transactSet.bind(h.fire)
    h.fire.transactSet = async (uid, setId, decide) => {
      const outcome = await transact(uid, setId, decide)
      if ((outcome as { kind?: string })?.kind === 'written') {
        const written = JSON.parse(h.fire.sets.get(setId)!.data) as SyncedSet
        written.songs[0].targetKey = 'E'
        h.fire.pushRemote(setId, remoteDoc(written, 3))
      }
      return outcome
    }

    const engine = h.startEngine()
    await h.signIn()
    await h.store.renameSession(session.id, 'Local rename')
    await advance(engine)

    expect(await h.kv.get(baseKey)).toMatchObject({ rev: 3 })
    expect((await h.store.getSession(session.id))?.name).toBe('Local rename')
  })

  it('takes the account sync lock before Update set applies a remote version', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()
    engine.setOpenSet(session.id)

    h.fire.pushRemote(session.id, remoteDoc({ ...base, name: 'Remote rename' }, 2))
    await engine.idle()
    expect(engine.getSyncState().pendingRemote.has(session.id)).toBe(true)

    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let lockName = ''
    h.deps.withLock = async <T>(name: string, fn: () => Promise<T>) => {
      lockName = name
      await gate
      return fn()
    }

    const applying = engine.applyPendingRemote(session.id)
    await Promise.resolve()

    expect(lockName).toBe('account-sync')
    expect((await h.store.getSession(session.id))?.name).toBe('Sunday set')

    release()
    await applying
    await engine.idle()
    expect((await h.store.getSession(session.id))?.name).toBe('Remote rename')
  })

  it('takes one account sync lock for Use account version', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()

    const local = (await h.store.getSession(session.id))!
    local.songs[0].targetKey = 'D'
    await h.store.updateSession(local)
    const remote = structuredClone(base)
    remote.songs[0].targetKey = 'E'
    h.fire.pushRemote(session.id, remoteDoc(remote, 2))
    await engine.idle()
    expect(engine.getSyncState().conflicts.size).toBe(1)

    let locks = 0
    let depth = 0
    h.deps.withLock = async <T>(_name: string, fn: () => Promise<T>) => {
      if (depth > 0) throw new Error('withLock nested')
      depth += 1
      locks += 1
      try {
        return await fn()
      } finally {
        depth -= 1
      }
    }

    await engine.resolveConflict(session.id, 'use-remote')

    expect(locks).toBe(1)
    expect((await h.store.getSession(session.id))!.songs[0].targetKey).toBe('E')
  })

  it('reads the base from shared storage, not a stale per-tab cache', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()

    // This tab sees rev 1 once, so an in-memory base cache would keep it.
    h.fire.pushRemote(session.id, remoteDoc(base, 1))
    await engine.idle()

    // Another tab saves a newer base to the shared store.
    await h.kv.set(`syncBase:${session.id}`, { rev: 3, synced: { ...base, name: 'Newer' } })

    // A late snapshot with an older rev must not move the base back.
    h.fire.pushRemote(session.id, remoteDoc({ ...base, name: 'Older' }, 2))
    await engine.idle()

    expect(await h.kv.get(`syncBase:${session.id}`)).toMatchObject({ rev: 3 })
    expect((await h.store.getSession(session.id))?.name).toBe('Sunday set')
  })

  it("keeps another tab's queued set when a snapshot saves the outbox", async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    h.fire.meta.set(USER, { setCount: 1, lastSetId: session.id })

    const engine = h.startEngine()
    await h.signIn()

    // The other tab queued an edit; this tab's in-memory outbox is still empty.
    await h.kv.set('syncOutbox', [session.id])

    h.fire.pushRemote('session_cloud', remoteDoc({ name: 'Cloud set', createdAt: 1, songs: [] }, 1))
    await engine.idle()

    expect(await h.kv.get<string[]>('syncOutbox')).toContain(session.id)
  })

  it('tombstones a set deleted while its upload waits for the lock', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    h.fire.meta.set(USER, { setCount: 1, lastSetId: session.id })

    let depth = 0
    h.deps.withLock = async <T>(_name: string, fn: () => Promise<T>) => {
      if (depth > 0) throw new Error('withLock nested')
      depth += 1
      try {
        return await fn()
      } finally {
        depth -= 1
      }
    }

    const engine = h.startEngine()
    await h.signIn()
    await h.store.renameSession(session.id, 'Edited')

    // The set disappears while the upload waits to start.
    const getSession = h.store.getSession.bind(h.store)
    let reads = 0
    h.store.getSession = async (id: string) => {
      reads += 1
      if (reads === 1) {
        await h.store.removeRemote(id)
        return null
      }
      return getSession(id)
    }

    await advance(engine)

    const deleted = h.fire.sets.get(session.id)!
    expect(deleted.rev).toBe(2)
    expect(deleted.deletedAt).not.toBeNull()
    expect(h.fire.meta.get(USER)).toEqual({ setCount: 0, lastSetId: session.id })
    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([])
    expect(await h.kv.get(`syncBase:${session.id}`)).toBeUndefined()
  })

  it('does not resurrect a set deleted elsewhere while Keep this device is open', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()

    const local = (await h.store.getSession(session.id))!
    local.songs[0].targetKey = 'D'
    await h.store.updateSession(local)
    const remote = structuredClone(base)
    remote.songs[0].targetKey = 'E'
    h.fire.pushRemote(session.id, remoteDoc(remote, 2))
    await engine.idle()
    expect(engine.getSyncState().conflicts.size).toBe(1)

    h.fire.sets.set(session.id, remoteDoc(remote, 3, { deletedAt: 5_000 }))

    let depth = 0
    h.deps.withLock = async <T>(_name: string, fn: () => Promise<T>) => {
      if (depth > 0) throw new Error('withLock nested')
      depth += 1
      try {
        return await fn()
      } finally {
        depth -= 1
      }
    }

    await engine.resolveConflict(session.id, 'keep-local')
    await engine.idle()

    expect(h.fire.writes).toEqual([])
    expect(h.fire.sets.get(session.id)!.rev).toBe(3)
    expect(h.fire.sets.get(session.id)!.deletedAt).toBe(5_000)
    expect(engine.getSyncState().conflicts.size).toBe(0)
    expect(engine.getSyncState().deletedElsewhere.has(session.id)).toBe(true)
    expect(await h.store.getSession(session.id)).not.toBeNull()
    expect(await h.kv.get(`syncBase:${session.id}`)).toBeUndefined()
    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([])
  })

  it('restores a set deleted offline when it clashes with a remote edit, and resolves both ways', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    h.fire.meta.set(USER, { setCount: 1, lastSetId: session.id })
    h.fire.sets.set(session.id, remoteDoc(base, 1))

    const engine = h.startEngine()
    await h.signIn()

    // Delete offline while another device edits the set.
    h.setOnline(false)
    await h.store.deleteSession(session.id)
    await engine.idle()

    const remote = structuredClone(base)
    remote.name = 'Edited in cloud'
    h.fire.sets.set(session.id, remoteDoc(remote, 2))

    h.setOnline(true)
    await engine.flush()
    await engine.idle()

    // Restored locally so Home/Session/reload see it, and conflict survives reload.
    expect((await h.store.getSession(session.id))?.name).toBe('Edited in cloud')
    expect(engine.getSyncState().conflicts.get(session.id)?.diffs).toEqual([
      { label: 'Saved set', local: 'Deleted', remote: 'Changed' },
    ])

    h.stops.shift()?.()
    h.engines.length = 0
    const reloaded = h.startEngine()
    await h.signIn()
    expect(reloaded.getSyncState().conflicts.size).toBe(1)

    // Keep this device tombstones the remote set and drops the restored local copy.
    await reloaded.resolveConflict(session.id, 'keep-local')
    await reloaded.idle()
    expect(h.fire.sets.get(session.id)?.deletedAt).not.toBeNull()
    expect(await h.store.getSession(session.id)).toBeNull()
    expect(reloaded.getSyncState().conflicts.size).toBe(0)
  })

  it('skips an upload inside the lock when the set crosses limits while waiting', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const engine = h.startEngine()
    await h.signIn()
    const session = await h.store.createSession([item('a')], 'Sunday set')
    await Promise.resolve()
    await Promise.resolve()

    // Grow past 30 songs after markDirty, simulating a late change before uploadLocked runs.
    const oversized = (await h.store.getSession(session.id))!
    oversized.songs = Array.from({ length: 31 }, (_, i) => item(`s${i}`))
    await h.store.updateSession(oversized)
    await advance(engine)

    expect(h.fire.writes).toEqual([])
  })

  it('preserves another tab outbox entry when markDirty queues a set', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const engine = h.startEngine()
    await h.signIn()

    await h.kv.set('syncOutbox', ['other-tab-set'])
    await h.store.renameSession(session.id, 'Renamed')
    await engine.idle()

    const outbox = await h.kv.get<string[]>('syncOutbox')
    expect(outbox).toContain('other-tab-set')
    expect(outbox).toContain(session.id)
  })

  it('transposes edited chord diffs using the song originalKey and set targetKey', async () => {
    const h = createHarness()
    const baseSong: Song = {
      ...song('a', 'C'),
      sections: [
        {
          type: 'Verse',
          label: 'Verse 1',
          lines: [{ kind: 'lyric', text: 'Morning light', chords: [{ pos: 0, chord: 'C' }] }],
        },
      ],
    }
    h.cache.songs.set(baseSong.sourceUrl, baseSong)
    const session = await seedSession(h.store, [item('a', { targetKey: 'D' })])
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()

    const local = (await h.store.getSession(session.id))!
    local.songs[0].customSections = [
      {
        type: 'Verse',
        label: 'Verse 1',
        lines: [{ kind: 'lyric', text: 'Morning light', chords: [{ pos: 0, chord: 'G' }] }],
      },
    ]
    local.songs[0].customFlow = [0]
    await h.store.updateSession(local)

    const remote = structuredClone(base)
    remote.songs[0].customSections = [
      {
        type: 'Verse',
        label: 'Verse 1',
        lines: [{ kind: 'lyric', text: 'Morning light', chords: [{ pos: 0, chord: 'F' }] }],
      },
    ]
    remote.songs[0].customFlow = [0]
    h.fire.pushRemote(session.id, remoteDoc(remote, 2))
    await engine.idle()

    expect(engine.getSyncState().conflicts.get(session.id)?.diffs).toEqual([
      { label: 'Demo a · Edited sections', local: 'Verse 1: A', remote: 'Verse 1: G' },
    ])
  })

  it('shows only removed sections for simplified section removal conflicts', async () => {
    const h = createHarness()
    const allSections = [
      { type: 'Intro' as const, label: 'Intro', lines: [] },
      { type: 'Verse' as const, label: 'Verse 1', lines: [] },
      { type: 'Chorus' as const, label: 'Chorus', lines: [] },
      { type: 'Bridge' as const, label: 'Bridge', lines: [] },
    ]
    const baseSong: Song = {
      ...song('a', 'C'),
      sections: allSections,
      simplifiedSections: allSections,
    }
    h.cache.songs.set(baseSong.sourceUrl, baseSong)
    const session = await seedSession(h.store, [item('a', { simplified: true })])
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()

    const local = (await h.store.getSession(session.id))!
    local.songs[0].customSimplifiedSections = allSections
    local.songs[0].customSimplifiedFlow = [0, 1, 2]
    await h.store.updateSession(local)

    const remote = structuredClone(base)
    remote.songs[0].customSimplifiedSections = allSections
    remote.songs[0].customSimplifiedFlow = [1, 2, 3]
    h.fire.pushRemote(session.id, remoteDoc(remote, 2))
    await engine.idle()

    expect(engine.getSyncState().conflicts.get(session.id)?.diffs).toEqual([
      { label: 'Demo a · Section clash', local: 'Removed Bridge', remote: 'Removed Intro' },
    ])
  })
})

describe('account sync third fix round', () => {
  it('Finding 1: skips fetchRemoteSongs when an open set is deferred, and fetches on Update set', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const getSongSpy = vi.spyOn(h.fire, 'getSong')

    const engine = h.startEngine()
    await h.signIn()
    engine.setOpenSet(session.id)

    h.cache.songs.set(song('b').sourceUrl, song('b'))
    const remote = await syncedFrom({ ...session, songs: [item('a'), item('b')] }, h.cache)
    const songBHash = remote.songs[1].contentHash!
    h.fire.songs.set(songBHash, song('b'))
    h.cache.songs.delete(song('b').sourceUrl)

    h.fire.pushRemote(session.id, remoteDoc(remote, 2))
    await engine.idle()

    expect(engine.getSyncState().pendingRemote.has(session.id)).toBe(true)
    expect(getSongSpy).not.toHaveBeenCalled()

    await engine.applyPendingRemote(session.id)
    expect(getSongSpy).toHaveBeenCalledWith(USER, songBHash)
  })

  it('Finding 2: refuses to overwrite a newer cloud rev on Keep this device and keeps conflict open', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()

    const local = (await h.store.getSession(session.id))!
    local.songs[0].targetKey = 'D'
    await h.store.updateSession(local)

    const remote2 = structuredClone(base)
    remote2.songs[0].targetKey = 'E'
    h.fire.pushRemote(session.id, remoteDoc(remote2, 2))
    await engine.idle()
    expect(engine.getSyncState().conflicts.size).toBe(1)

    // Another device advances the cloud to rev 3 before the user clicks Keep this device.
    const remote3 = structuredClone(base)
    remote3.songs[0].targetKey = 'F'
    h.fire.sets.set(session.id, remoteDoc(remote3, 3))

    await expect(engine.resolveConflict(session.id, 'keep-local')).rejects.toThrow(
      'This set changed again in the cloud.',
    )
    expect(h.fire.sets.get(session.id)?.rev).toBe(3)
    expect(engine.getSyncState().conflicts.size).toBe(1)
    expect(engine.getSyncState().conflicts.get(session.id)?.diffs).toContainEqual({
      label: 'Demo a · Chosen key',
      local: 'D',
      remote: 'F',
    })
  })

  it('Finding 2: refuses to tombstone a newer cloud rev on localDeleted Keep this device and writes record.remote when current', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    h.fire.sets.set(session.id, remoteDoc(base, 1))
    const engine = h.startEngine()
    await h.signIn()

    h.setOnline(false)
    await h.store.deleteSession(session.id)
    await engine.idle()

    const remote2 = structuredClone(base)
    remote2.name = 'Cloud v2'
    h.fire.sets.set(session.id, remoteDoc(remote2, 2))
    h.setOnline(true)
    await engine.flush()
    await engine.idle()
    expect(engine.getSyncState().conflicts.size).toBe(1)

    // Cloud advances to rev 3 before resolving.
    const remote3 = structuredClone(base)
    remote3.name = 'Cloud v3'
    h.fire.sets.set(session.id, remoteDoc(remote3, 3))
    await expect(engine.resolveConflict(session.id, 'keep-local')).rejects.toThrow(
      'This set changed again in the cloud.',
    )
    expect(h.fire.sets.get(session.id)?.rev).toBe(3)
    expect(h.fire.sets.get(session.id)?.deletedAt).toBeUndefined()
    expect(engine.getSyncState().conflicts.size).toBe(1)

    // Now resolve against rev 3: tombstone writes Cloud v3 (record.remote), not base.synced.
    await engine.resolveConflict(session.id, 'keep-local')
    await engine.idle()
    const tombstoned = h.fire.sets.get(session.id)!
    expect(tombstoned.rev).toBe(4)
    expect(tombstoned.deletedAt).not.toBeNull()
    expect((JSON.parse(tombstoned.data) as SyncedSet).name).toBe('Cloud v3')
  })

  it('Finding 4: serializes online deletes behind an in-flight upload', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    h.fire.sets.set(session.id, remoteDoc(base, 1))

    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let first = true
    const transact = h.fire.transactSet.bind(h.fire)
    h.fire.transactSet = async (uid, setId, decide) => {
      if (first) {
        first = false
        await gate
      }
      return transact(uid, setId, decide)
    }

    const engine = h.startEngine()
    await h.signIn()

    await h.store.renameSession(session.id, 'Edited before delete')
    await vi.advanceTimersByTimeAsync(1500)
    await h.store.deleteSession(session.id)
    expect(h.fire.writes).toEqual([])

    release()
    await engine.idle()

    expect(h.fire.sets.get(session.id)?.rev).toBe(3)
    expect(h.fire.sets.get(session.id)?.deletedAt).not.toBeNull()
    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([])
  })

  it('Finding 5: reports needs-choice status when deletedElsewhere is non-empty', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    const engine = h.startEngine()
    await h.signIn()

    engine.setOpenSet(session.id)
    h.fire.pushRemote(session.id, { ...remoteDoc(base, 2), deletedAt: 1234 })
    await engine.idle()

    expect(engine.getSyncState().deletedElsewhere.has(session.id)).toBe(true)
    expect(h.statuses.at(-1)).toBe('needs-choice')
  })

  it('Finding 6: retries failed uploads with backoff and reports offline while outbox is stuck', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    h.fire.sets.set(session.id, remoteDoc(base, 1))

    let attempts = 0
    const transact = h.fire.transactSet.bind(h.fire)
    h.fire.transactSet = async (uid, setId, decide) => {
      attempts += 1
      if (attempts <= 2) throw new Error('network blip')
      return transact(uid, setId, decide)
    }

    const engine = h.startEngine()
    await h.signIn()
    await h.store.renameSession(session.id, 'Retry me')
    await advance(engine)

    expect(attempts).toBe(1)
    expect(h.statuses.at(-1)).toBe('offline')

    await advance(engine, ACCOUNT_SYNC_RETRY_DELAYS_MS[0])
    expect(attempts).toBe(2)
    expect(h.statuses.at(-1)).toBe('offline')

    await advance(engine, ACCOUNT_SYNC_RETRY_DELAYS_MS[1])
    expect(attempts).toBe(3)
    expect(h.statuses.at(-1)).toBe('synced')
    expect((JSON.parse(h.fire.sets.get(session.id)!.data) as SyncedSet).name).toBe('Retry me')
  })

  it('Finding 8: reconciles local sets edited while signed out on sign-in', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    h.fire.sets.set(session.id, remoteDoc(base, 1))

    // Edited while signed out (engine not started yet)
    await h.store.renameSession(session.id, 'Edited signed out')

    h.startEngine()
    await h.signIn()

    expect(h.fire.sets.get(session.id)?.rev).toBe(2)
    expect((JSON.parse(h.fire.sets.get(session.id)!.data) as SyncedSet).name).toBe(
      'Edited signed out',
    )
    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([])
  })

  it('Finding 9: removeFromOutbox preserves another tab outbox entry on upload completion', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    h.fire.sets.set(session.id, remoteDoc(base, 1))

    const transact = h.fire.transactSet.bind(h.fire)
    h.fire.transactSet = async (uid, setId, decide) => {
      await h.kv.set('syncOutbox', [session.id, 'other-tab-set'])
      return transact(uid, setId, decide)
    }

    const engine = h.startEngine()
    await h.signIn()
    await h.store.renameSession(session.id, 'Tab 1 edit')
    await advance(engine)

    expect(await h.kv.get<string[]>('syncOutbox')).toEqual(['other-tab-set'])
  })

  it('Finding 10: skips ensureSong on no-op upload when local matches base', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    const base = await syncedFrom(session, h.cache)
    await seedBase(h, session, base)
    h.fire.sets.set(session.id, remoteDoc(base, 1))
    await h.kv.set('syncOutbox', [session.id])
    const ensureSpy = vi.spyOn(h.fire, 'ensureSong')

    h.startEngine()
    await h.signIn()

    expect(ensureSpy).not.toHaveBeenCalled()
    expect(h.fire.writes).toEqual([])
    expect(await h.kv.get<string[]>('syncOutbox')).toEqual([])
  })
})

describe('recently deleted', () => {
  const emptySet = (name: string): SyncedSet => ({ name, createdAt: 1, songs: [] })

  it('writes a tombstone when a signed-in set is deleted', async () => {
    const h = createHarness()
    h.cache.songs.set(song('a').sourceUrl, song('a'))
    const session = await seedSession(h.store)
    await seedBase(h, session, await syncedFrom(session, h.cache))
    h.fire.meta.set(USER, { setCount: 1, lastSetId: session.id })
    const engine = h.startEngine()
    await h.signIn()

    await h.store.deleteSession(session.id)
    await engine.idle()

    const doc = h.fire.sets.get(session.id)!
    expect(doc.deletedAt).not.toBeNull()
    expect(doc.rev).toBe(2)
    expect(h.fire.meta.get(USER)).toEqual({ setCount: 0, lastSetId: session.id })
    expect(await h.store.getSession(session.id)).toBeNull()

    const list = await engine.listRecentlyDeleted()
    expect(list.map((row) => row.name)).toEqual([session.name])
  })

  it('lists only the last 30 days, newest first', async () => {
    const h = createHarness()
    const now = 100 * DAY_MS
    h.deps.now = () => now
    h.fire.listDeletedSets = async () => [
      {
        setId: 'old',
        snapshot: remoteDoc(emptySet('Demo Old'), 2, { deletedAt: now - 31 * DAY_MS }),
      },
      {
        setId: 'mid',
        snapshot: remoteDoc(emptySet('Demo Mid'), 2, { deletedAt: now - 29 * DAY_MS }),
      },
      {
        setId: 'new',
        snapshot: remoteDoc(emptySet('Demo New'), 2, { deletedAt: now - 2 * DAY_MS }),
      },
    ]
    const engine = h.startEngine()
    await h.signIn()

    const list = await engine.listRecentlyDeleted()

    expect(list.map((row) => row.setId)).toEqual(['new', 'mid'])
    expect(list[0]).toMatchObject({
      name: 'Demo New',
      songCount: 0,
      deletedAt: now - 2 * DAY_MS,
    })
  })

  it('restores a tombstone with rev + 1 and setCount + 1', async () => {
    const h = createHarness()
    h.fire.sets.set('set-a', remoteDoc(emptySet('Demo Song A'), 2, { deletedAt: 500 }))
    h.fire.meta.set(USER, { setCount: 0, lastSetId: 'set-a' })
    const engine = h.startEngine()
    await h.signIn()

    await expect(engine.restoreDeletedSet('set-a')).resolves.toBe('restored')

    const doc = h.fire.sets.get('set-a')!
    expect(doc.rev).toBe(3)
    expect(doc.deletedAt).toBeNull()
    expect((JSON.parse(doc.data) as SyncedSet).name).toBe('Demo Song A')
    expect(h.fire.meta.get(USER)).toEqual({ setCount: 1, lastSetId: 'set-a' })
  })

  it('refuses to restore when the account already has 100 sets', async () => {
    const h = createHarness()
    h.fire.sets.set('set-a', remoteDoc(emptySet('Demo Song A'), 2, { deletedAt: 500 }))
    h.fire.meta.set(USER, { setCount: 100, lastSetId: 'set-b' })
    const engine = h.startEngine()
    await h.signIn()

    await expect(engine.restoreDeletedSet('set-a')).resolves.toBe('full')
    await expect(engine.restoreDeletedSet('missing')).resolves.toBe('gone')

    expect(h.fire.writes).toEqual([])
    expect(h.fire.sets.get('set-a')).toMatchObject({ rev: 2, deletedAt: 500 })
    expect(h.fire.meta.get(USER)).toEqual({ setCount: 100, lastSetId: 'set-b' })
  })

  it('creates the restored set on a second device through the listener', async () => {
    const h = createHarness()
    const second = createHarness(h.fire)
    h.fire.sets.set('set-a', remoteDoc(emptySet('Demo Song A'), 2, { deletedAt: 500 }))
    h.fire.meta.set(USER, { setCount: 0, lastSetId: 'set-a' })
    const first = h.startEngine()
    const other = second.startEngine()
    await h.signIn()
    await second.signIn()

    await expect(first.restoreDeletedSet('set-a')).resolves.toBe('restored')
    await vi.advanceTimersByTimeAsync(1)
    await first.idle()
    await other.idle()

    const restored = await second.store.getSession('set-a')
    expect(restored?.name).toBe('Demo Song A')
    expect(restored?.accountUid).toBe(USER)
    expect((await h.store.getSession('set-a'))?.name).toBe('Demo Song A')
  })

  it('throws the offline error and writes nothing while offline', async () => {
    const h = createHarness()
    h.fire.sets.set('set-a', remoteDoc(emptySet('Demo Song A'), 2, { deletedAt: 500 }))
    h.fire.meta.set(USER, { setCount: 0, lastSetId: 'set-a' })
    const engine = h.startEngine()
    await h.signIn()
    h.setOnline(false)

    await expect(engine.listRecentlyDeleted()).rejects.toBeInstanceOf(AccountOfflineError)
    await expect(engine.restoreDeletedSet('set-a')).rejects.toBeInstanceOf(AccountOfflineError)

    expect(h.fire.writes).toEqual([])
    expect(h.fire.sets.get('set-a')).toMatchObject({ rev: 2, deletedAt: 500 })
  })

  it('publishes whether a user is signed in', async () => {
    const h = createHarness()
    const engine = h.startEngine()
    expect(engine.getSyncState().signedIn).toBe(false)

    await h.signIn()
    expect(engine.getSyncState().signedIn).toBe(true)

    h.stops[0]()
    expect(engine.getSyncState().signedIn).toBe(false)
  })
})
