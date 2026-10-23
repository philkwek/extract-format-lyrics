// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  getDefaultColumns,
  getDefaultSongPrefs,
  getSongPrefs,
  IPAD_BREAKPOINT_PX,
} from '../../src/lib/songPrefs'

afterEach(() => localStorage.clear())

describe('getDefaultColumns', () => {
  it('defaults to 1 column for phone screen widths', () => {
    expect(getDefaultColumns(375)).toBe(1)
    expect(getDefaultColumns(414)).toBe(1)
    expect(getDefaultColumns(IPAD_BREAKPOINT_PX - 1)).toBe(1)
  })

  it('defaults to 3 columns for iPad and above screen widths', () => {
    expect(getDefaultColumns(IPAD_BREAKPOINT_PX)).toBe(3)
    expect(getDefaultColumns(834)).toBe(3)
    expect(getDefaultColumns(1024)).toBe(3)
    expect(getDefaultColumns(1440)).toBe(3)
  })

  it('inspects window.innerWidth when width argument is not provided', () => {
    const originalWidth = window.innerWidth
    try {
      Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true, writable: true })
      expect(getDefaultColumns()).toBe(1)

      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true })
      expect(getDefaultColumns()).toBe(3)
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true, writable: true })
    }
  })
})

describe('getDefaultSongPrefs', () => {
  it('returns default display prefs with responsive columns', () => {
    expect(getDefaultSongPrefs(375)).toEqual({
      columns: 1,
      fontSizePx: 14,
      darkMode: true,
      simplified: false,
      fitToScreen: true,
    })

    expect(getDefaultSongPrefs(1024)).toEqual({
      columns: 3,
      fontSizePx: 14,
      darkMode: true,
      simplified: false,
      fitToScreen: true,
    })
  })
})

describe('getSongPrefs', () => {
  it('returns responsive default columns when opening a new song without saved preferences', () => {
    expect(getSongPrefs('new-song-phone', 390)).toMatchObject({ columns: 1, fontSizePx: 14 })
    expect(getSongPrefs('new-song-ipad', 768)).toMatchObject({ columns: 3, fontSizePx: 14 })
  })

  it('preserves explicitly saved columns regardless of screen width', () => {
    localStorage.setItem('song_pref:saved-2col', JSON.stringify({ columns: 2, fontSizePx: 15 }))

    expect(getSongPrefs('saved-2col', 390)).toMatchObject({ columns: 2, fontSizePx: 15 })
    expect(getSongPrefs('saved-2col', 1024)).toMatchObject({ columns: 2, fontSizePx: 15 })

    localStorage.setItem('song_pref:saved-1col', JSON.stringify({ columns: 1, fontSizePx: 16 }))
    expect(getSongPrefs('saved-1col', 1024)).toMatchObject({ columns: 1, fontSizePx: 16 })
  })

  it('preserves a manually selected fourth column', () => {
    localStorage.setItem('song_pref:saved-4col', JSON.stringify({ columns: 4, fontSizePx: 13 }))

    expect(getSongPrefs('saved-4col', 390)).toMatchObject({ columns: 4, fontSizePx: 13 })
    expect(getSongPrefs('saved-4col', 1024)).toMatchObject({ columns: 4, fontSizePx: 13 })
  })

  it('round-trips the full-screen fit preference', () => {
    localStorage.setItem(
      'song_pref:fit-off',
      JSON.stringify({ columns: 2, fontSizePx: 15, fitToScreen: false })
    )

    expect(getSongPrefs('fit-off', 1024)).toMatchObject({
      columns: 2,
      fontSizePx: 15,
      fitToScreen: false,
    })
  })

  it('migrates the removed fit column mode to the fit preference', () => {
    localStorage.setItem('song_pref:legacy-fit', JSON.stringify({ columns: 'fit', fontSizePx: 16 }))

    expect(getSongPrefs('legacy-fit', 390)).toMatchObject({
      columns: 1,
      fontSizePx: 16,
      fitToScreen: true,
    })
    expect(getSongPrefs('legacy-fit', 1024)).toMatchObject({
      columns: 3,
      fontSizePx: 16,
      fitToScreen: true,
    })
  })
})
