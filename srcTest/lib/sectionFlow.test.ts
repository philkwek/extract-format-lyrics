import { describe, expect, it } from 'vitest'
import {
  identityFlow,
  moveSectionInFlow,
  removeSectionFromFlow,
  resolveSessionFlow,
} from '../../src/lib/sectionFlow'
import type { SessionSongItem } from '../../src/lib/sessionStore'
import type { Song } from '../../src/types/song'

const song: Song = {
  id: 'song-1',
  title: 'Song',
  artist: 'Artist',
  sourceUrl: 'https://example.test/song',
  sourceSite: 'test',
  originalKey: 'G',
  sections: [{ type: 'Verse', label: 'Verse', lines: [] }],
  flow: [0],
}

function item(overrides: Partial<SessionSongItem> = {}): SessionSongItem {
  return { url: song.sourceUrl, status: 'ok', ...overrides }
}

describe('sectionFlow', () => {
  it('builds identity flow', () => {
    expect(identityFlow(3)).toEqual([0, 1, 2])
  })

  it('uses custom flow before source flow', () => {
    expect(resolveSessionFlow(item({ customFlow: [0, 0] }), song, false, 1)).toEqual([0, 0])
  })

  it('uses identity for legacy custom sections', () => {
    expect(resolveSessionFlow(item({ customSections: song.sections }), song, false, 1)).toEqual([0])
  })

  it('falls back to source flow for untouched songs', () => {
    expect(resolveSessionFlow(item(), song, false, 1)).toEqual([0])
  })

  it('removes every occurrence and shifts later indices', () => {
    expect(removeSectionFromFlow([0, 1, 2, 1], 1)).toEqual([0, 1])
    expect(removeSectionFromFlow([0, 1, 2, 1], 0)).toEqual([0, 1, 0])
  })

  it('remaps flow when a unique section moves', () => {
    expect(moveSectionInFlow([0, 1, 2, 1], 0, 2)).toEqual([2, 0, 1, 0])
    expect(moveSectionInFlow([2, 0, 1, 0], 2, 0)).toEqual([0, 1, 2, 1])
  })
})
