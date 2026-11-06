import { describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import {
  deriveLiveSetId,
  hashLiveSongContent,
  isLiveSetManifestInput,
  LiveSetError,
  LiveSetStore,
  LiveSetThrottledError,
  MAX_LIVE_SET_SONGS,
  verifyLiveSetSecret,
} from '../src/liveSetStore.js'
import { derivePublicId, SET_LINK_TTL_MS } from '../src/setLinkStore.js'
import type { LiveSetEntry, LiveSongContent, Song } from '../src/types.js'

type Doc = Record<string, unknown>

class MockDocRef {
  constructor(
    public readonly path: string,
    public readonly id: string,
    private readonly store: Map<string, Doc>,
    private readonly onWrite: () => void,
  ) {}
  async get() {
    const data = this.store.get(this.path)
    return { exists: data !== undefined, data: () => data, id: this.id, ref: this }
  }
  async delete() {
    this.store.delete(this.path)
  }
  merge(fields: Doc) {
    this.store.set(this.path, { ...this.store.get(this.path), ...fields })
    this.onWrite()
  }
  put(doc: Doc) {
    this.store.set(this.path, doc)
    this.onWrite()
  }
}

class MockFirestore {
  public readonly data = new Map<string, Doc>()
  public writes = 0
  private ref(name: string, id: string) {
    return new MockDocRef(`${name}/${id}`, id, this.data, () => this.writes++)
  }
  collection(name: string) {
    return {
      doc: (id: string) => this.ref(name, id),
      where: (field: string, _op: string, value: unknown) => ({
        get: async () => ({
          docs: [...this.data.entries()]
            .filter(([path, doc]) => path.startsWith(`${name}/`) && doc[field] === value)
            .map(([path, doc]) => ({
              id: path.slice(name.length + 1),
              data: () => doc,
              ref: this.ref(name, path.slice(name.length + 1)),
            })),
        }),
      }),
    }
  }
  async runTransaction<T>(fn: (t: unknown) => Promise<T>): Promise<T> {
    const transaction = {
      get: (ref: MockDocRef) => ref.get(),
      set: (ref: MockDocRef, doc: Doc) => ref.put(doc),
      update: (ref: MockDocRef, fields: Doc) => ref.merge(fields),
    }
    return fn(transaction)
  }
}

const secret = 'd'.repeat(64)
const id = deriveLiveSetId(secret)

const song: Song = {
  id: 's1',
  title: 'Demo',
  artist: 'Nobody',
  sourceUrl: 'https://tabs.example.com/demo',
  sourceSite: 'example',
  originalKey: 'G',
  sections: [{ type: 'Verse', label: 'Verse 1', lines: [{ kind: 'lyric', text: 'la la', chords: [{ pos: 0, chord: 'G' }] }] }],
}
const content: LiveSongContent = { song }
const hash = hashLiveSongContent(content)
const entry = (contentHash: string, entryId = 'e1'): LiveSetEntry => ({ entryId, contentHash })
const manifest = { v: 1 as const, name: ' Sunday ', entries: [entry(hash)] }

function makeStore(start = new Date('2026-01-01T12:00:00Z')) {
  const db = new MockFirestore()
  let current = start
  const store = new LiveSetStore(db as unknown as Firestore, () => current)
  return { db, store, advance: (ms: number) => { current = new Date(current.getTime() + ms) } }
}

describe('live set ids', () => {
  it('uses its own domain separator', () => {
    const expected = crypto.createHash('sha256').update(`live-set-v1:${secret}`).digest().subarray(0, 16).toString('base64url')
    expect(id).toBe(expected)
    expect(id).not.toBe(derivePublicId(secret))
    expect(verifyLiveSetSecret(secret, id)).toBe(true)
    expect(verifyLiveSetSecret(secret, derivePublicId(secret))).toBe(false)
    expect(verifyLiveSetSecret('', id)).toBe(false)
  })
})

describe('hashLiveSongContent', () => {
  it('ignores key order and undefined fields, and changes with content', () => {
    const reordered = { customFlow: undefined, song: { ...song, sections: song.sections } } as LiveSongContent
    expect(hashLiveSongContent(reordered)).toBe(hash)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashLiveSongContent({ song, customFlow: [0] })).not.toBe(hash)
    expect(hashLiveSongContent({ song: { ...song, title: 'Other' } })).not.toBe(hash)
  })

  it('matches an independent canonical JSON computation', () => {
    const json = JSON.stringify({ song: { artist: 'A', id: 'i', originalKey: null, sections: [], sourceSite: 's', sourceUrl: 'u', title: 'T' } })
    const c: LiveSongContent = { song: { id: 'i', title: 'T', artist: 'A', sourceUrl: 'u', sourceSite: 's', originalKey: null, sections: [] } }
    expect(hashLiveSongContent(c)).toBe(crypto.createHash('sha256').update(json).digest('hex'))
  })
})

