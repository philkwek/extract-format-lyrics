import { describe, it, expect, vi } from 'vitest'
import { SessionStore, type SessionStorageStore } from './sessionStore'

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

  it('formats default session name according to Day Month Time(12hrs) Set format', async () => {
    const { formatDefaultSessionName } = await import('./sessionStore')
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
})

