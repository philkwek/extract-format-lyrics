// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clampTextScale,
  loadPresenterDisplay,
  loadPresenterMode,
  resolveAlign,
  savePresenterDisplay,
  savePresenterMode,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  usePresenterDisplay,
  type PresenterDisplay,
} from '../../src/lib/presenterSettings'

const DISPLAY_KEY = 'presenter.display'
const MODE_KEY = 'presenter.mode'

const defaults: PresenterDisplay = {
  textScale: 100,
  align: null,
  caps: false,
  theme: 'dark',
  sectionPosition: 'center',
  lyricsView: 'sections',
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('clampTextScale', () => {
  it('keeps sizes inside the allowed range', () => {
    expect(clampTextScale(TEXT_SCALE_MIN - 10)).toBe(TEXT_SCALE_MIN)
    expect(clampTextScale(TEXT_SCALE_MAX + 10)).toBe(TEXT_SCALE_MAX)
    expect(clampTextScale(120)).toBe(120)
    expect(clampTextScale(Number.NaN)).toBe(defaults.textScale)
  })
})

describe('resolveAlign', () => {
  it('defaults the whole song left and a single section centred', () => {
    expect(resolveAlign(defaults, 'whole')).toBe('left')
    expect(resolveAlign(defaults, 'sections')).toBe('center')
  })

  it('lets an explicit alignment win over the view default', () => {
    expect(resolveAlign({ ...defaults, align: 'center' }, 'whole')).toBe('center')
    expect(resolveAlign({ ...defaults, align: 'left' }, 'sections')).toBe('left')
  })
})

describe('presenter storage', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadPresenterDisplay()).toEqual(defaults)
    expect(loadPresenterMode()).toBeNull()
  })

  it('ignores broken JSON and unknown modes', () => {
    localStorage.setItem(DISPLAY_KEY, '{not json')
    localStorage.setItem(MODE_KEY, 'sometimes')

    expect(loadPresenterDisplay()).toEqual(defaults)
    expect(loadPresenterMode()).toBeNull()
  })

  it('merges valid stored fields over the defaults and drops invalid ones', () => {
    localStorage.setItem(
      DISPLAY_KEY,
      JSON.stringify({
        textScale: 500,
        align: 'center',
        caps: true,
        theme: 'sunset',
        sectionPosition: 'top',
        lyricsView: 'whole',
      }),
    )

    expect(loadPresenterDisplay()).toEqual({
      textScale: TEXT_SCALE_MAX,
      align: 'center',
      caps: true,
      theme: 'dark',
      sectionPosition: 'top',
      lyricsView: 'whole',
    })
  })

  it('round-trips display settings and the mode', () => {
    const display: PresenterDisplay = {
      textScale: 140,
      align: 'left',
      caps: true,
      theme: 'light',
      sectionPosition: 'center',
      lyricsView: 'whole',
    }
    savePresenterDisplay(display)
    savePresenterMode('manual')

    expect(loadPresenterDisplay()).toEqual(display)
    expect(loadPresenterMode()).toBe('manual')
  })
})

describe('usePresenterDisplay', () => {
  it('loads once, saves changes, and follows another window', () => {
    const { result } = renderHook(() => usePresenterDisplay())
    expect(result.current[0]).toEqual(defaults)

    act(() => result.current[1]({ textScale: 130, caps: true }))
    expect(result.current[0]).toMatchObject({ textScale: 130, caps: true })
    expect(JSON.parse(localStorage.getItem(DISPLAY_KEY) ?? '')).toMatchObject({
      textScale: 130,
      caps: true,
    })

    act(() => {
      localStorage.setItem(
        DISPLAY_KEY,
        JSON.stringify({ ...defaults, theme: 'light', lyricsView: 'whole' }),
      )
      window.dispatchEvent(new StorageEvent('storage', { key: DISPLAY_KEY }))
    })

    expect(result.current[0]).toMatchObject({ theme: 'light', lyricsView: 'whole' })
  })

  it('ignores storage events for other keys', () => {
    const { result } = renderHook(() => usePresenterDisplay())
    act(() => result.current[1]({ theme: 'light' }))

    act(() => {
      localStorage.setItem('unrelated', '1')
      window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }))
    })

    expect(result.current[0].theme).toBe('light')
  })
})