describe('isLiveSetManifestInput', () => {
  it('accepts a valid manifest and rejects bad shapes', () => {
    expect(isLiveSetManifestInput(manifest)).toBe(true)
    expect(isLiveSetManifestInput({ ...manifest, v: 2 })).toBe(false)
    expect(isLiveSetManifestInput({ ...manifest, name: '  ' })).toBe(false)
    expect(isLiveSetManifestInput({ ...manifest, name: 'x'.repeat(201) })).toBe(false)
    expect(isLiveSetManifestInput({ ...manifest, entries: [] })).toBe(false)
    expect(isLiveSetManifestInput({ ...manifest, entries: [entry('nothex')] })).toBe(false)
    expect(isLiveSetManifestInput({ ...manifest, entries: [{ ...entry(hash), padKeyMode: 'x' }] })).toBe(false)
    const many = (n: number) => Array.from({ length: n }, (_, i) => entry(hash, `e${i}`))
    expect(isLiveSetManifestInput({ ...manifest, entries: many(MAX_LIVE_SET_SONGS) })).toBe(true)
    expect(isLiveSetManifestInput({ ...manifest, entries: many(MAX_LIVE_SET_SONGS + 1) })).toBe(false)
  })
})

describe('LiveSetStore.putSong', () => {
  it('creates a content doc with a 7 day expiry', async () => {
    const { db, store } = makeStore()
    const result = await store.putSong(id, hash, content)
    expect(result.created).toBe(true)
    const doc = db.data.get(`liveSetSongs/${id}_${hash}`)!
    expect(doc.liveId).toBe(id)
    expect(doc.song).toEqual(song)
    expect((doc.expiresAt as Timestamp).toMillis()).toBe(new Date('2026-01-01T12:00:00Z').getTime() + SET_LINK_TTL_MS)
  })

  it('rejects a hash mismatch with 400 and writes nothing', async () => {
    const { db, store } = makeStore()
    const err = await store.putSong(id, 'a'.repeat(64), content).catch((e) => e)
    expect(err).toBeInstanceOf(LiveSetError)
    expect(err.status).toBe(400)
    expect(db.writes).toBe(0)
  })

  it('rejects invalid content with 400 and oversize content with 413', async () => {
    const { store } = makeStore()
    const bad = { song: { ...song, title: 5 } } as unknown as LiveSongContent
    expect(await store.putSong(id, hash, bad).catch((e) => e.status)).toBe(400)
    const big: LiveSongContent = { song: { ...song, title: 'x'.repeat(300 * 1024) } }
    expect(await store.putSong(id, hashLiveSongContent(big), big).catch((e) => e.status)).toBe(413)
  })

  it('only extends the expiry of an existing doc and does not count toward the cap', async () => {
    const { db, store, advance } = makeStore()
    await store.putSong(id, hash, content)
    const countBefore = db.data.get(`liveSets/${id}`)!.writeCount
    advance(60_000)
    const again = await store.putSong(id, hash, content)
    expect(again.created).toBe(false)
    expect(db.data.get(`liveSets/${id}`)!.writeCount).toBe(countBefore)
    const doc = db.data.get(`liveSetSongs/${id}_${hash}`)!
    expect((doc.createdAt as Timestamp).toMillis()).toBe(new Date('2026-01-01T12:00:00Z').getTime())
    expect((doc.expiresAt as Timestamp).toMillis()).toBe(new Date('2026-01-01T12:01:00Z').getTime() + SET_LINK_TTL_MS)
  })

  it('counts new docs toward the daily cap and throttles at the limit', async () => {
    const { db, store } = makeStore()
    await store.putSong(id, hash, content)
    expect(db.data.get(`liveSets/${id}`)!.writeCount).toBe(1)
    db.data.get(`liveSets/${id}`)!.writeCount = 200
    const other: LiveSongContent = { song: { ...song, title: 'Other' } }
    const err = await store.putSong(id, hashLiveSongContent(other), other).catch((e) => e)
    expect(err).toBeInstanceOf(LiveSetThrottledError)
    // an existing doc still goes through at the cap
    await expect(store.putSong(id, hash, content)).resolves.toMatchObject({ created: false })
  })

  it('does not make the placeholder manifest visible to followers or throttle the first manifest', async () => {
    const { store } = makeStore()
    await store.putSong(id, hash, content)
    expect(await store.get(id)).toEqual({ kind: 'missing' })
    await expect(store.publish(id, manifest)).resolves.toMatchObject({ rev: 1, unchanged: false })
  })
})

