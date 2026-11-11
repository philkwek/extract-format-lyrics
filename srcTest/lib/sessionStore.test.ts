import { describe, it, expect, vi } from 'vitest'
import {
  SessionStore,
  MAX_IMPORT_FAILURES,
  sessionPath,
  uniqueSetName,
  type SessionStorageStore,
  type SessionChangeEvent,
} from '../../src/lib/sessionStore'
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
      { url: 'https://pnwchords.com/song-1', title: 'Song 1' },
    ])

    expect(created.songs.length).toBe(1)
    const list = await store.getAllSessions()
    expect(list.length).toBe(1)
    expect(list[0].id).toBe(created.id)

    await store.deleteSession(created.id)
    expect(await store.getAllSessions()).toEqual([])
  })

  it('copies a live set as a normal set with its songs and edits', async () => {
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
    const live = await store.createSession(
      [
        {
          entryId: 'e1',
          url: 'https://x.test/a',
          title: 'A',
          targetKey: 'D',
          simplified: true,
          customFlow: [0, 0],
        },
      ],
      'Sunday',
      { liveSourceId: 'live-1', liveRev: 3, lastHostHash: 'h', importedFromLinkId: 'link-1' },
    )

    const copy = await store.createSetCopy(live)

    expect(copy.id).not.toBe(live.id)
    expect(copy.name).toBe('Sunday - Copy #1')
    expect(copy.songs).toEqual(live.songs)
    expect(copy.songs[0]).not.toBe(live.songs[0])
    expect(copy.songs[0].customFlow).not.toBe(live.songs[0].customFlow)
    expect(copy.liveSourceId).toBeUndefined()
    expect(copy.liveRev).toBeUndefined()
    expect(copy.lastHostHash).toBeUndefined()
    expect(copy.importedFromLinkId).toBeUndefined()
    expect(await store.getAllSessions()).toHaveLength(2)
    expect((await store.getSession(live.id))?.liveSourceId).toBe('live-1')
  })

  it('numbers each copy uniquely', async () => {
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
    const original = await store.createSession([], 'Sunday')

    const first = await store.createSetCopy(original)
    const second = await store.createSetCopy(original)

    expect(first.name).toBe('Sunday - Copy #1')
    expect(second.name).toBe('Sunday - Copy #2')
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
      { url: 'https://pnwchords.com/song-1', title: 'Song 1' },
      { url: 'https://pnwchords.com/song-2', title: 'Song 2' },
      { url: 'https://pnwchords.com/song-3', title: 'Song 3' },
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
      { url: 'https://pnwchords.com/song-1', title: 'Song 1' },
    ])

    const result = await store.addSongsToSession(session.id, [
      { url: 'https://pnwchords.com/song-2', title: 'Song 2' },
      { url: 'https://pnwchords.com/song-3', title: 'Song 3' },
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

    it('stores a link snapshot on create', async () => {
      const { store } = makeStores()
      const snapshot = [{ entryId: 'e1', targetKey: 'G' }]
      const s = await store.createSession([{ url: 'https://x.test/a' }], 'A', {
        linkSnapshot: snapshot,
      })

      expect(s.linkSnapshot).toEqual(snapshot)
      expect((await store.getSession(s.id))?.linkSnapshot).toEqual(snapshot)
    })

    it('keeps an existing link snapshot when updating a session without one', async () => {
      const { store, seed } = makeStores()
      const snapshot = [{ entryId: 'e1', targetKey: 'G' }]
      seed([
        {
          id: 'old',
          createdAt: 1,
          name: 'Old',
          publicId: 'p',
          songs: [],
          linkSnapshot: snapshot,
        },
      ])

      await store.updateSession({ id: 'old', createdAt: 1, name: 'Old', songs: [] })

      expect((await store.getSession('old'))?.linkSnapshot).toEqual(snapshot)
    })

    it('finds the newest copy saved from a link', async () => {
      const { store } = makeStores()
      await store.createSession([], 'First', { importedFromLinkId: 'LINK' })
      const newest = await store.createSession([], 'Second', { importedFromLinkId: 'LINK' })

      expect((await store.findByImportedLinkId('LINK'))?.id).toBe(newest.id)
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
      const s = await store.createSession([{ url: 'https://x.test/a' }])
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

  describe('import failures', () => {
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
        backing,
        seed: (v: unknown) => {
          data = v
        },
      }
    }

    it('does not write or emit when nothing is added', async () => {
      const { store, backing } = makeStores()
      const session = await store.createSession([{ url: 'https://x.test/a' }])
      const events: SessionChangeEvent[] = []
      store.subscribe((e) => events.push(e))
      const writesBefore = backing.set.mock.calls.length

      const result = await store.addSongsToSession(
        session.id,
        [],
        [{ url: 'https://x.test/bad', reason: 'Import failed' }],
      )

      expect(result?.firstNewIndex).toBe(1)
      expect(result?.session.songs).toHaveLength(1)
      expect(result?.session.importFailures).toBeUndefined()
      expect(backing.set).toHaveBeenCalledTimes(writesBefore)
      expect(events).toHaveLength(0)
    })

    it('stores failures and keeps the newest reason for a repeated url', async () => {
      const { store } = makeStores()
      const session = await store.createSession([])

      await store.addSongsToSession(
        session.id,
        [{ url: 'https://x.test/a' }],
        [
          { url: 'https://x.test/bad', reason: 'First try' },
          { url: 'https://x.test/worse', reason: 'Other' },
        ],
      )
      const result = await store.addSongsToSession(
        session.id,
        [{ url: 'https://x.test/b' }],
        [{ url: 'https://x.test/bad', reason: 'Second try' }],
      )

      expect(result?.session.importFailures).toEqual([
        { url: 'https://x.test/worse', reason: 'Other' },
        { url: 'https://x.test/bad', reason: 'Second try' },
      ])
    })

    it('caps failures at the newest 30', async () => {
      const { store } = makeStores()
      const session = await store.createSession([])
      const failures = Array.from({ length: 35 }, (_, i) => ({
        url: `https://x.test/${i}`,
        reason: `Failure ${i}`,
      }))

      const result = await store.addSongsToSession(
        session.id,
        [{ url: 'https://x.test/a' }],
        failures,
      )

      expect(result?.session.importFailures).toHaveLength(MAX_IMPORT_FAILURES)
      const urls = result?.session.importFailures?.map((failure) => failure.url)
      expect(urls?.[0]).toBe('https://x.test/5')
      expect(urls?.[MAX_IMPORT_FAILURES - 1]).toBe('https://x.test/34')
    })

    it('stores failures on create and nothing for an empty list', async () => {
      const { store } = makeStores()
      const withFailures = await store.createSession([], 'A', {
        importFailures: [{ url: 'https://x.test/bad', reason: 'Import failed' }],
      })
      const withoutFailures = await store.createSession([], 'B', { importFailures: [] })

      expect(withFailures.importFailures).toEqual([
        { url: 'https://x.test/bad', reason: 'Import failed' },
      ])
      expect(withoutFailures.importFailures).toBeUndefined()
    })

    it('dismisses failures and persists the removal', async () => {
      const { store } = makeStores()
      const session = await store.createSession([], 'A', {
        importFailures: [{ url: 'https://x.test/bad', reason: 'Import failed' }],
      })

      const dismissed = await store.dismissImportFailures(session.id)

      expect(dismissed?.importFailures).toBeUndefined()
      expect((await store.getSession(session.id))?.importFailures).toBeUndefined()
      expect(await store.dismissImportFailures('missing')).toBeNull()
    })

    it('does not write when there is nothing to dismiss', async () => {
      const { store, backing } = makeStores()
      const session = await store.createSession([])
      const writesBefore = backing.set.mock.calls.length

      const result = await store.dismissImportFailures(session.id)

      expect(result?.id).toBe(session.id)
      expect(backing.set).toHaveBeenCalledTimes(writesBefore)
    })

    it('drops error rows from old sessions and lists their links as failures', async () => {
      const { store, seed } = makeStores()
      seed([
        {
          id: 'old',
          createdAt: 1,
          name: 'Old',
          songs: [
            { url: 'https://example.com/good', status: 'ok', title: 'Good' },
            { url: 'https://example.com/bad', status: 'error', errorMessage: 'Scrape failed' },
            { url: '', status: 'error', errorMessage: 'No link' },
          ],
        },
      ])

      const [loaded] = await store.getAllSessions()

      expect(loaded.songs.map((song) => song.url)).toEqual(['https://example.com/good'])
      expect(loaded.importFailures).toEqual([
        { url: 'https://example.com/bad', reason: 'Scrape failed' },
      ])

      const [again] = await store.getAllSessions()
      expect(again.songs.map((song) => song.url)).toEqual(['https://example.com/good'])
      expect(again.importFailures).toHaveLength(1)
    })

    it('does not carry failures onto a copy', async () => {
      const { store } = makeStores()
      const session = await store.createSession(
        [{ url: 'https://x.test/a' }],
        'Sunday',
        { importFailures: [{ url: 'https://x.test/bad', reason: 'Import failed' }] },
      )

      const copy = await store.createSetCopy(session)

      expect(copy.importFailures).toBeUndefined()
    })

    it('replaces songs, snapshot and failures from a link', async () => {
      const { store } = makeStores()
      const session = await store.createSession(
        [{ entryId: 'old', url: 'https://x.test/old' }],
        'Sunday',
        {
          importedFromLinkId: 'LINK',
          importFailures: [{ url: 'https://x.test/old-bad', reason: 'Old' }],
        },
      )
      const snapshot = [{ entryId: 'e1', targetKey: 'G' }]

      const replaced = await store.replaceSongsFromLink(
        session.id,
        [
          { entryId: 'e1', url: 'https://x.test/new', title: 'New' },
          { url: 'https://x.test/other', title: 'Other' },
        ],
        snapshot,
        [{ url: 'https://x.test/bad', reason: 'Nope' }],
      )

      expect(replaced?.id).toBe(session.id)
      expect(replaced?.name).toBe('Sunday')
      expect(replaced?.publicId).toBe(session.publicId)
      expect(replaced?.importedFromLinkId).toBe('LINK')
      expect(replaced?.songs).toHaveLength(2)
      expect(replaced?.songs[0]).toMatchObject({
        entryId: 'e1',
        url: 'https://x.test/new',
        title: 'New',
      })
      expect(replaced?.songs[1].entryId).toBeTruthy()
      expect(replaced?.linkSnapshot).toEqual(snapshot)
      expect(replaced?.importFailures).toEqual([{ url: 'https://x.test/bad', reason: 'Nope' }])
      expect((await store.getSession(session.id))?.songs[1].title).toBe('Other')
    })

    it('clears failures when a link replacement has none', async () => {
      const { store } = makeStores()
      const session = await store.createSession([], 'A', {
        importFailures: [{ url: 'https://x.test/bad', reason: 'Old' }],
      })

      const replaced = await store.replaceSongsFromLink(session.id, [], [], [])

      expect('importFailures' in replaced!).toBe(false)
      expect('importFailures' in (await store.getSession(session.id))!).toBe(false)
      expect(await store.replaceSongsFromLink('missing', [], [], [])).toBeNull()
    })
  })
})

describe('uniqueSetName', () => {
  it('returns the name when nothing else uses it', () => {
    expect(uniqueSetName('Sunday', [])).toBe('Sunday')
  })

  it('adds the first free copy number', () => {
    expect(uniqueSetName('Sunday', ['Sunday'])).toBe('Sunday - Copy #1')
  })

  it('strips one trailing copy suffix before numbering', () => {
    expect(uniqueSetName('Sunday - Copy #1', ['Sunday', 'Sunday - Copy #1'])).toBe(
      'Sunday - Copy #2',
    )
    expect(uniqueSetName('Sunday - Copy', ['Sunday', 'Sunday - Copy'])).toBe('Sunday - Copy #1')
  })

  it('keeps a copy-style name that does not clash', () => {
    expect(uniqueSetName('Sunday - Copy #2', ['Sunday'])).toBe('Sunday - Copy #2')
  })

  it('fills gaps in the numbering', () => {
    expect(uniqueSetName('Sunday', ['Sunday', 'Sunday - Copy #2'])).toBe('Sunday - Copy #1')
  })
})
