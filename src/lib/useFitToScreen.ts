import { useState, useEffect, useRef } from 'react'

export interface FitResult {
  columns: 1 | 2 | 3
  fontSizePx: number
  fitsOnScreen: boolean
}

/**
 * Calculates the optimal column count (1, 2, or 3) and font size (down to 11px)
 * so that the song sheet fits in the available viewport height without scrolling.
 */
export function calculateFitLayout(
  containerHeight: number,
  containerWidth: number,
  contentScrollHeight: number,
  currentColumns: 1 | 2 | 3,
  currentFontSizePx: number
): FitResult {
  // If screen width is narrow (< 480px), enforce 1 column max
  // Min readable column width is ~140px
  const maxAllowedCols = containerWidth < 400 ? 1 : containerWidth < 700 ? 2 : 3

  // If already fits
  if (contentScrollHeight <= containerHeight) {
    return {
      columns: currentColumns,
      fontSizePx: currentFontSizePx,
      fitsOnScreen: true,
    }
  }

  // Try increasing column count up to maxAllowedCols
  for (let cols = (currentColumns + 1) as 1 | 2 | 3; cols <= maxAllowedCols; cols++) {
    // Estimating height reduction with multi-columns
    const approxHeight = contentScrollHeight / (cols * 0.85)
    if (approxHeight <= containerHeight) {
      return {
        columns: cols as 1 | 2 | 3,
        fontSizePx: currentFontSizePx,
        fitsOnScreen: true,
      }
    }
  }

  // If still doesn't fit, try scaling font down to readable minimum 11px
  const targetCols = maxAllowedCols as 1 | 2 | 3
  const minFont = 11
  for (let font = currentFontSizePx - 1; font >= minFont; font--) {
    const scaleFactor = font / currentFontSizePx
    const approxHeight = (contentScrollHeight * scaleFactor) / (targetCols * 0.85)
    if (approxHeight <= containerHeight) {
      return {
        columns: targetCols,
        fontSizePx: font,
        fitsOnScreen: true,
      }
    }
  }

  // Cannot fully fit without clipping -> cap at max readable settings and return notice
  return {
    columns: targetCols,
    fontSizePx: minFont,
    fitsOnScreen: false,
  }
}

export function useFitToScreen(enabled: boolean) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [layout, setLayout] = useState<FitResult>({
    columns: 1,
    fontSizePx: 14,
    fitsOnScreen: true,
  })

  useEffect(() => {
    if (!enabled || !containerRef.current) return

    const measure = () => {
      const el = containerRef.current
      if (!el) return

      const availableHeight = window.innerHeight - 180 // Deduct headers/tabs
      const availableWidth = el.clientWidth
      const scrollHeight = el.scrollHeight

      const result = calculateFitLayout(
        availableHeight,
        availableWidth,
        scrollHeight,
        layout.columns,
        layout.fontSizePx
      )
      setLayout(result)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(containerRef.current)
    window.addEventListener('resize', measure)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [enabled, layout.columns, layout.fontSizePx])

  return { containerRef, layout }
}