describe('LiveSetStore.publish', () => {
  it('writes a sanitised manifest, bumps rev and sets a 7 day expiry', async () => {
    const { db, store } = makeStore()
    await store.putSong(id, hash, content)
    const dirty = { ...manifest, extra: 1, entries: [{ ...entry(hash), secretField: 'x' }] }
    const result = await store.publish(id, dirty as typeof manifest)
    expect(result).toMatchObject({ rev: 1, unchanged: false })
    expect(result.expiresAt.getTime()).toBe(new Date('2026-01-01T12:00:00Z').getTime() + SET_LINK_TTL_MS)
    const doc = db.data.get(`liveSets/${id}`)!
    expect(doc.name).toBe('Sunday')
    expect(doc.entries).toEqual([entry(hash)])
    expect(doc.status).toBe('live')
    expect(Object.keys(doc)).not.toContain('extra')
  })

  it('returns 409 MISSING_CONTENT listing the missing hashes', async () => {
    const { db, store } = makeStore()
    await store.putSong(id, hash, content)
    const absent = 'b'.repeat(64)
    const err = await store.publish(id, { ...manifest, entries: [entry(hash), entry(absent, 'e2')] }).catch((e) => e)
    expect(err).toBeInstanceOf(LiveSetError)
    expect(err.status).toBe(409)
    expect(err.code).toBe('MISSING_CONTENT')
    expect(err.extra).toEqual({ missing: [absent] })
    expect(db.data.has(`liveSets/${id}`)).toBe(true) // only the placeholder
    expect(db.data.get(`liveSets/${id}`)!.rev).toBe(0)
  })

  it('skips the write when unchanged and the expiry is fresh', async () => {
    const { db, store, advance } = makeStore()
    await store.putSong(id, hash, content)
    const first = await store.publish(id, manifest)
    const writes = db.writes
    advance(60_000)
    const second = await store.publish(id, manifest)
    expect(second).toMatchObject({ unchanged: true, rev: 1 })
    expect(second.expiresAt).toEqual(first.expiresAt)
    expect(db.writes).toBe(writes)
  })

  it('rewrites an equal manifest after a day and extends the content expiry', async () => {
    const { db, store, advance } = makeStore()
    await store.putSong(id, hash, content)
    await store.publish(id, manifest)
    advance(25 * 60 * 60 * 1000)
    const second = await store.publish(id, manifest)
    expect(second).toMatchObject({ unchanged: false, rev: 2 })
    const song = db.data.get(`liveSetSongs/${id}_${hash}`)!
    expect((song.expiresAt as Timestamp).toDate()).toEqual(second.expiresAt)
  })

  it('throttles changed writes within 5 seconds and enforces the daily cap', async () => {
    const { db, store, advance } = makeStore()
    await store.putSong(id, hash, content)
    await store.publish(id, manifest)
    advance(2000)
    const err = await store.publish(id, { ...manifest, name: 'Other' }).catch((e) => e)
    expect(err).toBeInstanceOf(LiveSetThrottledError)
    expect(err.retryAfterSeconds).toBe(3)
    advance(3000)
    db.data.get(`liveSets/${id}`)!.writeCount = 200
    const capped = await store.publish(id, { ...manifest, name: 'Other' }).catch((e) => e)
    expect(capped).toBeInstanceOf(LiveSetThrottledError)
    advance(24 * 60 * 60 * 1000)
    await store.publish(id, { ...manifest, name: 'Other' })
    expect(db.data.get(`liveSets/${id}`)!.writeCount).toBe(1)
  })

  it('sweeps only unreferenced content older than 10 minutes', async () => {
    const { db, store, advance } = makeStore()
    const make = (title: string): [string, LiveSongContent] => {
      const c = { song: { ...song, title } }
      return [hashLiveSongContent(c), c]
    }
    const [keepHash, keepContent] = make('Keep')
    const [oldHash, oldContent] = make('Old')
    const [newHash, newContent] = make('New')
    await store.putSong(id, keepHash, keepContent)
    await store.putSong(id, oldHash, oldContent)
    advance(11 * 60 * 1000)
    await store.putSong(id, newHash, newContent)
    // another share's old orphan must stay
    db.data.set(`liveSetSongs/other_${oldHash}`, { liveId: 'other', createdAt: Timestamp.fromDate(new Date('2020-01-01')) })
    await store.publish(id, { ...manifest, entries: [entry(keepHash)] })
    expect(db.data.has(`liveSetSongs/${id}_${keepHash}`)).toBe(true)
    expect(db.data.has(`liveSetSongs/${id}_${oldHash}`)).toBe(false)
    expect(db.data.has(`liveSetSongs/${id}_${newHash}`)).toBe(true)
    expect(db.data.has(`liveSetSongs/other_${oldHash}`)).toBe(true)
  })
})

