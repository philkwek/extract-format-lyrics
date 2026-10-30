import { describe, expect, it } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import {
  isExpired,
  isSharedSetSnapshot,
  MAX_SHARED_SET_SONGS,
  ShareStore,
  SHARE_TTL_MS,
} from '../src/shareStore.js'
import type { Section, SharedSetSong, Song } from '../src/types.js'

const sections: Section[] = [
  {
    type: 'Verse',
    label: 'Verse 1',
    lines: [
      { kind: 'lyric', text: 'words', chords: [{ pos: 0, chord: 'C' }] },
      { kind: 'chords-only', chords: ['G', 'Am'] },
      { kind: 'tab', raw: 'e|--0--|' },
    ],
  },
]

const song: Song = {
  id: 'song-1',
  title: 'Song',
  artist: 'Artist',
  sourceUrl: 'https://example.test/song',
  sourceSite: 'test',
  originalKey: 'C',
  capo: 2,
  sections,
  flow: [0],
}

const entry: SharedSetSong = {
  entryId: 'entry-1',
  song,
  customSections: sections,
  customFlow: [0],
  customSimplifiedSections: sections,
  customSimplifiedFlow: [0],
  targetKey: 'D',
  padKeyMode: 'custom',
  customPadKey: 'E',
  simplified: true,
}

const snapshot = { v: 2, name: 'Sunday', songs: [entry] }

function snapshotWithEntry(overrides: Record<string, unknown>) {
  return { ...snapshot, songs: [{ ...entry, ...overrides }] }
}

function snapshotWithSong(overrides: Record<string, unknown>) {
  return snapshotWithEntry({ song: { ...song, ...overrides } })
}

function snapshotWithSection(overrides: Record<string, unknown>) {
  return snapshotWithSong({ sections: [{ ...sections[0], ...overrides }] })
}

function snapshotWithLine(line: Record<string, unknown>) {
  return snapshotWithSection({ lines: [line] })
}

describe('shared set validation', () => {
  it('accepts a versioned snapshot with complete song identity', () => {
    expect(isSharedSetSnapshot(snapshot)).toBe(true)
  })

  it('rejects a lyric line without text', () => {
    expect(isSharedSetSnapshot(snapshotWithLine({ kind: 'lyric', chords: [] }))).toBe(false)
  })

  it('rejects a lyric line without chords', () => {
    expect(isSharedSetSnapshot(snapshotWithLine({ kind: 'lyric', text: 'words' }))).toBe(false)
  })

  it('rejects a chords-only line without chords', () => {
    expect(isSharedSetSnapshot(snapshotWithLine({ kind: 'chords-only' }))).toBe(false)
  })

  it('rejects a tab line without raw text', () => {
    expect(isSharedSetSnapshot(snapshotWithLine({ kind: 'tab' }))).toBe(false)
  })

  it('rejects a section without a label', () => {
    expect(isSharedSetSnapshot(snapshotWithSection({ label: undefined }))).toBe(false)
  })

  it('rejects a section without lines', () => {
    expect(isSharedSetSnapshot(snapshotWithSection({ lines: undefined }))).toBe(false)
  })

  it('rejects invalid custom section arrays', () => {
    expect(
      isSharedSetSnapshot(snapshotWithEntry({ customSections: [{ type: 'Verse' }] }))
    ).toBe(false)
    expect(
      isSharedSetSnapshot(
        snapshotWithEntry({ customSimplifiedSections: [{ type: 'Chorus', label: 'x' }] })
      )
    ).toBe(false)
  })

  it('rejects section flow indices outside the section list', () => {
    expect(isSharedSetSnapshot(snapshotWithSong({ flow: [1] }))).toBe(false)
    expect(isSharedSetSnapshot(snapshotWithSong({ flow: [-1] }))).toBe(false)
    expect(isSharedSetSnapshot(snapshotWithSong({ flow: [0.5] }))).toBe(false)
    expect(isSharedSetSnapshot(snapshotWithEntry({ customFlow: [1] }))).toBe(false)
    expect(isSharedSetSnapshot(snapshotWithEntry({ customSimplifiedFlow: [1] }))).toBe(false)
  })

  it('rejects custom flow without custom sections', () => {
    expect(isSharedSetSnapshot(snapshotWithEntry({ customSections: undefined, customFlow: [0] }))).toBe(false)
    expect(
      isSharedSetSnapshot(
        snapshotWithEntry({
          customSimplifiedSections: undefined,
          customSimplifiedFlow: [0],
        })
      )
    ).toBe(false)
  })

  it('rejects a song without a title', () => {
    expect(isSharedSetSnapshot(snapshotWithSong({ title: undefined }))).toBe(false)
  })

  it('rejects a song without an artist', () => {
    expect(isSharedSetSnapshot(snapshotWithSong({ artist: undefined }))).toBe(false)
  })

  it('rejects snapshots above the hard share limit', () => {
    expect(
      isSharedSetSnapshot({
        ...snapshot,
        songs: Array.from({ length: MAX_SHARED_SET_SONGS + 1 }, () => snapshot.songs[0]),
      })
    ).toBe(false)
  })

  it('treats the exact expiry instant as expired', () => {
    const now = new Date('2026-10-11T00:00:00.000Z')
    expect(isExpired(new Date(now), now)).toBe(true)
    expect(isExpired(new Date(now.getTime() + 1), now)).toBe(false)
  })
})

describe('shared set store writes', () => {
  it('gives every song document the same expiresAt as the root', async () => {
    const writes = new Map<string, Record<string, unknown>>()
    const fakeDb = {
      collection: (name: string) => ({
        doc: () => ({
          id: 'set-1',
          path: `${name}/set-1`,
          collection: (sub: string) => ({
            doc: (id: string) => ({ path: `${name}/set-1/${sub}/${id}` }),
          }),
        }),
      }),
      batch: () => ({
        set: (ref: { path: string }, data: Record<string, unknown>) => {
          writes.set(ref.path, data)
        },
        commit: async () => {},
      }),
    }
    const now = new Date('2026-10-11T00:00:00.000Z')
    const store = new ShareStore(fakeDb as unknown as Firestore, () => now)

    const { expiresAt } = await store.create({ ...snapshot, songs: [entry, entry] })

    expect(expiresAt.getTime()).toBe(now.getTime() + SHARE_TTL_MS)
    const root = writes.get('sharedSets/set-1')
    const songs = ['00', '01'].map((n) => writes.get(`sharedSets/set-1/songs/${n}`))
    expect(songs).toHaveLength(2)
    for (const doc of songs) {
      expect(doc?.expiresAt).toBeDefined()
      expect(doc?.expiresAt).toEqual(root?.expiresAt)
    }
  })
})
