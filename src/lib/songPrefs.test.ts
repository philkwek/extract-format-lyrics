// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { getSongPrefs } from './songPrefs'

afterEach(() => localStorage.clear())

describe('getSongPrefs', () => {
  it('falls back to one column for the removed fit preference', () => {
    localStorage.setItem('song_pref:legacy-fit', JSON.stringify({ columns: 'fit', fontSizePx: 16 }))

    expect(getSongPrefs('legacy-fit')).toMatchObject({ columns: 1, fontSizePx: 16 })
  })
})
