import { useCallback, useLayoutEffect, useState } from 'react'
import type { Section } from '../types/song'
import {
  allocateColumnWidths,
  estimateColumnHeightPx,
  getColumnDisplayWidths,
  partitionSections,
  type SheetColumns,
} from './songLayout'

export interface FitLayout {
  columns: SheetColumns
  fontSizePx: number
  fitsOnScreen: boolean
}

export interface SelectFitLayoutOptions {
  sections: Section[]
  viewportWidthPx: number
  viewportHeightPx: number
  preferredColumns: SheetColumns
  preferredFontSizePx: number
  charWidthAt16Px: number
  minFontSizePx?: number
  columnGapPx?: number
  sectionGapPx?: number
  safetyPx?: number
}

const DEFAULT_MIN_FONT_SIZE_PX = 11
const DEFAULT_SAFETY_PX = 8
const MONOSPACE_FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const COLUMN_COUNTS: SheetColumns[] = [1, 2, 3, 4]

function orderedColumnCounts(preferred: SheetColumns): SheetColumns[] {
  return [preferred, ...COLUMN_COUNTS.filter((column) => column !== preferred)]
}

/**
 * Picks the largest readable layout that keeps the whole sheet inside the
 * viewport. The preferred column count and font size always come first, so a
 * layout that already fits is left untouched.
 */
export function selectFitLayout({
  sections,
  viewportWidthPx,
  viewportHeightPx,
  preferredColumns,
  preferredFontSizePx,
  charWidthAt16Px,
  minFontSizePx = DEFAULT_MIN_FONT_SIZE_PX,
  columnGapPx = viewportWidthPx < 640 ? 24 : 32,
  sectionGapPx = viewportWidthPx < 640 ? 24 : 32,
  safetyPx = DEFAULT_SAFETY_PX,
}: SelectFitLayoutOptions): FitLayout {
  const startFontSizePx = Math.max(1, Math.round(preferredFontSizePx))
  const floorFontSizePx = Math.min(minFontSizePx, startFontSizePx)
  const preferred = COLUMN_COUNTS.includes(preferredColumns) ? preferredColumns : 1

  if (sections.length === 0 || viewportWidthPx <= 0 || viewportHeightPx <= 0) {
    return {
      columns: preferred,
      fontSizePx: startFontSizePx,
      fitsOnScreen: true,
    }
  }

  const columnOrder = orderedColumnCounts(preferred)
  let fallback: { columns: SheetColumns; height: number } | null = null

  const measureColumns = (columns: SheetColumns, fontSizePx: number) => {
    const partitions = partitionSections(sections, columns)
    const visiblePartitions = partitions.filter((partition) => partition.length > 0)
    if (visiblePartitions.length === 0) {
      return { valid: true, columns: 1 as SheetColumns, height: 0 }
    }

    const effectiveColumns = Math.min(columns, visiblePartitions.length) as SheetColumns
    const usableWidthPx = viewportWidthPx - columnGapPx * (visiblePartitions.length - 1)
    const charWidthPx = charWidthAt16Px * (fontSizePx / 16)
    if (usableWidthPx <= 0 || charWidthPx <= 0) {
      return { valid: false, columns: effectiveColumns, height: Number.POSITIVE_INFINITY }
    }

    // Leave one character cell of rounding room, matching SongSheet's own
    // available-width calculation.
    const availableWidthCh = Math.max(
      visiblePartitions.length,
      Math.floor(usableWidthPx / charWidthPx) - 1,
    )
    const intrinsicWidths = getColumnDisplayWidths(visiblePartitions)
    const allocatedWidths = allocateColumnWidths(intrinsicWidths, availableWidthCh)
    const valid = allocatedWidths.every(
      (width, index) => width + 0.01 >= intrinsicWidths[index],
    )
    const height = Math.max(
      ...visiblePartitions.map((column) =>
        estimateColumnHeightPx(column, fontSizePx, sectionGapPx),
      ),
      0,
    )

    return { valid, columns: effectiveColumns, height }
  }

  for (let fontSizePx = startFontSizePx; fontSizePx >= floorFontSizePx; fontSizePx -= 1) {
    for (const columns of columnOrder) {
      const result = measureColumns(columns, fontSizePx)
      if (!result.valid) continue

      if (!fallback || result.height < fallback.height) {
        fallback = { columns: result.columns, height: result.height }
      }

      if (result.height + safetyPx <= viewportHeightPx) {
        return {
          columns: result.columns,
          fontSizePx,
          fitsOnScreen: true,
        }
      }
    }
  }

  return {
    // One wide column is the safest fallback when even the smallest readable
    // size cannot satisfy every column's intrinsic width.
    columns: fallback?.columns ?? 1,
    fontSizePx: floorFontSizePx,
    fitsOnScreen: false,
  }
}

