import { describe, expect, it } from 'vitest'
import { stepPresenter } from '../../src/lib/presenterNavigation'
import type { SharedLyricsSong } from '../../src/types/song'

const songs: SharedLyricsSong[] = [
  {
    entryId: 'one',
    title: 'First',
    sections: [
      { label: 'Verse 1', lines: ['a'] },
      { label: 'Verse 2', lines: ['b'] },
    ],
  },
  {
    entryId: 'two',
    title: 'Second',
    sections: [
      { label: 'Chorus', lines: ['c'] },
      { label: 'Bridge', lines: ['d'] },
      { label: 'Outro', lines: ['e'] },
    ],
  },
]

describe('stepPresenter', () => {
  it('moves to the next and previous section inside one song', () => {
    expect(stepPresenter(songs, { entryId: 'one', sectionIndex: 0 }, 'sections', 1)).toEqual({
      entryId: 'one',
      sectionIndex: 1,
    })
    expect(stepPresenter(songs, { entryId: 'one', sectionIndex: 1 }, 'sections', -1)).toEqual({
      entryId: 'one',
      sectionIndex: 0,
    })
  })

  it('wraps from the last section to the next song and back again', () => {
    expect(stepPresenter(songs, { entryId: 'one', sectionIndex: 1 }, 'sections', 1)).toEqual({
      entryId: 'two',
      sectionIndex: 0,
    })
    expect(stepPresenter(songs, { entryId: 'two', sectionIndex: 0 }, 'sections', -1)).toEqual({
      entryId: 'one',
      sectionIndex: 1,
    })
  })

  it('stops at the first and last section of the set', () => {
    expect(stepPresenter(songs, { entryId: 'one', sectionIndex: 0 }, 'sections', -1)).toEqual({
      entryId: 'one',
      sectionIndex: 0,
    })
    expect(stepPresenter(songs, { entryId: 'two', sectionIndex: 2 }, 'sections', 1)).toEqual({
      entryId: 'two',
      sectionIndex: 2,
    })
  })

  it('moves between songs in whole view and stops at the ends', () => {
    expect(stepPresenter(songs, { entryId: 'one', sectionIndex: 0 }, 'whole', 1)).toEqual({
      entryId: 'two',
      sectionIndex: 0,
    })
    expect(stepPresenter(songs, { entryId: 'two', sectionIndex: 0 }, 'whole', -1)).toEqual({
      entryId: 'one',
      sectionIndex: 0,
    })
    expect(stepPresenter(songs, { entryId: 'one', sectionIndex: 0 }, 'whole', -1)).toEqual({
      entryId: 'one',
      sectionIndex: 0,
    })
    expect(stepPresenter(songs, { entryId: 'two', sectionIndex: 0 }, 'whole', 1)).toEqual({
      entryId: 'two',
      sectionIndex: 0,
    })
  })

  it('clamps a stale section index before moving', () => {
    expect(stepPresenter(songs, { entryId: 'one', sectionIndex: 9 }, 'sections', 1)).toEqual({
      entryId: 'two',
      sectionIndex: 0,
    })
    expect(stepPresenter(songs, { entryId: 'one', sectionIndex: 9 }, 'sections', -1)).toEqual({
      entryId: 'one',
      sectionIndex: 0,
    })
  })

  it('falls back to the first song when the current entry is gone', () => {
    expect(stepPresenter(songs, { entryId: 'missing', sectionIndex: 0 }, 'whole', 1)).toEqual({
      entryId: 'two',
      sectionIndex: 0,
    })
  })

  it('keeps the position when there are no songs', () => {
    const position = { entryId: 'one', sectionIndex: 1 }
    expect(stepPresenter([], position, 'sections', 1)).toBe(position)
  })
})
