import { beforeEach, describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { clearEmulatorData, emulatorDb } from './emulatorDb.js'
import { ShareStore, SHARE_TTL_MS } from '../src/shareStore.js'
import { SharedLyricsStore } from '../src/sharedLyricsStore.js'
import {
  SET_LINK_MIN_WRITE_INTERVAL_MS,
  SET_LINK_TTL_MS,
  SetLinkStore,
  SetLinkThrottledError,
} from '../src/setLinkStore.js'
import { LiveSetError, LiveSetStore, hashLiveSongContent } from '../src/liveSetStore.js'
import { FirestoreChartCacheStore } from '../src/chartCache.js'
import { FirestoreSimplificationCacheStore } from '../src/chartSimplification.js'
import { FirestoreSearchCacheStore } from '../src/search/searchCache.js'
import type { LiveSongContent, Song } from '../src/types.js'

const db = emulatorDb()
const T0 = new Date('2026-01-01T12:00:00Z')
let clock = T0
const now = () => clock
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms)
}

const song: Song = {
  id: 's1',
  title: 'Demo',
  artist: 'Nobody',
  sourceUrl: 'https://tabs.example.com/demo',
  sourceSite: 'example',
  originalKey: 'G',
  sections: [
    {
      type: 'Verse',
      label: 'Verse 1',
      lines: [{ kind: 'lyric', text: 'la la', chords: [{ pos: 0, chord: 'G' }] }],
    },
  ],
  flow: [0],
}

beforeEach(async () => {
  clock = T0
  await clearEmulatorData()
})

describe('ShareStore on Firestore', () => {
  it('saves a set and reads it back with songs in order', async () => {
    const store = new ShareStore(db, now)
    const entry = (n: number) => ({ entryId: `e${n}`, song: { ...song, id: `s${n}`, title: `Song ${n}` } })
    const { id } = await store.create({ v: 2, name: 'Sunday', songs: [entry(2), entry(0), entry(1)] })

    const found = await store.get(id)
    expect(found.kind).toBe('found')
    if (found.kind !== 'found') return
    expect(found.snapshot.songs.map((s) => s.entryId)).toEqual(['e2', 'e0', 'e1'])
    expect(found.expiresAt.getTime()).toBe(T0.getTime() + SHARE_TTL_MS)
  })

  it('reports missing and expired sets', async () => {
    const store = new ShareStore(db, now)
    expect(await store.get('nope')).toEqual({ kind: 'missing' })
    const { id } = await store.create({ v: 2, name: 'Sunday', songs: [{ entryId: 'e', song }] })
    advance(SHARE_TTL_MS + 1000)
    expect(await store.get(id)).toEqual({ kind: 'expired' })
  })
})

describe('SharedLyricsStore on Firestore', () => {
  const lyrics = (titles: string[]) => ({
    v: 1 as const,
    name: 'Sunday',
    songs: titles.map((title, i) => ({
      entryId: `e${i}`,
      title,
      sections: [{ label: 'Verse 1', lines: ['one', 'two'] }],
    })),
  })

  it('round-trips in order and removes leftover songs when the set shrinks', async () => {
    const store = new SharedLyricsStore(db, now)
    const id = 'a'.repeat(64)
    await store.publish(id, lyrics(['A', 'B', 'C']))
    const first = await store.get(id)
    expect(first.kind === 'found' && first.lyrics.songs.map((s) => s.title)).toEqual(['A', 'B', 'C'])

    await store.publish(id, lyrics(['A']))
    const second = await store.get(id)
    expect(second.kind === 'found' && second.lyrics.songs.map((s) => s.title)).toEqual(['A'])
    expect((await db.collection('sharedLyrics').doc(id).collection('songs').get()).size).toBe(1)
  })
})

describe('SetLinkStore on Firestore', () => {
  const payload = {
    v: 1 as const,
    name: 'Sunday',
    songs: [{ entryId: 'e1', url: 'https://tabs.example.com/one' }],
  }

  it('publishes, skips an unchanged write, and throttles a quick second change', async () => {
    const store = new SetLinkStore(db, now)
    const id = 'set-link-id'
    const first = await store.publish(id, payload)
    expect(first.unchanged).toBe(false)
    expect(first.expiresAt.getTime()).toBe(T0.getTime() + SET_LINK_TTL_MS)

    advance(SET_LINK_MIN_WRITE_INTERVAL_MS + 1)
    expect((await store.publish(id, payload)).unchanged).toBe(true)

    const changed = { ...payload, name: 'Evening' }
    advance(1000)
    await store.publish(id, changed).catch(() => undefined)
    advance(1000)
    await expect(store.publish(id, { ...payload, name: 'Third' })).rejects.toBeInstanceOf(
      SetLinkThrottledError,
    )
  })

  it('reports missing links', async () => {
    expect(await new SetLinkStore(db, now).get('nope')).toEqual({ kind: 'missing' })
  })
})

