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
    expect(session.name).toContain('Setlist (')

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
})

