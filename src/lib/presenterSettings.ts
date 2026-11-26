import { useCallback, useEffect, useState } from 'react'

export type PresenterMode = 'auto' | 'manual'

export interface PresenterDisplay {
  textScale: number
  align: 'left' | 'center' | null
  caps: boolean
  theme: 'dark' | 'light'
  sectionPosition: 'top' | 'center'
  lyricsView: 'whole' | 'sections'
}

export const TEXT_SCALE_MIN = 50
export const TEXT_SCALE_MAX = 200
export const TEXT_SCALE_STEP = 10

const MODE_KEY = 'presenter.mode'
const DISPLAY_KEY = 'presenter.display'

const DEFAULT_DISPLAY: PresenterDisplay = {
  textScale: 100,
  align: null,
  caps: false,
  theme: 'dark',
  sectionPosition: 'center',
  lyricsView: 'sections',
}

export function clampTextScale(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_DISPLAY.textScale
  return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, n))
}

/** Null alignment follows the view: one section is centred, the whole song reads left. */
export function resolveAlign(
  display: PresenterDisplay,
  view: 'whole' | 'sections',
): 'left' | 'center' {
  if (display.align) return display.align
  return view === 'sections' ? 'center' : 'left'
}

export function loadPresenterMode(): PresenterMode | null {
  try {
    const stored = localStorage.getItem(MODE_KEY)
    return stored === 'auto' || stored === 'manual' ? stored : null
  } catch {
    return null
  }
}

export function savePresenterMode(mode: PresenterMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    // Private mode or a full quota: the mode just is not remembered.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function loadPresenterDisplay(): PresenterDisplay {
  try {
    const raw = localStorage.getItem(DISPLAY_KEY)
    if (!raw) return { ...DEFAULT_DISPLAY }
    const stored: unknown = JSON.parse(raw)
    if (!isRecord(stored)) return { ...DEFAULT_DISPLAY }
    return {
      textScale:
        typeof stored.textScale === 'number' && Number.isFinite(stored.textScale)
          ? clampTextScale(stored.textScale)
          : DEFAULT_DISPLAY.textScale,
      align:
        stored.align === 'left' || stored.align === 'center'
          ? stored.align
          : DEFAULT_DISPLAY.align,
      caps: typeof stored.caps === 'boolean' ? stored.caps : DEFAULT_DISPLAY.caps,
      theme:
        stored.theme === 'dark' || stored.theme === 'light'
          ? stored.theme
          : DEFAULT_DISPLAY.theme,
      sectionPosition:
        stored.sectionPosition === 'top' || stored.sectionPosition === 'center'
          ? stored.sectionPosition
          : DEFAULT_DISPLAY.sectionPosition,
      lyricsView:
        stored.lyricsView === 'whole' || stored.lyricsView === 'sections'
          ? stored.lyricsView
          : DEFAULT_DISPLAY.lyricsView,
    }
  } catch {
    return { ...DEFAULT_DISPLAY }
  }
}

export function savePresenterDisplay(display: PresenterDisplay): void {
  try {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(display))
  } catch {
    // Private mode or a full quota: the settings just are not remembered.
  }
}

export function usePresenterDisplay(): [
  PresenterDisplay,
  (patch: Partial<PresenterDisplay>) => void,
] {
  const [display, setDisplay] = useState<PresenterDisplay>(loadPresenterDisplay)

  const update = useCallback((patch: Partial<PresenterDisplay>) => {
    setDisplay((previous) => ({ ...previous, ...patch }))
  }, [])

  useEffect(() => {
    savePresenterDisplay(display)
  }, [display])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== DISPLAY_KEY && event.key !== null) return
      setDisplay(loadPresenterDisplay())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return [display, update]
}
