import {
  Fragment,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { Section, Line, ChordPlacement } from '../types/song'
import ChordKeyboard from './ChordKeyboard'
import {
  allocateColumnWidths,
  getColumnDisplayWidths,
  partitionSections,
  TITLE_BLOCK_WEIGHT,
  type SheetColumns,
} from '../lib/songLayout'
import { getLyricSplitPositions } from '../lib/lineSplit'
import { wrapLyricLine } from '../lib/lyricWrap'

interface SongSheetProps {
  sections: Section[]
  fontSizePx?: number
  columns?: SheetColumns
  isEditingChords?: boolean
  onDeleteSection?: (sectionIndex: number) => void
  onReorderSections?: (fromIndex: number, toIndex: number) => void
  onRenameSection?: (sectionIndex: number, newLabel: string) => void
  onEditChord?: (
    sectionIndex: number,
    lineIndex: number,
    chordIndex: number,
    newChord: string,
  ) => void
  onDeleteChord?: (sectionIndex: number, lineIndex: number, chordIndex: number) => void
  /** When set, tapping a lyric-line chord selects it (instead of opening the chord keyboard). */
  onChordSelect?: (sectionIndex: number, lineIndex: number, chordIndex: number) => void
  /** Chord currently selected for repositioning; rendered highlighted. */
  selectedChord?: { sectionIndex: number; lineIndex: number; chordIndex: number } | null
  /** Called when the user clicks 'Edit Position' from within the chord keyboard modal */
  onStartEditPosition?: (target: {
    sectionIndex: number
    lineIndex: number
    chordIndex: number
    chord: string
  }) => void
  onSplitLine?: (sectionIndex: number, lineIndex: number, splitAt: number) => void
  onMergeLineWithPrevious?: (sectionIndex: number, lineIndex: number) => void
  onLyricOverflowChange?: (hasOverflow: boolean) => void
  /** Draw long lyric lines on multiple rows instead of overflowing horizontally. */
  wrapLines?: boolean
  /** Full screen only: drawn above the first section, in column 1. */
  titleBlock?: ReactNode
}

interface EditingChordTarget {
  sectionIndex: number
  lineIndex: number
  chordIndex: number
  currentChord: string
  lyricContext?: string
}

/**
 * Renders a lyric line as segments. Each chord is stacked directly above the
 * slice of lyric text it sits over (text.slice(pos, nextPos)), so chord and
 * lyric share one column and can never drift apart. An empty/whitespace slice
 * is a rest: the column is at least as wide as the chord plus a gap.
 */
function renderLyricSegments(
  text: string,
  chords: Array<ChordPlacement & { originalIndex?: number }>,
  onChordClick?: (chordIndex: number, chord: string) => void,
  selectedIndex?: number,
  measurementKey?: string,
  splitPositions?: number[],
  onSplitAt?: (splitAt: number) => void,
) {
  const sorted = chords
    .map((c, originalIndex) => ({
      ...c,
      originalIndex: c.originalIndex ?? originalIndex,
    }))
    .sort((a, b) => a.pos - b.pos || a.originalIndex - b.originalIndex)

  const segments: { chord?: (typeof sorted)[number]; text: string; start: number }[] = []
  const firstPos =
    sorted.length > 0 ? Math.min(Math.max(sorted[0].pos, 0), text.length) : text.length
  if (firstPos > 0 || sorted.length === 0) {
    segments.push({ text: text.slice(0, firstPos), start: 0 })
  }
  sorted.forEach((c, i) => {
    const start = Math.min(Math.max(c.pos, 0), text.length)
    const next = sorted[i + 1]
    const end = next ? Math.min(Math.max(next.pos, start), text.length) : text.length
    segments.push({ chord: c, text: text.slice(start, end), start })
  })

  return (
    <div
      className="flex w-max max-w-full items-end font-mono leading-none whitespace-pre"
      data-lyric-line-key={measurementKey}
    >
      {segments.map((seg, i) => {
        const c = seg.chord
        return (
          <span key={i} className="inline-flex shrink-0 flex-col">
            <span
              className="min-h-[1em] pb-[0.1px] leading-none font-bold text-[#255283] select-none dark:text-amber-400"
              style={c ? { paddingRight: '1ch' } : undefined}
            >
              {c ? (
                <span
                  onClick={
                    onChordClick
                      ? (e) => {
                          e.stopPropagation()
                          onChordClick(c.originalIndex, c.chord)
                        }
                      : undefined
                  }
                  title={onChordClick ? 'Click to edit or delete chord' : undefined}
                  className={
                    c.originalIndex === selectedIndex
                      ? '-mx-1 inline-block cursor-pointer rounded bg-[#3368A0] px-1 text-white ring-2 ring-[#3368A0]/40 dark:bg-amber-400 dark:text-black dark:ring-amber-400/40'
                      : onChordClick
                        ? '-mx-0.5 inline-block cursor-pointer rounded border-b border-dashed border-[#3368A0]/70 px-0.5 transition-colors hover:bg-[#3368A0]/15 hover:underline dark:border-amber-500/70 dark:hover:bg-amber-400/25'
                        : undefined
                  }
                >
                  {c.chord}
                </span>
              ) : (
                ' '
              )}
            </span>
            <span className="leading-relaxed text-neutral-800 select-none dark:text-[#d4d4d4]">
              {splitPositions && onSplitAt
                ? renderInlineSplitMarkers(seg.text, seg.start, splitPositions, onSplitAt)
                : seg.text || ' '}
            </span>
          </span>
        )
      })}
    </div>
  )
}

function renderInlineSplitMarkers(
  segmentText: string,
  segmentStart: number,
  splitPositions: number[],
  onSplitAt: (splitAt: number) => void,
) {
  const segmentEnd = segmentStart + segmentText.length
  const positionsInSegment = splitPositions.filter(
    (position) => position > segmentStart && position <= segmentEnd,
  )
  let previousPosition = segmentStart

  return (
    <>
      {positionsInSegment.map((position) => {
        const text = segmentText.slice(previousPosition - segmentStart, position - segmentStart)
        previousPosition = position
        return (
          <span key={position}>
            {text}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onSplitAt(position)
              }}
              className="relative z-10 inline-block w-[0.7ch] origin-left scale-x-125 text-left font-black text-[#3368A0] after:absolute after:-inset-x-2 after:-inset-y-1 after:content-[''] hover:text-[#255283] dark:text-amber-400 dark:hover:text-amber-300"
              title="Start a new lyric line here"
              aria-label={`Start a new lyric line before position ${position}`}
            >
              |
            </button>
          </span>
        )
      })}
      {segmentText.slice(previousPosition - segmentStart) || ' '}
    </>
  )
}

