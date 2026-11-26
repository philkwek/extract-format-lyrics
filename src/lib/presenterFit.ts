import { useCallback, useLayoutEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Line, Section, SharedLyricsSong } from '../types/song'

/** Turns a shared lyrics song into the shape `partitionSections` expects. */
export function toPresenterSections(song: SharedLyricsSong): Section[] {
  return song.sections.map((section) => ({
    type: 'Other',
    label: section.label,
    lines: section.lines.map((text): Line => ({ kind: 'lyric', text, chords: [] })),
  }))
}

export interface SearchLargestFitOptions {
  minFontPx: number
  maxFontPx: number
  maxColumns: number
}

export interface PresenterFitResult {
  fontPx: number
  columns: number
  fitsOnScreen: boolean
}

function largestFittingFont(
  fits: (fontPx: number, columns: number) => boolean,
  columns: number,
  minFontPx: number,
  maxFontPx: number,
): number | null {
  let low = minFontPx
  let high = maxFontPx
  let best: number | null = null
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (fits(mid, columns)) {
      best = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return best
}

/**
 * Finds the largest font that fits, trying each column count in turn. A column
 * count that fits at the maximum font wins straight away; otherwise the largest
 * font overall wins, and an equal font keeps the narrower layout.
 */
export function searchLargestFit(
  fits: (fontPx: number, columns: number) => boolean,
  { minFontPx, maxFontPx, maxColumns }: SearchLargestFitOptions,
): PresenterFitResult {
  let bestFont = -Infinity
  let bestColumns = maxColumns

  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const fontPx = largestFittingFont(fits, columns, minFontPx, maxFontPx)
    if (fontPx === null) continue
    if (fontPx === maxFontPx) return { fontPx, columns, fitsOnScreen: true }
    if (fontPx > bestFont) {
      bestFont = fontPx
      bestColumns = columns
    }
  }

  if (bestFont === -Infinity) {
    return { fontPx: minFontPx, columns: maxColumns, fitsOnScreen: false }
  }
  return { fontPx: bestFont, columns: bestColumns, fitsOnScreen: true }
}

export interface ResolveScaledFitOptions extends SearchLargestFitOptions {
  textScale: number
}

/**
 * Scales the auto-fitted font size by `textScale` (%) so `-` / `+` always
 * resize the displayed lyrics, even when a long song already hit its fit ceiling.
 */
export function resolveScaledFit(
  fits: (fontPx: number, columns: number) => boolean,
  { minFontPx, maxFontPx, maxColumns, textScale }: ResolveScaledFitOptions,
): PresenterFitResult {
  const base = searchLargestFit(fits, { minFontPx, maxFontPx, maxColumns })
  if (textScale === 100) return base

  if (textScale < 100) {
    const fontPx = Math.max(minFontPx, Math.round(base.fontPx * (textScale / 100)))
    return {
      fontPx,
      columns: base.columns,
      fitsOnScreen: base.fitsOnScreen ? true : fits(fontPx, base.columns),
    }
  }

  const scaledMax = Math.round(maxFontPx * (textScale / 100))
  const targetFont = Math.min(scaledMax, Math.round(base.fontPx * (textScale / 100)))

  if (base.fontPx === maxFontPx) {
    const grown = searchLargestFit(fits, { minFontPx, maxFontPx: scaledMax, maxColumns })
    if (grown.fontPx >= targetFont) return grown
    return {
      fontPx: targetFont,
      columns: grown.columns,
      fitsOnScreen: fits(targetFont, grown.columns),
    }
  }

  return {
    fontPx: targetFont,
    columns: base.columns,
    fitsOnScreen: fits(targetFont, base.columns),
  }
}

export interface UsePresenterFitOptions {
  enabled: boolean
  contentKey: unknown
  maxFontPx: number
  minFontPx: number
  maxColumns: number
  textScale?: number
}

export interface PresenterFit {
  containerRef: (node: HTMLDivElement | null) => void
  fontPx: number
  columns: number
  fitsOnScreen: boolean
}

interface FitLayout {
  fontPx: number
  columns: number
  fitsOnScreen: boolean
}

/** Window resizes are coalesced so dragging a window edge refits once. */
const RESIZE_DEBOUNCE_MS = 150

/**
 * Fits presenter content to its container. Runs only on real inputs (enabled,
 * content, font bounds, column count, or a debounced resize) and never from its
 * own state, so measuring cannot start another measurement.
 */
export function usePresenterFit({
  enabled,
  contentKey,
  maxFontPx,
  minFontPx,
  maxColumns,
  textScale = 100,
}: UsePresenterFitOptions): PresenterFit {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [resizeTick, setResizeTick] = useState(0)
  const [layout, setLayout] = useState<FitLayout>(() => ({
    fontPx: maxFontPx,
    columns: 1,
    fitsOnScreen: true,
  }))

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainer(node)
  }, [])

  useLayoutEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const onResize = () => {
      clearTimeout(timer)
      timer = setTimeout(() => setResizeTick((tick) => tick + 1), RESIZE_DEBOUNCE_MS)
    }
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [enabled])

  useLayoutEffect(() => {
    if (!enabled || !container) return

    let cancelled = false
    queueMicrotask(() => {
      if (cancelled || !container.clientWidth || !container.clientHeight) return

      const fits = (fontPx: number, columns: number) => {
        flushSync(() =>
          setLayout((previous) =>
            previous.fontPx === fontPx && previous.columns === columns
              ? previous
              : { fontPx, columns, fitsOnScreen: true },
          ),
        )
        const content = container.querySelector<HTMLElement>('[data-presenter-content]')
        if (!content) return false
        return (
          content.scrollHeight <= container.clientHeight + 1 &&
          content.scrollWidth <= container.clientWidth + 1
        )
      }

      const result = resolveScaledFit(fits, { minFontPx, maxFontPx, maxColumns, textScale })
      if (cancelled) return
      flushSync(() =>
        setLayout((previous) =>
          previous.fontPx === result.fontPx &&
          previous.columns === result.columns &&
          previous.fitsOnScreen === result.fitsOnScreen
            ? previous
            : result,
        ),
      )
    })

    return () => {
      cancelled = true
    }
    // `layout` is deliberately absent: a fit run must not react to its own output.
  }, [enabled, container, contentKey, maxFontPx, minFontPx, maxColumns, textScale, resizeTick])

  return {
    containerRef,
    fontPx: layout.fontPx,
    columns: layout.columns,
    fitsOnScreen: layout.fitsOnScreen,
  }
}
