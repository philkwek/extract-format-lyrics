import { describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import {
  derivePublicId,
  isSetLinkPayload,
  MAX_SET_LINK_SONGS,
  SET_LINK_TTL_MS,
  SetLinkStore,
  SetLinkThrottledError,
  verifySetLinkSecret,
} from '../src/setLinkStore.js'
import type { SetLinkPayload } from '../src/types.js'

class MockDocRef {
  constructor(public readonly path: string, private readonly store: Map<string, Record<string, unknown>>) {}
  async get() {
    const data = this.store.get(this.path)
    return { exists: data !== undefined, data: () => data }
  }
}

class MockFirestore {
  public readonly data = new Map<string, Record<string, unknown>>()
  public writes = 0
  collection(name: string) {
    return { doc: (id: string) => new MockDocRef(`${name}/${id}`, this.data) }
  }
  async runTransaction<T>(fn: (t: unknown) => Promise<T>): Promise<T> {
    const transaction = {
      get: (ref: MockDocRef) => ref.get(),
      set: (ref: MockDocRef, doc: Record<string, unknown>) => {
        this.writes++
        this.data.set(ref.path, doc)
      },
    }
    return fn(transaction)
  }
}

const secret = 'a'.repeat(64)
const id = derivePublicId(secret)
const payload: SetLinkPayload = {
  v: 1,
  name: ' Sunday ',
  songs: [
    { entryId: 'e1', url: 'https://tabs.example.com/song-1', title: 'One', targetKey: 'G', simplified: true },
    { entryId: 'e2', url: 'http://tabs.example.com/song-2', padKeyMode: 'custom', customPadKey: 'A' },
  ],
}

function makeStore(start = new Date('2026-01-01T12:00:00Z')) {
  const db = new MockFirestore()
  let current = start
  const store = new SetLinkStore(db as unknown as Firestore, () => current)
  return { db, store, advance: (ms: number) => { current = new Date(current.getTime() + ms) } }
}

describe('set link id derivation', () => {
  it('derives a 22 char base64url id matching an independent computation', () => {
    const expected = crypto.createHash('sha256').update(`set-link-v1:${secret}`).digest().subarray(0, 16).toString('base64url')
    expect(id).toBe(expected)
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  it('verifies the right secret and rejects wrong secrets and bad ids', () => {
    expect(verifySetLinkSecret(secret, id)).toBe(true)
    expect(verifySetLinkSecret('b'.repeat(64), id)).toBe(false)
    expect(verifySetLinkSecret(secret, '')).toBe(false)
    expect(verifySetLinkSecret(secret, 'short')).toBe(false)
    expect(verifySetLinkSecret(secret, '!'.repeat(22))).toBe(false)
    expect(verifySetLinkSecret('', id)).toBe(false)
  })
})

describe('isSetLinkPayload', () => {
  it('accepts a valid payload', () => {
    expect(isSetLinkPayload(payload)).toBe(true)
  })

  it('rejects non-http urls', () => {
    for (const url of ['upload://abc', 'javascript:alert(1)', 'not a url', '']) {
      expect(isSetLinkPayload({ ...payload, songs: [{ entryId: 'e', url }] })).toBe(false)
    }
  })

  it('rejects bad shapes and limits', () => {
    const song = { entryId: 'e', url: 'https://a.example.com/x' }
    expect(isSetLinkPayload({ ...payload, v: 2 })).toBe(false)
    expect(isSetLinkPayload({ ...payload, name: '   ' })).toBe(false)
    expect(isSetLinkPayload({ ...payload, name: 'x'.repeat(201) })).toBe(false)
    expect(isSetLinkPayload({ ...payload, songs: [] })).toBe(false)
    expect(isSetLinkPayload({ ...payload, songs: Array.from({ length: MAX_SET_LINK_SONGS + 1 }, () => song) })).toBe(false)
    expect(isSetLinkPayload({ ...payload, songs: Array.from({ length: MAX_SET_LINK_SONGS }, () => song) })).toBe(true)
    expect(isSetLinkPayload({ ...payload, songs: [{ ...song, url: `https://a.example.com/${'x'.repeat(2048)}` }] })).toBe(false)
    expect(isSetLinkPayload({ ...payload, songs: [{ ...song, title: 5 }] })).toBe(false)
    expect(isSetLinkPayload({ ...payload, songs: [{ ...song, targetKey: 'x'.repeat(11) }] })).toBe(false)
    expect(isSetLinkPayload({ ...payload, songs: [{ ...song, simplified: 'yes' }] })).toBe(false)
    expect(isSetLinkPayload({ ...payload, songs: [{ ...song, padKeyMode: 'other' }] })).toBe(false)
  })
})

describe('SetLinkStore', () => {
  it('creates a doc with whitelisted fields and a 7 day expiry', async () => {
    const { db, store } = makeStore()
    const dirty = { ...payload, extra: 1, songs: [{ ...payload.songs[0], secretField: 'x' }] } as unknown as SetLinkPayload
    const result = await store.publish(id, dirty)
    expect(result.unchanged).toBe(false)
    expect(result.expiresAt.getTime()).toBe(new Date('2026-01-01T12:00:00Z').getTime() + SET_LINK_TTL_MS)
    const doc = db.data.get(`setLinks/${id}`)!
    expect(doc.name).toBe('Sunday')
    expect(doc.songs).toEqual([{ entryId: 'e1', url: 'https://tabs.example.com/song-1', title: 'One', targetKey: 'G', simplified: true }])
    expect(doc.writeDay).toBe('2026-01-01')
    expect(doc.writeCount).toBe(1)
    expect(typeof doc.payloadHash).toBe('string')
    expect(Object.keys(doc)).not.toContain('extra')
  })

  it('skips the write when unchanged and expiry is fresh', async () => {
    const { db, store, advance } = makeStore()
    const first = await store.publish(id, payload)
    advance(60_000)
    const second = await store.publish(id, payload)
    expect(second.unchanged).toBe(true)
    expect(second.expiresAt).toEqual(first.expiresAt)
    expect(db.writes).toBe(1)
  })

  it('rewrites an equal payload once lifetime drops to 6 days or less', async () => {
    const { db, store, advance } = makeStore()
    const first = await store.publish(id, payload)
    advance(25 * 60 * 60 * 1000)
    const second = await store.publish(id, payload)
    expect(second.unchanged).toBe(false)
    expect(second.expiresAt.getTime()).toBeGreaterThan(first.expiresAt.getTime())
    expect(db.writes).toBe(2)
    expect(db.data.get(`setLinks/${id}`)!.createdAt).toBeInstanceOf(Timestamp)
  })

  it('throttles changed writes within 5 seconds', async () => {
    const { store, advance } = makeStore()
    await store.publish(id, payload)
    advance(2000)
    const changed = { ...payload, name: 'Other' }
    const err = await store.publish(id, changed).catch((e) => e)
    expect(err).toBeInstanceOf(SetLinkThrottledError)
    expect(err.retryAfterSeconds).toBe(3)
    advance(3000)
    await expect(store.publish(id, changed)).resolves.toMatchObject({ unchanged: false })
  })

  it('enforces the daily write cap and resets on a new UTC day', async () => {
    const { db, store, advance } = makeStore()
    await store.publish(id, payload)
    db.data.get(`setLinks/${id}`)!.writeCount = 200
    advance(10_000)
    const err = await store.publish(id, { ...payload, name: 'Changed' }).catch((e) => e)
    expect(err).toBeInstanceOf(SetLinkThrottledError)
    expect(err.retryAfterSeconds).toBeGreaterThan(0)
    advance(24 * 60 * 60 * 1000)
    await store.publish(id, { ...payload, name: 'Changed' })
    expect(db.data.get(`setLinks/${id}`)!.writeCount).toBe(1)
  })

  it('increments writeCount within a day', async () => {
    const { db, store, advance } = makeStore()
    await store.publish(id, payload)
    advance(10_000)
    await store.publish(id, { ...payload, name: 'Two' })
    expect(db.data.get(`setLinks/${id}`)!.writeCount).toBe(2)
  })

  it('get returns found, expired and missing', async () => {
    const { store, advance } = makeStore()
    expect(await store.get(id)).toEqual({ kind: 'missing' })
    await store.publish(id, payload)
    const found = await store.get(id)
    expect(found.kind).toBe('found')
    if (found.kind === 'found') expect(found.payload.name).toBe('Sunday')
    advance(SET_LINK_TTL_MS + 1)
    expect(await store.get(id)).toEqual({ kind: 'expired' })
  })

  it('get treats an invalid stored payload as missing', async () => {
    const { db, store } = makeStore()
    db.data.set(`setLinks/${id}`, { v: 1, name: 'x', songs: [{ entryId: 'e', url: 'upload://x' }], expiresAt: Timestamp.fromDate(new Date('2027-01-01')) })
    expect(await store.get(id)).toEqual({ kind: 'missing' })
  })
})