function renderLine(
  line: Line,
  key: number,
  sectionIndex: number,
  lineIndex: number,
  onChordClick?: (
    sectionIndex: number,
    lineIndex: number,
    chordIndex: number,
    chord: string,
    lyricContext?: string,
  ) => void,
  selectedChordIndex?: number,
  controls?: {
    measurementKey?: string
    isOverflowing: boolean
    isSplitting: boolean
    canMergeWithPrevious: boolean
    /** When set, lyric lines are wrapped to this many character cells. */
    wrapWidthCh?: number
    onStartSplit?: () => void
    onSplitAt?: (splitAt: number) => void
    onCancelSplit?: () => void
    onMergeWithPrevious?: () => void
  },
) {
  if (line.kind === 'tab') {
    return (
      <div
        key={key}
        className="overflow-x-auto py-px font-mono text-xs whitespace-pre text-neutral-600 dark:text-[#999999]"
      >
        {line.raw}
      </div>
    )
  }

  if (line.kind === 'chords-only') {
    return (
      <div
        key={key}
        data-sheet-line
        className="py-0.5 font-mono font-bold whitespace-pre text-[#255283] dark:text-amber-400"
      >
        {line.chords.map((chord, cIdx) => (
          <span key={cIdx}>
            {cIdx > 0 && '   '}
            <span
              onClick={
                onChordClick
                  ? (e) => {
                      e.stopPropagation()
                      onChordClick(sectionIndex, lineIndex, cIdx, chord)
                    }
                  : undefined
              }
              title={onChordClick ? 'Click to edit or delete chord' : undefined}
              className={
                onChordClick
                  ? '-mx-0.5 inline-block cursor-pointer rounded border-b border-dashed border-[#3368A0]/70 px-0.5 transition-colors hover:bg-[#3368A0]/15 hover:underline dark:border-amber-500/70 dark:hover:bg-amber-400/25'
                  : undefined
              }
            >
              {chord}
            </span>
          </span>
        ))}
      </div>
    )
  }

  // Lyric line (with optional chords above)
  if (!line.text.trim() && line.chords.length === 0) {
    // Blank spacer line
    return <div key={key} className="h-3" />
  }

  const isSplitting = Boolean(controls?.isSplitting && controls.onSplitAt && controls.onCancelSplit)
  const splitPositions = isSplitting ? getLyricSplitPositions(line) : undefined
  const wrappedRows =
    controls?.wrapWidthCh !== undefined ? wrapLyricLine(line, controls.wrapWidthCh) : null

  return (
    <div
      key={key}
      className={`min-w-0 ${
        isSplitting ? '-mx-1 rounded bg-[#C8DFDB]/40 px-1 dark:bg-amber-400/10' : ''
      }`}
    >
      {wrappedRows ? (
        <div className="min-w-0">
          {wrappedRows.map((row, rowIndex) => (
            <Fragment key={rowIndex}>
              {renderLyricSegments(
                row.text,
                row.chords,
                onChordClick
                  ? (chordIndex, chord) =>
                      onChordClick(sectionIndex, lineIndex, chordIndex, chord, line.text)
                  : undefined,
                selectedChordIndex,
                undefined,
                splitPositions
                  ?.map((position) => position - row.start)
                  .filter((position) => position > 0 && position <= row.text.length),
                controls?.onSplitAt
                  ? (splitAt) => controls.onSplitAt?.(splitAt + row.start)
                  : undefined,
              )}
            </Fragment>
          ))}
        </div>
      ) : (
        renderLyricSegments(
          line.text,
          line.chords,
          onChordClick
            ? (chordIndex, chord) =>
                onChordClick(sectionIndex, lineIndex, chordIndex, chord, line.text)
            : undefined,
          selectedChordIndex,
          controls?.measurementKey,
          splitPositions,
          controls?.onSplitAt,
        )
      )}
      {isSplitting && (
        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] leading-none font-medium text-[#1c436b] dark:text-amber-200">
          <span>Choose where the next lyric line begins</span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              controls?.onCancelSplit?.()
            }}
            className="shrink-0 underline underline-offset-2 hover:text-[#255283] dark:hover:text-amber-400"
          >
            Cancel
          </button>
        </div>
      )}
      {!isSplitting && (
        <div className="mt-1 flex flex-wrap gap-2">
          {controls?.isOverflowing && controls.onStartSplit && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                controls.onStartSplit?.()
              }}
              className="text-[11px] font-semibold text-[#3368A0] hover:underline dark:text-amber-400"
            >
              Split line
            </button>
          )}
          {controls?.canMergeWithPrevious && controls.onMergeWithPrevious && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                controls.onMergeWithPrevious?.()
              }}
              className="text-[11px] font-semibold text-neutral-500 hover:underline dark:text-[#999999] dark:hover:text-[#e5e5e5]"
            >
              Merge with previous line
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function SongSheet({
  sections,
  fontSizePx = 14,
  columns = 1,
  isEditingChords = false,
  onDeleteSection,
  onReorderSections,
  onRenameSection,
  onEditChord,
  onDeleteChord,
  onChordSelect,
  selectedChord,
  onStartEditPosition,
  onSplitLine,
  onMergeLineWithPrevious,
  onLyricOverflowChange,
  wrapLines = false,
  titleBlock,
}: SongSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const chProbeRef = useRef<HTMLSpanElement | null>(null)
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [editingChord, setEditingChord] = useState<EditingChordTarget | null>(null)
  const [editingSectionIdx, setEditingSectionIdx] = useState<number | null>(null)
  const [editingLabel, setEditingLabel] = useState<string>('')
  const [splittingLine, setSplittingLine] = useState<{
    sectionIndex: number
    lineIndex: number
  } | null>(null)
  const [availableWidthCh, setAvailableWidthCh] = useState<number | undefined>(undefined)
  // Columns actually drawn side by side; a phone stacks them even when 2-4 are chosen.
  const [renderedColumnCount, setRenderedColumnCount] = useState<number | undefined>(undefined)
  const [overflowingLineKeys, setOverflowingLineKeys] = useState<Set<string>>(new Set())
  const hasTitleBlock = Boolean(titleBlock)
  const columnPartitions = useMemo(
    () => partitionSections(sections, columns, hasTitleBlock ? TITLE_BLOCK_WEIGHT : 0),
    [sections, columns, hasTitleBlock],
  )
  const visibleColumnPartitions = useMemo(() => {
    const nonEmptyPartitions = columnPartitions.filter((partition) => partition.length > 0)
    return nonEmptyPartitions.length > 0 ? nonEmptyPartitions : [[]]
  }, [columnPartitions])
  const columnDisplayWidths = useMemo(
    () => getColumnDisplayWidths(visibleColumnPartitions),
    [visibleColumnPartitions],
  )
  const allocatedColumnWidths = useMemo(
    () => allocateColumnWidths(columnDisplayWidths, availableWidthCh),
    [columnDisplayWidths, availableWidthCh],
  )
  const desktopColumnCount = Math.min(columns, visibleColumnPartitions.length) as SheetColumns
  const hasAdaptiveColumns = desktopColumnCount > 1 && allocatedColumnWidths.length > 1
  const columnWrapWidths = useMemo(() => {
    if (!wrapLines) return []
    return visibleColumnPartitions.map((_, index) => {
      if (availableWidthCh === undefined) return undefined
      const allocated =
        hasAdaptiveColumns && renderedColumnCount !== 1
          ? allocatedColumnWidths[index]
          : availableWidthCh
      if (allocated === undefined || !Number.isFinite(allocated)) return undefined
      // Keep one character of rounding room so a measured row never clips.
      return Math.max(1, Math.floor(allocated) - 1)
    })
  }, [
    allocatedColumnWidths,
    availableWidthCh,
    hasAdaptiveColumns,
    renderedColumnCount,
    visibleColumnPartitions,
    wrapLines,
  ])
  const adaptiveGridStyle: CSSProperties | undefined = hasAdaptiveColumns
    ? ({
        '--song-sheet-column-template': allocatedColumnWidths
          .map((width) => `minmax(0, ${width}fr)`)
          .join(' '),
      } as CSSProperties)
    : undefined

  const gridClass =
    desktopColumnCount === 4
      ? 'song-sheet-grid grid grid-cols-1 sm:grid-cols-4 gap-6 sm:gap-8 items-start'
      : desktopColumnCount === 3
        ? 'song-sheet-grid grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8 items-start'
        : desktopColumnCount === 2
          ? 'song-sheet-grid grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8 items-start'
          : 'song-sheet-grid grid grid-cols-1 gap-6'

  useLayoutEffect(() => {
    if (!sheetRef.current) return

    const sheet = sheetRef.current
    const measureOverflow = () => {
      if ((hasAdaptiveColumns || wrapLines) && gridRef.current) {
        const gridWidthPx = gridRef.current.clientWidth
        const probeWidthPx = chProbeRef.current?.getBoundingClientRect().width ?? 0
        const chWidthPx = probeWidthPx > 0 ? probeWidthPx / 10 : fontSizePx * 0.6
        const computedGap =
          typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
            ? parseFloat(window.getComputedStyle(gridRef.current).columnGap)
            : NaN
        const gapPx = Number.isFinite(computedGap) ? computedGap : 32
        const trackCount = window
          .getComputedStyle(gridRef.current)
          .gridTemplateColumns.split(/\s+/)
          .filter(Boolean).length
        const drawnColumns =
          trackCount > 0 ? Math.min(trackCount, desktopColumnCount) : desktopColumnCount
        setRenderedColumnCount((current) => (current === drawnColumns ? current : drawnColumns))
        const usableWidthPx = gridWidthPx - gapPx * (drawnColumns - 1)

        if (usableWidthPx > 0 && chWidthPx > 0) {
          const nextAvailableCh = Math.max(
            desktopColumnCount,
            Math.floor(usableWidthPx / chWidthPx - 1),
          )
          if (hasAdaptiveColumns) {
            const nextWidths = allocateColumnWidths(columnDisplayWidths, nextAvailableCh)
            gridRef.current.style.setProperty(
              '--song-sheet-column-template',
              nextWidths.map((width) => `minmax(0, ${width}fr)`).join(' '),
            )
          }
          setAvailableWidthCh((current) =>
            current === nextAvailableCh ? current : nextAvailableCh,
          )
        }
      }

      const nextOverflowingLines = new Set<string>()
      sheet.querySelectorAll<HTMLElement>('[data-lyric-line-key]').forEach((element) => {
        const key = element.dataset.lyricLineKey
        if (key && element.scrollWidth > element.clientWidth + 1) {
          nextOverflowingLines.add(key)
        }
      })

      onLyricOverflowChange?.(nextOverflowingLines.size > 0)

      setOverflowingLineKeys((current) => {
        if (
          current.size === nextOverflowingLines.size &&
          [...current].every((key) => nextOverflowingLines.has(key))
        ) {
          return current
        }
        return nextOverflowingLines
      })
    }

    measureOverflow()
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureOverflow)
    observer?.observe(sheet)
    window.addEventListener('resize', measureOverflow)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measureOverflow)
    }
  }, [
    columnDisplayWidths,
    columns,
    desktopColumnCount,
    fontSizePx,
    hasAdaptiveColumns,
    isEditingChords,
    onLyricOverflowChange,
    sections,
    wrapLines,
  ])

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', idx.toString())
    setDraggedIdx(idx)
  }

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIdx !== idx) {
      setDragOverIdx(idx)
    }
  }

  const handleDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault()
    if (draggedIdx !== null && draggedIdx !== targetIdx && onReorderSections) {
      onReorderSections(draggedIdx, targetIdx)
    }
    setDraggedIdx(null)
    setDragOverIdx(null)
  }

  const handleDragEnd = () => {
    setDraggedIdx(null)
    setDragOverIdx(null)
  }

  const handleOpenEditChord = (
    sectionIndex: number,
    lineIndex: number,
    chordIndex: number,
    chord: string,
    lyricContext?: string,
  ) => {
    setEditingChord({ sectionIndex, lineIndex, chordIndex, currentChord: chord, lyricContext })
  }

  const handleSaveChord = (newChord: string) => {
    if (!editingChord) return
    const trimmed = newChord.trim()
    if (!trimmed) {
      onDeleteChord?.(editingChord.sectionIndex, editingChord.lineIndex, editingChord.chordIndex)
    } else {
      onEditChord?.(
        editingChord.sectionIndex,
        editingChord.lineIndex,
        editingChord.chordIndex,
        trimmed,
      )
    }
    setEditingChord(null)
  }

  const handleDeleteChord = () => {
    if (!editingChord) return
    onDeleteChord?.(editingChord.sectionIndex, editingChord.lineIndex, editingChord.chordIndex)
    setEditingChord(null)
  }

  const handleStartRenameSection = (originalIndex: number, currentLabel: string) => {
    setEditingSectionIdx(originalIndex)
    setEditingLabel(currentLabel)
  }

  const handleSaveRenameSection = (originalIndex: number) => {
    const trimmed = editingLabel.trim()
    if (trimmed) {
      onRenameSection?.(originalIndex, trimmed)
    }
    setEditingSectionIdx(null)
  }

  const handleCancelRenameSection = () => {
    setEditingSectionIdx(null)
  }

  return (
    <div
      ref={sheetRef}
      data-song-sheet
      className="song-sheet select-text"
      style={{ fontSize: `${fontSizePx}px` }}
    >
      <span
        ref={chProbeRef}
        aria-hidden="true"
        className="pointer-events-none fixed top-0 -left-[9999px] font-mono whitespace-pre opacity-0 select-none"
      >
        0000000000
      </span>
      {isEditingChords && (
        <div className="text-md mb-4 flex items-center justify-between rounded-lg border border-[#66A3BF]/40 bg-[#C8DFDB]/40 px-3 py-2 text-[#1c436b] dark:border-amber-500/30 dark:bg-amber-400/10 dark:text-amber-300">
          <span className="flex items-center gap-1.5">
            <span>✎</span>
            <span>
              <strong>Chord editing active:</strong>
              <ul className="list-disc pl-5">
                <li>Click on any underlined chord below to change, shift or delete it.</li>
                <li>
                  You can also fix suggested lines that clash with other sections by splitting them.
                </li>
              </ul>
            </span>
          </span>
        </div>
      )}

      <div
        ref={gridRef}
        className={`${gridClass}${hasAdaptiveColumns ? 'song-sheet-grid--adaptive' : ''}`}
        style={adaptiveGridStyle}
      >
        {visibleColumnPartitions.map((colItems, colIdx) => (
          <div key={colIdx} className="min-w-0 space-y-6">
            {colIdx === 0 && titleBlock}
            {colItems.map(({ section, originalIndex }) => {
              const isDragging = draggedIdx === originalIndex
              const isOver = dragOverIdx === originalIndex && draggedIdx !== originalIndex
              const isSplitSection = splittingLine?.sectionIndex === originalIndex
              const columnWrapWidthCh = wrapLines ? columnWrapWidths[colIdx] : undefined

              return (
                <div
                  key={originalIndex}
                  draggable={Boolean(onReorderSections)}
                  onDragStart={(e) => handleDragStart(e, originalIndex)}
                  onDragOver={(e) => handleDragOver(e, originalIndex)}
                  onDrop={(e) => handleDrop(e, originalIndex)}
                  onDragEnd={handleDragEnd}
                  title={onReorderSections ? 'Drag section to reorder' : undefined}
                  className={`section-block relative -m-3 rounded-xl p-3 transition-[background-color,opacity,transform,box-shadow] select-none ${
                    onReorderSections
                      ? 'cursor-grab hover:bg-neutral-100/60 active:cursor-grabbing dark:hover:bg-[#1a1a1a]/60'
                      : ''
                  } ${isDragging ? 'scale-[0.99] opacity-30' : ''} ${
                    isSplitSection
                      ? 'z-40 bg-white shadow-2xl ring-2 ring-[#3368A0]/70 dark:bg-[#1a1a1a] dark:ring-amber-400/70'
                      : ''
                  }`}
                >
                  {/* Top insertion indicator line when dragging over this section */}
                  {isOver && (
                    <div className="pointer-events-none absolute -top-3 right-0 left-0 z-10 flex items-center">
                      <div className="-mr-1 h-2 w-2 rounded-full bg-[#3368A0] dark:bg-amber-500" />
                      <div className="h-0.5 flex-1 bg-[#3368A0] shadow-xs dark:bg-amber-500" />
                      <div className="-ml-1 h-2 w-2 rounded-full bg-[#3368A0] dark:bg-amber-500" />
                    </div>
                  )}
                  <div className="group mb-2 flex items-center justify-between border-b border-[#C8DFDB] pb-1 select-none dark:border-[#282828]">
                    {editingSectionIdx === originalIndex ? (
                      <div
                        className="flex min-w-0 flex-1 items-center gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={editingLabel}
                          onChange={(e) => setEditingLabel(e.target.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              handleSaveRenameSection(originalIndex)
                            } else if (e.key === 'Escape') {
                              e.preventDefault()
                              handleCancelRenameSection()
                            }
                          }}
                          onBlur={() => handleSaveRenameSection(originalIndex)}
                          autoFocus
                          className="w-full max-w-[180px] cursor-text rounded border border-[#3368A0] bg-white px-1.5 py-0.5 text-xs font-bold tracking-wider text-neutral-900 uppercase select-text focus:outline-none dark:border-amber-500 dark:bg-[#101010] dark:text-[#e5e5e5]"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSaveRenameSection(originalIndex)
                          }}
                          className="shrink-0 cursor-pointer rounded bg-[#3368A0] px-2 py-0.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#255283] dark:bg-amber-500 dark:text-black dark:hover:bg-amber-400"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCancelRenameSection()
                          }}
                          className="shrink-0 cursor-pointer rounded px-1 py-0.5 text-[11px] text-neutral-500 hover:text-neutral-700 dark:text-[#999999] dark:hover:text-[#e5e5e5]"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div
                        className="group/title flex min-w-0 flex-1 items-center gap-1.5"
                        title={onRenameSection ? 'Click or tap ✎ to edit section title' : undefined}
                      >
                        {onReorderSections && (
                          <span
                            className="shrink-0 cursor-grab px-0.5 text-xs text-neutral-400 select-none hover:text-neutral-700 active:cursor-grabbing dark:text-[#999999] dark:hover:text-[#e5e5e5]"
                            title="Drag to reorder"
                          >
                            ⋮⋮
                          </span>
                        )}
                        <h3
                          onClick={
                            onRenameSection
                              ? (e) => {
                                  e.stopPropagation()
                                  handleStartRenameSection(
                                    originalIndex,
                                    section.label || 'Section',
                                  )
                                }
                              : undefined
                          }
                          className={`truncate font-bold tracking-wider text-neutral-800 uppercase dark:text-[#d4d4d4] ${
                            onRenameSection
                              ? 'cursor-pointer hover:text-[#3368A0] hover:underline dark:hover:text-amber-400'
                              : ''
                          }`}
                          style={{ fontSize: `${fontSizePx}px` }}
                        >
                          {section.label || 'Section'}
                        </h3>
                        {onRenameSection && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleStartRenameSection(originalIndex, section.label || 'Section')
                            }}
                            title="Edit section title"
                            className="cursor-pointer rounded p-0.5 text-xs text-neutral-400 opacity-70 transition-colors group-hover/title:opacity-100 hover:text-[#3368A0] dark:text-[#777777] dark:hover:text-amber-400"
                          >
                            ✎
                          </button>
                        )}
                      </div>
                    )}
                    {onDeleteSection && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDeleteSection(originalIndex)
                        }}
                        title={`Delete ${section.label || 'this section'}`}
                        className="ml-2 shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-xs text-neutral-400 transition-colors hover:bg-red-500/10 hover:text-red-500 dark:text-[#999999] dark:hover:text-red-400"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {section.lines.map((line, lIdx) =>
                      renderLine(
                        line,
                        lIdx,
                        originalIndex,
                        lIdx,
                        onChordSelect
                          ? line.kind === 'lyric'
                            ? (s, l, c) => onChordSelect(s, l, c)
                            : undefined
                          : !selectedChord && isEditingChords && (onEditChord || onDeleteChord)
                            ? handleOpenEditChord
                            : undefined,
                        selectedChord &&
                          selectedChord.sectionIndex === originalIndex &&
                          selectedChord.lineIndex === lIdx
                          ? selectedChord.chordIndex
                          : undefined,
                        line.kind === 'lyric'
                          ? {
                              measurementKey: wrapLines ? undefined : `${originalIndex}:${lIdx}`,
                              isOverflowing:
                                !wrapLines && overflowingLineKeys.has(`${originalIndex}:${lIdx}`),
                              wrapWidthCh: columnWrapWidthCh,
                              isSplitting:
                                splittingLine?.sectionIndex === originalIndex &&
                                splittingLine.lineIndex === lIdx,
                              canMergeWithPrevious:
                                isEditingChords &&
                                lIdx > 0 &&
                                section.lines[lIdx - 1]?.kind === 'lyric' &&
                                line.splitFromPrevious === true,
                              onStartSplit:
                                isEditingChords && onSplitLine
                                  ? () => {
                                      setSplittingLine({
                                        sectionIndex: originalIndex,
                                        lineIndex: lIdx,
                                      })
                                    }
                                  : undefined,
                              onSplitAt:
                                isEditingChords && onSplitLine
                                  ? (splitAt) => {
                                      onSplitLine(originalIndex, lIdx, splitAt)
                                      setSplittingLine(null)
                                    }
                                  : undefined,
                              onCancelSplit: () => setSplittingLine(null),
                              onMergeWithPrevious:
                                isEditingChords && onMergeLineWithPrevious
                                  ? () => {
                                      onMergeLineWithPrevious(originalIndex, lIdx)
                                      setSplittingLine(null)
                                    }
                                  : undefined,
                            }
                          : undefined,
                      ),
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {splittingLine && (
        <button
          type="button"
          aria-label="Cancel split-line selection"
          onClick={() => setSplittingLine(null)}
          className="fixed inset-0 z-[35] cursor-default bg-black/20 backdrop-blur-sm"
        />
      )}

      {/* Custom Musical Keyboard Modal for editing or deleting a chord */}
      {editingChord && (
        <ChordKeyboard
          initialChord={editingChord.currentChord}
          lyricContext={editingChord.lyricContext}
          onSave={handleSaveChord}
          onDelete={handleDeleteChord}
          onCancel={() => setEditingChord(null)}
          onEditPosition={
            onStartEditPosition && editingChord.lyricContext !== undefined
              ? () => {
                  onStartEditPosition({
                    sectionIndex: editingChord.sectionIndex,
                    lineIndex: editingChord.lineIndex,
                    chordIndex: editingChord.chordIndex,
                    chord: editingChord.currentChord,
                  })
                  setEditingChord(null)
                }
              : undefined
          }
        />
      )}
    </div>
  )
}
