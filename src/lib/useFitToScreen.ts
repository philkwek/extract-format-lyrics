import { useCallback, useLayoutEffect, useState } from 'react'
import { flushSync } from 'react-dom'
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
/**
 * Upper bound on DOM-verification passes in one fit run. Font size can only
 * move down, so a run always terminates; this just guards against pathological
 * charts. Each pass is a synchronous render + measure, not a React effect loop.
 */
const MAX_VERIFY_PASSES = 12
/** Window resizes are coalesced so dragging a window edge refits once. */
const RESIZE_DEBOUNCE_MS = 150

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

  // SongSheet uses a single-column grid below Tailwind's `sm` breakpoint.
  // Keep the fit candidate set in sync with that responsive layout.
  const maxColumns: SheetColumns = viewportWidthPx < 640 ? 1 : 4
  const columnOrder = orderedColumnCounts(preferred).filter((columns) => columns <= maxColumns)
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
    const valid = allocatedWidths.every((width, index) => width + 0.01 >= intrinsicWidths[index])
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

/**
 * Next font size to try after the DOM reports overflow. Height scales roughly
 * linearly with font size, so jump straight toward the size that should fit
 * (rounding up so we never undershoot) instead of re-rendering once per pixel.
 * Always moves at least 1px, never below the floor.
 */
export function nextFontSizeAfterOverflow(
  currentPx: number,
  floorPx: number,
  availableHeightPx: number,
  contentHeightPx: number,
): number {
  const ratio =
    contentHeightPx > 0 && availableHeightPx > 0 ? availableHeightPx / contentHeightPx : 1
  const proportional = Math.ceil(currentPx * Math.min(1, ratio))
  return Math.max(floorPx, Math.min(currentPx - 1, proportional))
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
  const lines = sheet.querySelectorAll<HTMLElement>('[data-lyric-line-key], [data-sheet-line]')
  for (const line of lines) {
    if (line.scrollWidth > line.clientWidth + 1) return true
  }
  return false
}

/** Returns the content-box size, excluding the viewport's own padding. */
function getViewportContentSize(viewport: HTMLElement) {
  const style = window.getComputedStyle(viewport)
  const paddingX =
    (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
  const paddingY =
    (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)

  return {
    width: Math.max(0, viewport.clientWidth - paddingX),
    height: Math.max(0, viewport.clientHeight - paddingY),
  }
}

export interface UseFitToScreenOptions {
  enabled: boolean
  sections: Section[]
  preferredColumns: SheetColumns
  preferredFontSizePx: number
  minFontSizePx?: number
  /** Pass a value that changes when surrounding chrome changes height. */
  revision?: unknown
}

/**
 * Fits the sheet to the screen. A fit run is triggered only by real inputs
 * (entering full screen, new sections, changed preferences, `revision`, or a
 * debounced window resize) and never by its own output. Within a run it picks a
 * layout, then verifies against the rendered DOM and steps the font down until
 * nothing overflows, using synchronous renders so the run finishes in one task.
 * Because nothing observes the viewport's size, a scrollbar appearing or the
 * layout changing the box cannot start another run, so there is no feedback loop.
 * The hook never steps below the readable minimum and never clips content;
 * callers can use `layout.fitsOnScreen` to allow scrolling.
 */
export function useFitToScreen({
  enabled,
  sections,
  preferredColumns,
  preferredFontSizePx,
  minFontSizePx = DEFAULT_MIN_FONT_SIZE_PX,
  revision,
}: UseFitToScreenOptions) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [resizeTick, setResizeTick] = useState(0)
  const [layout, setLayout] = useState<FitLayout>(() => ({
    columns: preferredColumns,
    fontSizePx: preferredFontSizePx,
    fitsOnScreen: true,
  }))

  const viewportRef = useCallback((node: HTMLDivElement | null) => {
    setViewport(node)
  }, [])

  // Window resizes are the only size signal, debounced, and only while fitting.
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
    if (!enabled || !viewport) return

    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      const { width: viewportWidth, height: viewportHeight } = getViewportContentSize(viewport)
      if (!viewportWidth || !viewportHeight) return

      const floorFontSizePx = Math.min(minFontSizePx, Math.max(1, Math.round(preferredFontSizePx)))
      let current = selectFitLayout({
        sections,
        viewportWidthPx: viewportWidth,
        viewportHeightPx: viewportHeight,
        preferredColumns,
        preferredFontSizePx,
        minFontSizePx,
        charWidthAt16Px: measureCharWidthAt16Px(viewport),
      })
      const commit = (next: FitLayout) => {
        current = next
        flushSync(() =>
          setLayout((previous) =>
            previous.columns === next.columns &&
            previous.fontSizePx === next.fontSizePx &&
            previous.fitsOnScreen === next.fitsOnScreen
              ? previous
              : next,
          ),
        )
      }
      commit(current)

      for (let pass = 0; pass < MAX_VERIFY_PASSES && !cancelled; pass += 1) {
        const sheet = viewport.querySelector<HTMLElement>('[data-song-sheet]')
        if (!sheet) return

        const { height: availableHeightPx } = getViewportContentSize(viewport)
        const horizontal = hasHorizontalOverflow(sheet)
        const overflow = sheet.scrollHeight > availableHeightPx + 1 || horizontal
        if (!overflow) {
          if (!current.fitsOnScreen) commit({ ...current, fitsOnScreen: true })
          return
        }
        if (current.fontSizePx <= floorFontSizePx) {
          if (current.fitsOnScreen) commit({ ...current, fitsOnScreen: false })
          return
        }
        commit({
          ...current,
          fitsOnScreen: true,
          fontSizePx: horizontal
            ? current.fontSizePx - 1
            : nextFontSizeAfterOverflow(
                current.fontSizePx,
                floorFontSizePx,
                availableHeightPx,
                sheet.scrollHeight,
              ),
        })
      }
    })

    return () => {
      cancelled = true
    }
    // `layout` is deliberately not a dependency: a run must not react to itself.
  }, [
    enabled,
    viewport,
    sections,
    preferredColumns,
    preferredFontSizePx,
    minFontSizePx,
    revision,
    resizeTick,
  ])

  return {
    viewportRef,
    layout: enabled
      ? layout
      : {
          columns: preferredColumns,
          fontSizePx: preferredFontSizePx,
          fitsOnScreen: true,
        },
  }
}