describe('LiveSetStore on Firestore', () => {
  const secret = 'f'.repeat(64)
  const content: LiveSongContent = { song }
  const hash = hashLiveSongContent(content)
  const manifest = { v: 1 as const, name: 'Sunday', entries: [{ entryId: 'e1', contentHash: hash }] }

  it('rejects a manifest whose content was never uploaded', async () => {
    const store = new LiveSetStore(db, now)
    await expect(store.publish('live-1', manifest)).rejects.toMatchObject({ code: 'MISSING_CONTENT' })
  })

  it('publishes, reads back content by hash, and bumps the revision on change', async () => {
    const store = new LiveSetStore(db, now)
    const id = `live-${secret.slice(0, 8)}`
    expect((await store.putSong(id, hash, content)).created).toBe(true)
    expect((await store.putSong(id, hash, content)).created).toBe(false)

    expect((await store.publish(id, manifest)).rev).toBe(1)
    const found = await store.get(id)
    expect(found.kind).toBe('found')
    if (found.kind !== 'found') return
    expect(found.manifest).toMatchObject({ name: 'Sunday', status: 'live', rev: 1 })
    expect(found.contents[hash].song.title).toBe('Demo')

    advance(60_000)
    expect((await store.publish(id, { ...manifest, name: 'Evening' })).rev).toBe(2)
  })

  it('stop ends the share and cuts off its song content', async () => {
    const store = new LiveSetStore(db, now)
    const id = 'live-stop'
    await store.putSong(id, hash, content)
    await store.publish(id, manifest)
    expect(await store.stop(id)).toEqual({ id, rev: 2 })

    const stopped = await store.get(id)
    expect(stopped.kind === 'found' && stopped.manifest.status).toBe('stopped')
    const songDoc = await db.collection('liveSetSongs').doc(`${id}_${hash}`).get()
    expect((songDoc.data()!.expiresAt as Timestamp).toMillis()).toBeLessThanOrEqual(T0.getTime())
    await expect(store.publish(id, manifest)).rejects.toBeInstanceOf(LiveSetError)
  })

  it('reports expired shares', async () => {
    const store = new LiveSetStore(db, now)
    const id = 'live-old'
    await store.putSong(id, hash, content)
    await store.publish(id, manifest)
    advance(SET_LINK_TTL_MS + 1000)
    expect(await store.get(id)).toEqual({ kind: 'expired' })
  })
})

describe('caches on Firestore', () => {
  it('chart cache stores charts and aliases', async () => {
    const cache = new FirestoreChartCacheStore(db)
    const entry = {
      v: 1 as const,
      parserVersion: 'p1',
      canonicalUrl: 'https://tabs.example.com/demo',
      song,
      expiresAt: Date.now() + 60_000,
    }
    expect(await cache.getChart('k')).toBeNull()
    await cache.setChart('k', entry)
    expect(await cache.getChart('k')).toMatchObject(entry)
    await cache.setAlias('a', { v: 1, target: 'k', expiresAt: entry.expiresAt })
    expect((await cache.getAlias('a'))?.target).toBe('k')
  })

  it('simplification cache round-trips', async () => {
    const cache = new FirestoreSimplificationCacheStore(db)
    const entry = {
      v: 1 as const,
      parserVersion: 'p1',
      canonicalUrl: 'https://tabs.example.com/demo',
      status: 'ok' as const,
      simplifiedFlow: [0],
      expiresAt: Date.now() + 60_000,
    }
    expect(await cache.get('k')).toBeNull()
    await cache.set('k', entry)
    expect(await cache.get('k')).toMatchObject(entry)
  })

  it('search cache round-trips', async () => {
    const cache = new FirestoreSearchCacheStore(db)
    const entry = {
      v: 1 as const,
      results: [],
      sources: [],
      partial: false,
      expiresAt: Date.now() + 60_000,
    }
    expect(await cache.get('q')).toBeNull()
    await cache.set('q', entry)
    expect(await cache.get('q')).toMatchObject({ partial: false })
  })
})
