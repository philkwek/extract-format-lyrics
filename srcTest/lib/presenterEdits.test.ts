// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import {
  applyPresenterEdits,
  areSectionsEqual,
  isSectionEdited,
  parseEditedLyricsText,
  resetPresenterEditsStore,
  setPresenterEditsStoreForTesting,
  usePresenterEdits,
  type PresenterEditsStore,
} from '../../src/lib/presenterEdits'
import type { SharedLyricsPayload, SharedLyricsSection } from '../../src/types/song'

function createMemoryStore(): PresenterEditsStore {
  const map = new Map<string, unknown>()
  return {
    get: async <T>(key: string) => map.get(key) as T | undefined,
    set: async (key: string, val: unknown) => {
      map.set(key, val)
    },
    del: async (key: string) => {
      map.delete(key)
    },
  }
}

const hostPayload: SharedLyricsPayload = {
  v: 1,
  name: 'Morning Set',
  songs: [
    {
      entryId: 'entry-1',
      title: 'Morning Light',
      artist: 'Demo Band',
      sections: [
        { label: 'Verse 1', lines: ['Line one', 'Line two'] },
        { label: 'Chorus', lines: ['Chorus line'] },
      ],
    },
    {
      entryId: 'entry-2',
      title: 'Gathered Here',
      sections: [{ label: 'Bridge', lines: ['Bridge line'] }],
    },
  ],
}

beforeEach(() => {
  setPresenterEditsStoreForTesting(createMemoryStore())
})

afterEach(() => {
  cleanup()
  resetPresenterEditsStore()
})

describe('parseEditedLyricsText', () => {
  it('splits on newlines and trims trailing blank lines only', () => {
    expect(parseEditedLyricsText('Line one\r\n\nLine two\n\n  \n')).toEqual([
      'Line one',
      '',
      'Line two',
    ])
  })

  it('returns an empty array when all lines are blank', () => {
    expect(parseEditedLyricsText('\n  \n')).toEqual([])
  })
})

describe('isSectionEdited & areSectionsEqual', () => {
  const base: SharedLyricsSection = { label: 'Verse 1', lines: ['First', 'Second'] }

  it('detects label, line count, and line text differences', () => {
    expect(isSectionEdited(base, { label: 'Verse 1', lines: ['First', 'Second'] })).toBe(false)
    expect(isSectionEdited(base, { label: 'Verse 2', lines: ['First', 'Second'] })).toBe(true)
    expect(isSectionEdited(base, { label: 'Verse 1', lines: ['First'] })).toBe(true)
    expect(isSectionEdited(base, { label: 'Verse 1', lines: ['First', 'Changed'] })).toBe(true)
  })

  it('compares full section arrays', () => {
    expect(
      areSectionsEqual(
        [base, { label: 'Chorus', lines: ['Refrain'] }],
        [
          { label: 'Verse 1', lines: ['First', 'Second'] },
          { label: 'Chorus', lines: ['Refrain'] },
        ],
      ),
    ).toBe(true)
    expect(areSectionsEqual([base], [base, { label: 'Chorus', lines: [] }])).toBe(false)
  })
})

describe('applyPresenterEdits', () => {
  it('merges local edits while keeping host title, artist, and unedited songs', () => {
    const edited = applyPresenterEdits(hostPayload, {
      'entry-1': {
        sections: [
          { label: 'Intro', lines: ['New opening'] },
          { label: 'Chorus', lines: ['Chorus line'] },
        ],
      },
      'removed-entry': {
        sections: [{ label: 'Verse 1', lines: ['Unused'] }],
      },
    })

    expect(edited.songs[0]).toEqual({
      entryId: 'entry-1',
      title: 'Morning Light',
      artist: 'Demo Band',
      sections: [
        { label: 'Intro', lines: ['New opening'] },
        { label: 'Chorus', lines: ['Chorus line'] },
      ],
    })
    expect(edited.songs[1]).toEqual(hostPayload.songs[1])
  })

  it('keeps local edits when the host updates the same song', () => {
    const edits = {
      'entry-1': {
        sections: [
          { label: 'Verse 1', lines: ['Local line'] },
          { label: 'Chorus', lines: ['Chorus line'] },
        ],
      },
    }
    const updatedHost: SharedLyricsPayload = {
      ...hostPayload,
      songs: [
        {
          ...hostPayload.songs[0],
          sections: [
            { label: 'Verse 1', lines: ['Host updated line'] },
            { label: 'Chorus', lines: ['Host updated chorus'] },
          ],
        },
        hostPayload.songs[1],
      ],
    }

    const merged = applyPresenterEdits(updatedHost, edits)
    expect(merged.songs[0].sections).toEqual(edits['entry-1'].sections)
  })
})

describe('usePresenterEdits', () => {
  it('persists edits across remounts, deletes identical saves, and resets', async () => {
    const { result, unmount } = renderHook(() => usePresenterEdits('pub-1'))

    act(() => {
      result.current.saveEdit(
        'entry-1',
        [
          { label: 'Verse 1', lines: ['Edited line'] },
          { label: 'Chorus', lines: ['Chorus line'] },
        ],
        hostPayload.songs[0].sections,
      )
    })

    expect(result.current.isEdited('entry-1')).toBe(true)
    unmount()

    const remounted = renderHook(() => usePresenterEdits('pub-1'))
    await waitFor(() => {
      expect(remounted.result.current.isEdited('entry-1')).toBe(true)
    })

    act(() => {
      remounted.result.current.saveEdit(
        'entry-1',
        [
          { label: 'Verse 1', lines: ['Line one', 'Line two'] },
          { label: 'Chorus', lines: ['Chorus line'] },
        ],
        hostPayload.songs[0].sections,
      )
    })
    expect(remounted.result.current.isEdited('entry-1')).toBe(false)

    act(() => {
      remounted.result.current.saveEdit(
        'entry-1',
        [{ label: 'Verse 1', lines: ['Changed again'] }],
        hostPayload.songs[0].sections,
      )
    })
    expect(remounted.result.current.isEdited('entry-1')).toBe(true)

    act(() => {
      remounted.result.current.resetEdit('entry-1')
    })
    expect(remounted.result.current.isEdited('entry-1')).toBe(false)
  })
})