describe('LiveSetStore.stop', () => {
  it('marks the share stopped, clears entries, bumps rev, and blocks later writes with 410', async () => {
    const { db, store, advance } = makeStore()
    await store.putSong(id, hash, content)
    await store.publish(id, manifest)
    advance(10_000)
    expect(await store.stop(id)).toEqual({ id, rev: 2 })
    const doc = db.data.get(`liveSets/${id}`)!
    expect(doc).toMatchObject({ status: 'stopped', entries: [], rev: 2 })
    advance(10_000)
    const err = await store.publish(id, manifest).catch((e) => e)
    expect(err).toBeInstanceOf(LiveSetError)
    expect(err.status).toBe(410)
    expect(err.code).toBe('STOPPED')
    expect(await store.putSong(id, hash, content).catch((e) => e.status)).toBe(410)
    expect(await store.stop(id)).toEqual({ id, rev: 3 })
  })
})

describe('LiveSetStore.get', () => {
  it('returns found with contents, then expired, and missing for unknown ids', async () => {
    const { store, advance } = makeStore()
    expect(await store.get(id)).toEqual({ kind: 'missing' })
    await store.putSong(id, hash, content)
    await store.publish(id, manifest)
    const found = await store.get(id)
    expect(found.kind).toBe('found')
    if (found.kind === 'found') {
      expect(found.manifest).toEqual({ v: 1, name: 'Sunday', entries: [entry(hash)], status: 'live', rev: 1 })
      expect(found.contents).toEqual({ [hash]: content })
    }
    advance(SET_LINK_TTL_MS + 1)
    expect(await store.get(id)).toEqual({ kind: 'expired' })
  })

  it('returns a stopped share with no entries or contents', async () => {
    const { store, advance } = makeStore()
    await store.putSong(id, hash, content)
    await store.publish(id, manifest)
    advance(10_000)
    await store.stop(id)
    const found = await store.get(id)
    expect(found).toMatchObject({ kind: 'found', manifest: { status: 'stopped', entries: [], rev: 2 }, contents: {} })
  })
})

describe('hashLiveSongContent known answer', () => {
  // The browser test (srcTest/lib/liveShareSync.test.ts) pins the same value.
  it('matches the shared fixture hash', () => {
    const fixture = {
      song: {
        id: 'demo',
        title: 'Demo',
        artist: 'Nobody',
        sourceUrl: 'https://example.test/demo',
        sourceSite: 'test',
        originalKey: 'C',
        sections: [
          { type: 'Verse', label: 'Verse 1', lines: [{ kind: 'lyric', text: 'la la la', chords: [{ pos: 3, chord: 'G' }] }] },
        ],
        flow: [0],
      },
      customFlow: [0, 0],
    } as unknown as Parameters<typeof hashLiveSongContent>[0]
    expect(hashLiveSongContent(fixture)).toBe('ead3f44b931987e257aa7b2dda593bc2f1c8c7893eee3ab8571958d682598b80')
  })
})
