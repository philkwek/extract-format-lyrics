import { describe, it, expect, beforeEach } from 'vitest'
import type { Song, Section, SharedLyricsPayload } from '../types/song'
import type { Session } from './sessionStore'
import { buildSharedLyricsPayload } from './exportLyrics'
import {
  getLyricsPublicationIdentity,
  publishLyricsForSession,
  deleteLyricsPublicationIdentity,
} from './lyricsPublishIdentity'
import {
  SharedLyricsStore,
  verifyPublicationSecret,
} from '../../functions/src/sharedLyricsStore'
import { createSharedSetSnapshot, sessionSongsFromSnapshot } from './shareSnapshot'


interface MockDocSnap {
  exists: boolean
  data: () => Record<string, unknown> | undefined
}

interface MockDocReference {
  path: string
  id: string
  get: () => Promise<MockDocSnap>
  collection: (subname: string) => MockCollectionReference
}

interface MockCollectionReference {
  doc: (subId: string) => MockDocReference
  orderBy: () => {
    get: () => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }>
  }
}

interface MockTransactionContext {
  get: (ref: MockDocReference) => Promise<MockDocSnap>
  set: (ref: MockDocReference, val: Record<string, unknown>) => void
  delete: (ref: MockDocReference) => void
}

// In-memory Firestore store for integration testing
class IntegrationFirestore {
  public readonly data = new Map<string, Record<string, unknown>>()

  collection(name: string) {
    return {
      doc: (id: string): MockDocReference => ({
        path: `${name}/${id}`,
        id,
        collection: (subname: string): MockCollectionReference => ({
          doc: (subId: string): MockDocReference => ({
            path: `${name}/${id}/${subname}/${subId}`,
            id: subId,
            get: async () => {
              const val = this.data.get(`${name}/${id}/${subname}/${subId}`)
              return { exists: val !== undefined, data: () => val }
            },
            collection: () => {
              throw new Error('Not implemented')
            },
          }),
          orderBy: () => ({
            get: async () => {
              const prefix = `${name}/${id}/${subname}/`
              const docs: Array<{ id: string; data: () => Record<string, unknown> }> = []
              for (const [key, value] of this.data.entries()) {
                if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
                  docs.push({ id: key.slice(prefix.length), data: () => value })
                }
              }
              docs.sort((a, b) => (Number(a.data().index) || 0) - (Number(b.data().index) || 0))
              return { docs }
            },
          }),
        }),
        get: async () => {
          const val = this.data.get(`${name}/${id}`)
          return { exists: val !== undefined, data: () => val }
        },
      }),
    }
  }

  async runTransaction<T>(fn: (tx: MockTransactionContext) => Promise<T>): Promise<T> {
    const staging = new Map<string, Record<string, unknown>>()
    const deletions = new Set<string>()

    const tx: MockTransactionContext = {
      get: async (ref) => {
        if (deletions.has(ref.path)) return { exists: false, data: () => undefined }
        const current = staging.has(ref.path) ? staging.get(ref.path) : this.data.get(ref.path)
        return { exists: current !== undefined, data: () => current }
      },
      set: (ref, val) => {
        deletions.delete(ref.path)
        staging.set(ref.path, val)
      },
      delete: (ref) => {
        staging.delete(ref.path)
        deletions.add(ref.path)
      },
    }

    const result = await fn(tx)
    for (const p of deletions) this.data.delete(p)
    for (const [p, v] of staging.entries()) this.data.set(p, v)
    return result
  }
}