function measureCharWidthAt16Px(viewport: HTMLElement): number {
  if (typeof document === 'undefined') return 9.6

  const probe = document.createElement('span')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.position = 'absolute'
  probe.style.left = '-9999px'
  probe.style.top = '0'
  probe.style.visibility = 'hidden'
  probe.style.whiteSpace = 'pre'
  probe.style.fontFamily = MONOSPACE_FONT_STACK
  probe.style.fontSize = '16px'
  probe.style.lineHeight = '1'
  probe.textContent = '0000000000'
  viewport.appendChild(probe)
  const width = probe.getBoundingClientRect().width / 10
  probe.remove()
  return width > 0 ? width : 9.6
}

function hasHorizontalOverflow(sheet: HTMLElement): boolean {
  const lines = sheet.querySelectorAll<HTMLElement>(
    '[data-lyric-line-key], [data-sheet-line]',
  )
  for (const line of lines) {
    if (line.scrollWidth > line.clientWidth + 1) return true
  }
  return false
}

export interface UseFitToScreenOptions {
  enabled: boolean
  sections: Section[]
  preferredColumns: SheetColumns
  preferredFontSizePx: number
  minFontSizePx?: number
}

/**
 * Measures the real sheet viewport, selects a fit layout, then verifies the
 * rendered DOM and steps down one font pixel at a time if the estimate was
 * optimistic. The hook never steps below the readable minimum and never clips
 * content; callers can use `layout.fitsOnScreen` to allow scrolling.
 */
export function useFitToScreen({
  enabled,
  sections,
  preferredColumns,
  preferredFontSizePx,
  minFontSizePx = DEFAULT_MIN_FONT_SIZE_PX,
}: UseFitToScreenOptions) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [charWidthAt16Px, setCharWidthAt16Px] = useState(9.6)
  const [layout, setLayout] = useState<FitLayout>(() => ({
    columns: preferredColumns,
    fontSizePx: preferredFontSizePx,
    fitsOnScreen: true,
  }))

  const viewportRef = useCallback((node: HTMLDivElement | null) => {
    setViewport(node)
  }, [])

  useLayoutEffect(() => {
    if (!viewport) return

    const update = () => {
      const width = viewport.clientWidth
      const height = viewport.clientHeight
      setViewportSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      )

      const measured = measureCharWidthAt16Px(viewport)
      setCharWidthAt16Px((previous) =>
        Math.abs(previous - measured) < 0.01 ? previous : measured,
      )
    }

    update()
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(viewport)
    window.addEventListener('resize', update)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [viewport])

  useLayoutEffect(() => {
    if (!enabled) {
      setLayout((previous) =>
        previous.columns === preferredColumns &&
        previous.fontSizePx === preferredFontSizePx &&
        previous.fitsOnScreen
          ? previous
          : {
              columns: preferredColumns,
              fontSizePx: preferredFontSizePx,
              fitsOnScreen: true,
            },
      )
      return
    }

    if (!viewportSize.width || !viewportSize.height) return

    const next = selectFitLayout({
      sections,
      viewportWidthPx: viewportSize.width,
      viewportHeightPx: viewportSize.height,
      preferredColumns,
      preferredFontSizePx,
      minFontSizePx,
      charWidthAt16Px,
    })
    setLayout((previous) =>
      previous.columns === next.columns &&
      previous.fontSizePx === next.fontSizePx &&
      previous.fitsOnScreen === next.fitsOnScreen
        ? previous
        : next,
    )
  }, [
    enabled,
    sections,
    preferredColumns,
    preferredFontSizePx,
    minFontSizePx,
    viewportSize.width,
    viewportSize.height,
    charWidthAt16Px,
  ])

  useLayoutEffect(() => {
    if (!enabled || !viewport) return

    const sheet = viewport.querySelector<HTMLElement>('[data-song-sheet]')
    if (!sheet) return

    const availableHeightPx = viewport.clientHeight
    const overflow =
      sheet.scrollHeight > availableHeightPx + 1 || hasHorizontalOverflow(sheet)
    if (!overflow) {
      if (!layout.fitsOnScreen) {
        setLayout((previous) => ({ ...previous, fitsOnScreen: true }))
      }
      return
    }

    const floorFontSizePx = Math.min(
      minFontSizePx,
      Math.max(1, Math.round(preferredFontSizePx)),
    )
    if (layout.fontSizePx > floorFontSizePx) {
      setLayout((previous) =>
        previous.fontSizePx === layout.fontSizePx
          ? { ...previous, fontSizePx: previous.fontSizePx - 1, fitsOnScreen: true }
          : previous,
      )
    } else if (layout.fitsOnScreen) {
      setLayout((previous) => ({ ...previous, fitsOnScreen: false }))
    }
  }, [
    enabled,
    layout,
    sections,
    viewport,
    minFontSizePx,
    preferredFontSizePx,
    viewportSize.width,
    viewportSize.height,
  ])

  return { viewportRef, layout }
}
