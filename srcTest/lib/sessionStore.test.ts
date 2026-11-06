import { describe, it, expect, vi } from 'vitest'
import { SessionStore, sessionPath, type SessionStorageStore, type SessionChangeEvent } from '../../src/lib/sessionStore'
import type { SetLinkIdentityStore } from '../../src/lib/setLinkIdentity'

describe('SessionStore', () => {
  it('creates, lists, and deletes sessions', async () => {
    let storedData: unknown = null
    const fakeStore = {
      get: vi.fn(async () => storedData),
      set: vi.fn(async (_: unknown, val: unknown) => {
        storedData = val
      }),
      del: vi.fn(async () => {
        storedData = null
      }),
    }

    const store = new SessionStore(fakeStore as unknown as SessionStorageStore)
    expect(await store.getAllSessions()).toEqual([])

    const created = await store.createSession([
      { url: 'https://pnwchords.com/song-1', status: 'ok', title: 'Song 1' },
    ])

    expect(created.songs.length).toBe(1)
    const list = await store.getAllSessions()
    expect(list.length).toBe(1)
    expect(list[0].id).toBe(created.id)

    await store.deleteSession(created.id)
    expect(await store.getAllSessions()).toEqual([])
  })

  it('renames an existing session', async () => {
    let storedData: unknown = null
    const fakeStore = {
      get: vi.fn(async () => storedData),
      set: vi.fn(async (_: unknown, val: unknown) => {
        storedData = val
      }),
      del: vi.fn(async () => {
        storedData = null
      }),
    }

    const store = new SessionStore(fakeStore as unknown as SessionStorageStore)
    const session = await store.createSession([])
    expect(session.name).toMatch(/\d+ [A-Z][a-z]+ \d+(?:am|pm) Set/)

    await store.renameSession(session.id, 'Sunday Morning Service')
    const updated = await store.getSession(session.id)
    expect(updated?.name).toBe('Sunday Morning Service')
  })

  it('reorders songs in a session and persists new order', async () => {
    let storedData: unknown = null
    const fakeStore = {
      get: vi.fn(async () => storedData),
      set: vi.fn(async (_: unknown, val: unknown) => {
        storedData = val
      }),
      del: vi.fn(async () => {
        storedData = null
      }),
    }

    const store = new SessionStore(fakeStore as unknown as SessionStorageStore)
    const session = await store.createSession([
      { url: 'https://pnwchords.com/song-1', status: 'ok', title: 'Song 1' },
      { url: 'https://pnwchords.com/song-2', status: 'ok', title: 'Song 2' },
      { url: 'https://pnwchords.com/song-3', status: 'ok', title: 'Song 3' },
    ])

    // Reorder Song 1 (index 0) to end (index 2)
    const reordered = await store.reorderSongsInSession(session.id, 0, 2)
    expect(reordered?.songs.map((s) => s.title)).toEqual(['Song 2', 'Song 3', 'Song 1'])

    // Verify persisted in store
    const retrieved = await store.getSession(session.id)
    expect(retrieved?.songs.map((s) => s.title)).toEqual(['Song 2', 'Song 3', 'Song 1'])

    // Reorder Song 1 back to middle (from 2 to 1)
    const reorderedAgain = await store.reorderSongsInSession(session.id, 2, 1)
    expect(reorderedAgain?.songs.map((s) => s.title)).toEqual(['Song 2', 'Song 1', 'Song 3'])
  })

  it('appends multiple songs in one write and reports the first new index', async () => {
    let storedData: unknown = null
    const fakeStore = {
      get: vi.fn(async () => storedData),
      set: vi.fn(async (_: unknown, val: unknown) => {
        storedData = val
      }),
      del: vi.fn(async () => {
        storedData = null
      }),
    }

    const store = new SessionStore(fakeStore as unknown as SessionStorageStore)
    const session = await store.createSession([
      { url: 'https://pnwchords.com/song-1', status: 'ok', title: 'Song 1' },
    ])

    const result = await store.addSongsToSession(session.id, [
      { url: 'https://pnwchords.com/song-2', status: 'ok', title: 'Song 2' },
      { url: 'https://pnwchords.com/song-3', status: 'ok', title: 'Song 3' },
    ])

    expect(result?.firstNewIndex).toBe(1)
    expect(result?.session.songs.map((song) => song.title)).toEqual(['Song 1', 'Song 2', 'Song 3'])
    expect(fakeStore.set).toHaveBeenCalledTimes(2)
  })

  it('formats default session name according to Day Month Time(12hrs) Set format', async () => {
    const { formatDefaultSessionName } = await import('../../src/lib/sessionStore')
    // 9 October 2026, 21:30 (9:30pm)
    const d1 = new Date(2026, 9, 9, 21, 30)
    expect(formatDefaultSessionName(d1)).toBe('9 October 930pm Set')

    // 9 October 2026, 21:00 (9pm)
    const d2 = new Date(2026, 9, 9, 21, 0)
    expect(formatDefaultSessionName(d2)).toBe('9 October 9pm Set')

    // 9 October 2026, 09:05 (9:05am)
    const d3 = new Date(2026, 9, 9, 9, 5)
    expect(formatDefaultSessionName(d3)).toBe('9 October 905am Set')

    // 25 December 2026, 12:00 (12pm)
    const d4 = new Date(2026, 11, 25, 12, 0)
    expect(formatDefaultSessionName(d4)).toBe('25 December 12pm Set')

    // 1 January 2027, 00:00 (12am)
    const d5 = new Date(2027, 0, 1, 0, 0)
    expect(formatDefaultSessionName(d5)).toBe('1 January 12am Set')
  })

  describe('public ids and events', () => {
    function makeStores() {
      let data: unknown = null
      const ids = new Map<string, unknown>()
      const backing = {
        get: vi.fn(async () => data),
        set: vi.fn(async (_: unknown, v: unknown) => {
          data = v
        }),
        del: vi.fn(async () => {
          data = null
        }),
      }
      const identityStore: SetLinkIdentityStore = {
        get: async <T>(k: string) => ids.get(k) as T | undefined,
        set: async (k, v) => void ids.set(k, v),
        del: async (k) => void ids.delete(k),
      }
      return {
        store: new SessionStore(backing as unknown as SessionStorageStore, identityStore),
        seed: (v: unknown) => {
          data = v
        },
        ids,
      }
    }

    it('assigns a publicId on create and looks up by id or publicId', async () => {
      const { store, ids } = makeStores()
      const s = await store.createSession([], 'A', { importedFromLinkId: 'LINK' })
      expect(s.publicId).toMatch(/^[A-Za-z0-9_-]{22}$/)
      expect(s.importedFromLinkId).toBe('LINK')
      expect(ids.has(s.id)).toBe(true)
      expect((await store.getSession(s.publicId!))?.id).toBe(s.id)
      expect((await store.getSession(s.id))?.id).toBe(s.id)
      expect((await store.findByImportedLinkId('LINK'))?.id).toBe(s.id)
      expect(await store.findByImportedLinkId('nope')).toBeNull()
      expect(sessionPath(s)).toBe(`/session/${s.publicId}`)
      expect(sessionPath({ id: 'x' })).toBe('/session/x')
    })

    it('migrates sessions without publicId silently', async () => {
      const { store, seed } = makeStores()
      seed([{ id: 'old', createdAt: 1, name: 'Old', songs: [] }])
      const events = vi.fn()
      store.subscribe(events)
      const list = await store.getAllSessions()
      expect(list[0].publicId).toMatch(/^[A-Za-z0-9_-]{22}$/)
      expect((await store.getAllSessions())[0].publicId).toBe(list[0].publicId)
      expect(events).not.toHaveBeenCalled()
    })

    it('emits created, updated and deleted and supports unsubscribe', async () => {
      const { store } = makeStores()
      const events: SessionChangeEvent[] = []
      const off = store.subscribe((e) => events.push(e))
      const s = await store.createSession([{ url: 'https://x.test/a', status: 'ok' }])
      await store.renameSession(s.id, 'New')
      await store.reorderSongsInSession(s.id, 0, 0)
      await store.deleteSession(s.id)
      expect(events.map((e) => e.type)).toEqual(['created', 'updated', 'deleted'])
      expect(events[1].session?.name).toBe('New')
      off()
      await store.createSession([])
      expect(events).toHaveLength(3)
    })
  })
})
