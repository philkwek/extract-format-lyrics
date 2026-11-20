import { memo, useCallback, useLayoutEffect } from 'react'
import type { Section } from '../types/song'
import type { SheetColumns } from '../lib/songLayout'
import { useFitToScreen, type FitLayout } from '../lib/useFitToScreen'
import SongSheet from './SongSheet'

interface SelectedChord {
  sectionIndex: number
  lineIndex: number
  chordIndex: number
}

interface SheetPageProps {
  sections: Section[]
  columns: SheetColumns
  fontSizePx: number
  fitToScreen: boolean
  wrapLines: boolean
  revision: unknown
  /** -1 for the previous song, 0 for the current one, 1 for the next. */
  offset: -1 | 0 | 1
  active: boolean
  /** Only the active page reports its layout, for the display controls caption. */
  onLayoutChange?: (layout: FitLayout) => void
  scrollRef?: (node: HTMLDivElement | null) => void
  isEditingChords?: boolean
  selectedChord?: SelectedChord | null
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
  onChordSelect?: (sectionIndex: number, lineIndex: number, chordIndex: number) => void
  onStartEditPosition?: (target: {
    sectionIndex: number
    lineIndex: number
    chordIndex: number
    chord: string
  }) => void
  onSplitLine?: (sectionIndex: number, lineIndex: number, splitAt: number) => void
  onMergeLineWithPrevious?: (sectionIndex: number, lineIndex: number) => void
  onLyricOverflowChange?: (hasOverflow: boolean) => void
}

/**
 * One song page in the full screen track. Each page owns its own fit run, so a
 * neighbour is already laid out at the size it will use when it becomes active.
 */
function SheetPage({
  sections,
  columns,
  fontSizePx,
  fitToScreen,
  wrapLines,
  revision,
  offset,
  active,
  onLayoutChange,
  scrollRef,
  isEditingChords = false,
  selectedChord = null,
  onDeleteSection,
  onReorderSections,
  onRenameSection,
  onEditChord,
  onDeleteChord,
  onChordSelect,
  onStartEditPosition,
  onSplitLine,
  onMergeLineWithPrevious,
  onLyricOverflowChange,
}: SheetPageProps) {
  const { viewportRef, layout } = useFitToScreen({
    enabled: fitToScreen,
    sections,
    preferredColumns: columns,
    preferredFontSizePx: fontSizePx,
    revision,
    wrapLines,
  })

  const setViewport = useCallback(
    (node: HTMLDivElement | null) => {
      viewportRef(node)
      if (active) scrollRef?.(node)
    },
    [active, scrollRef, viewportRef],
  )

  useLayoutEffect(() => {
    if (active && fitToScreen) onLayoutChange?.(layout)
  }, [active, fitToScreen, layout, onLayoutChange])

  return (
    <div
      ref={setViewport}
      data-sheet-page
      aria-hidden={active ? undefined : true}
      inert={!active || undefined}
      tabIndex={active ? -1 : undefined}
      style={{ left: `${offset * 100}%` }}
      className={`absolute inset-y-0 w-full min-h-0 px-3 pb-2 pt-2 outline-none [scrollbar-gutter:stable] ${
        fitToScreen && layout.fitsOnScreen ? 'overflow-hidden' : 'overflow-auto'
      } ${wrapLines && !isEditingChords ? 'touch-pan-y' : ''}`}
    >
      <SongSheet
        sections={sections}
        fontSizePx={layout.fontSizePx}
        columns={layout.columns}
        isEditingChords={isEditingChords}
        selectedChord={selectedChord}
        onDeleteSection={onDeleteSection}
        onReorderSections={onReorderSections}
        onRenameSection={onRenameSection}
        onEditChord={onEditChord}
        onDeleteChord={onDeleteChord}
        onChordSelect={onChordSelect}
        onStartEditPosition={onStartEditPosition}
        onSplitLine={onSplitLine}
        onMergeLineWithPrevious={onMergeLineWithPrevious}
        onLyricOverflowChange={onLyricOverflowChange}
        wrapLines={wrapLines}
      />
    </div>
  )
}

export default memo(SheetPage)