describe('lyrics sharing integration suite', () => {
  let currentTime: Date
  let mockDb: IntegrationFirestore
  let backendStore: SharedLyricsStore

  // Source song 1
  const song1Sections: Section[] = [
    {
      type: 'Verse',
      label: 'Verse 1',
      lines: [
        { kind: 'lyric', text: 'A mighty fortress is our God', chords: [{ chord: 'C', pos: 0 }] },
        { kind: 'lyric', text: 'A bulwark never failing', chords: [{ chord: 'F', pos: 2 }] },
      ],
    },
    {
      type: 'Chorus',
      label: 'Chorus',
      lines: [
        { kind: 'lyric', text: 'Praise the Lord almighty', chords: [{ chord: 'G', pos: 0 }] },
      ],
    },
    {
      type: 'Verse',
      label: 'Verse 2',
      lines: [
        { kind: 'lyric', text: 'Did we in our own strength confide', chords: [{ chord: 'Am', pos: 0 }] },
      ],
    },
    {
      type: 'Chorus',
      label: 'Chorus Repeat',
      lines: [
        { kind: 'lyric', text: 'Praise the Lord almighty', chords: [{ chord: 'G', pos: 0 }] },
      ],
    },
    {
      type: 'Outro',
      label: 'Outro',
      lines: [{ kind: 'lyric', text: 'Amen', chords: [{ chord: 'C', pos: 0 }] }],
    },
  ]

  const song1: Song = {
    id: 'song-fortress',
    title: 'A Mighty Fortress',
    artist: 'Martin Luther',
    sourceUrl: 'https://example.com/fortress',
    sourceSite: 'example.com',
    originalKey: 'C',
    sections: song1Sections,
  }

  // Source song 2 with simplified arrangement
  const song2NormalSections: Section[] = [
    {
      type: 'Verse',
      label: 'Verse 1',
      lines: [{ kind: 'lyric', text: 'Amazing grace normal', chords: [{ chord: 'Cmaj7', pos: 0 }] }],
    },
  ]
  const song2SimplifiedSections: Section[] = [
    {
      type: 'Intro',
      label: 'Intro',
      lines: [{ kind: 'chords-only', chords: ['C', 'F'] }],
    },
    {
      type: 'Verse',
      label: 'Verse 1',
      lines: [{ kind: 'lyric', text: 'Amazing grace simplified', chords: [{ chord: 'C', pos: 0 }] }],
    },
  ]

  const song2: Song = {
    id: 'song-grace',
    title: 'Amazing Grace',
    artist: 'John Newton',
    sourceUrl: 'https://example.com/grace',
    sourceSite: 'example.com',
    originalKey: 'C',
    sections: song2NormalSections,
    simplifiedSections: song2SimplifiedSections,
  }

  const sessionId = 'integration-session-1'

  beforeEach(async () => {
    currentTime = new Date('2026-10-15T09:00:00.000Z')
    mockDb = new IntegrationFirestore()
    backendStore = new SharedLyricsStore(mockDb as never, () => currentTime)
    await deleteLyricsPublicationIdentity(sessionId)
  })

  // Simulated backend API endpoint implementation
  async function simulateBackendPut(id: string, secret: string, payload: SharedLyricsPayload) {
    if (!secret || !verifyPublicationSecret(secret, id)) {
      throw new Error('403 Forbidden: Invalid authorization secret')
    }
    const res = await backendStore.publish(id, payload)
    return { id: res.id, expiresAt: res.expiresAt.toISOString() }
  }


  it('runs complete lifecycle: publish, identity reuse, updates, expiry renewal, chord-free check, and auth enforcement', async () => {
    // 1. Setup session fixture:
    // Item 1: Song 1 with custom sections: Deleted Outro, moved Chorus to top
    const item1CustomSections: Section[] = [
      song1Sections[1], // Chorus
      song1Sections[0], // Verse 1
      song1Sections[2], // Verse 2
      song1Sections[3], // Chorus repeat (should be deduplicated!)
    ]

    // Item 2: Song 2 with simplified: true
    // Item 3: Duplicate occurrence of Song 1 with DIFFERENT custom edits
    const item3CustomSections: Section[] = [
      {
        type: 'Verse',
        label: 'Acoustic Verse',
        lines: [
          { kind: 'lyric', text: 'Custom acoustic lyrics for reprise', chords: [{ chord: 'G', pos: 0 }] },
        ],
      },
    ]

    const session: Session = {
      id: sessionId,
      createdAt: currentTime.getTime(),
      name: 'Sunday Morning Worship',
      songs: [
        {
          entryId: 'entry-1',
          url: song1.sourceUrl,
          title: song1.title,
          artist: song1.artist,
          status: 'ok',
          customSections: item1CustomSections,
        },
        {
          entryId: 'entry-2',
          url: song2.sourceUrl,
          title: song2.title,
          artist: song2.artist,
          status: 'ok',
          simplified: true,
        },
        {
          entryId: 'entry-3',
          url: song1.sourceUrl,
          title: 'A Mighty Fortress (Reprise)',
          artist: song1.artist,
          status: 'ok',
          customSections: item3CustomSections,
        },
      ],
    }

    const songsData = new Map<string, Song>([
      ['entry-1', song1],
      ['entry-2', song2],
      ['entry-3', song1],
      [song1.sourceUrl, song1],
      [song2.sourceUrl, song2],
    ])

    // --- VERIFY: INITIAL GENERATION ---
    const initialPayload = buildSharedLyricsPayload(session, songsData)
    expect(initialPayload.songs).toHaveLength(3)

    // Deduplication check: repeated chorus in Song 1 was deduplicated
    expect(initialPayload.songs[0].sections).toHaveLength(3) // Chorus, Verse 1, Verse 2
    expect(initialPayload.songs[0].sections[0].label).toBe('Chorus')
    expect(initialPayload.songs[0].sections[1].label).toBe('Verse 1')

    // Simplification check: Song 2 used simplified arrangement with chords-only Intro filtered out
    expect(initialPayload.songs[1].sections).toHaveLength(1)
    expect(initialPayload.songs[1].sections[0]).toEqual({
      label: 'Verse 1',
      lines: ['Amazing grace simplified'],
    })

    // Separate occurrences check: Reprise is kept as distinct occurrence with its own edits
    expect(initialPayload.songs[2].title).toBe('A Mighty Fortress (Reprise)')
    expect(initialPayload.songs[2].sections[0].lines).toEqual(['Custom acoustic lyrics for reprise'])

    // Publish to backend
    const publish1 = await publishLyricsForSession(session.id, initialPayload, simulateBackendPut)
    expect(publish1.id).toBeTruthy()
    expect(publish1.shareUrl).toContain(`/lyrics/${publish1.id}`)

    const pubId = publish1.id

    // --- VERIFY: REOPEN & REUSE URL ---
    const identityAfterPublish = await getLyricsPublicationIdentity(sessionId)
    expect(identityAfterPublish?.publicationId).toBe(pubId)
    expect(identityAfterPublish?.expiresAt).toBe(publish1.expiresAt)

    // --- VERIFY: CHORD-FREE PERSISTENCE AND GET RESPONSE ---
    const lookup1 = await backendStore.get(pubId)
    expect(lookup1.kind).toBe('found')
    if (lookup1.kind === 'found') {
      expect(lookup1.lyrics.name).toBe('Sunday Morning Worship')
      // Ensure no chords in payload
      const json = JSON.stringify(lookup1.lyrics)
      expect(json).not.toContain('chord')
      expect(json).not.toContain('ChordPlacement')
      expect(json).not.toContain('pos')
    }

    // Inspect raw mock database documents
    for (const [key, value] of mockDb.data.entries()) {
      if (key.startsWith(`sharedLyrics/${pubId}`)) {
        expect(value.chords).toBeUndefined()
        expect(value.originalKey).toBeUndefined()
        expect(value.targetKey).toBeUndefined()
        expect(value.sourceUrl).toBeUndefined()
      }
    }

    // --- VERIFY: LOCAL EDITS REMAIN UNPUBLISHED UNTIL UPDATE SUCCEEDS ---
    // Musician edits a line locally in session
    const updatedCustomSections: Section[] = [
      {
        type: 'Verse',
        label: 'Acoustic Verse',
        lines: [
          { kind: 'lyric', text: 'Brand new unpublished local edit line', chords: [] },
        ],
      },
    ]
    session.songs[2].customSections = updatedCustomSections

    // Public link still serves OLD published content!
    const lookupBeforeUpdate = await backendStore.get(pubId)
    if (lookupBeforeUpdate.kind === 'found') {
      expect(lookupBeforeUpdate.lyrics.songs[2].sections[0].lines).toEqual([
        'Custom acoustic lyrics for reprise',
      ])
      expect(lookupBeforeUpdate.lyrics.songs[2].sections[0].lines).not.toContain(
        'Brand new unpublished local edit line'
      )
    }

    // --- VERIFY: UPDATE REPLACES LYRICS AND RESTARTS EXPIRY ---
    // Advance time 2 days
    currentTime = new Date(currentTime.getTime() + 2 * 24 * 3600 * 1000)

    const updatedPayload = buildSharedLyricsPayload(session, songsData)
    const publish2 = await publishLyricsForSession(session.id, updatedPayload, simulateBackendPut)

    // Retains the exact same URL
    expect(publish2.id).toBe(pubId)
    expect(publish2.shareUrl).toBe(publish1.shareUrl)
    // Expiry was reset to 7 days from new time
    expect(new Date(publish2.expiresAt).getTime()).toBe(
      currentTime.getTime() + 7 * 24 * 3600 * 1000
    )

    // Public link now serves new lyrics!
    const lookupAfterUpdate = await backendStore.get(pubId)
    if (lookupAfterUpdate.kind === 'found') {
      expect(lookupAfterUpdate.lyrics.songs[2].sections[0].lines).toEqual([
        'Brand new unpublished local edit line',
      ])
    }

    // --- VERIFY: EXPIRED LINKS WORK AGAIN AFTER REPUBLISHING ---
    // Advance past expiry (8 days later)
    currentTime = new Date(currentTime.getTime() + 8 * 24 * 3600 * 1000)

    const lookupExpired = await backendStore.get(pubId)
    expect(lookupExpired.kind).toBe('expired')

    // Republish expired link
    const publish3 = await publishLyricsForSession(session.id, updatedPayload, simulateBackendPut)
    expect(publish3.id).toBe(pubId)

    // Now valid again!
    const lookupRenewed = await backendStore.get(pubId)
    expect(lookupRenewed.kind).toBe('found')

    // --- VERIFY: UNAUTHORIZED WRITES ARE REJECTED ---
    // Attacker trying to PUT with arbitrary secret or no secret
    await expect(simulateBackendPut(pubId, 'attacker-fake-secret', updatedPayload)).rejects.toThrow(
      '403 Forbidden'
    )
    await expect(simulateBackendPut(pubId, '', updatedPayload)).rejects.toThrow('403 Forbidden')

    // --- VERIFY: EXISTING SHARE SET GENERATION AND IMPORT STILL WORK ---
    const setSnapshot = await createSharedSetSnapshot(session, async (url) => songsData.get(url) ?? null)
    expect(setSnapshot.v).toBe(2)
    expect(setSnapshot.songs).toHaveLength(3)
    // Share set retains full chords and song objects
    expect(setSnapshot.songs[0].song.sections[0].lines[0]).toHaveProperty('chords')

    const importedSongs = sessionSongsFromSnapshot(setSnapshot)
    expect(importedSongs).toHaveLength(3)
    expect(importedSongs[0].customSections).toBeDefined()
    expect(importedSongs[1].simplified).toBe(true)
  })
})
