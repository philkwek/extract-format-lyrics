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
})
