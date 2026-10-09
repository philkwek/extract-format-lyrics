import { useState, useMemo } from 'react'
import type { Section, Line, ChordPlacement } from '../types/song'
import ChordKeyboard from './ChordKeyboard'
import { partitionSections } from '../lib/songLayout'

interface SongSheetProps {
  sections: Section[]
  fontSizePx?: number
  columns?: 1 | 2 | 3
  isEditingChords?: boolean
  onDeleteSection?: (sectionIndex: number) => void
  onReorderSections?: (fromIndex: number, toIndex: number) => void
  onEditChord?: (sectionIndex: number, lineIndex: number, chordIndex: number, newChord: string) => void
  onDeleteChord?: (sectionIndex: number, lineIndex: number, chordIndex: number) => void
}

interface EditingChordTarget {
  sectionIndex: number
  lineIndex: number
  chordIndex: number
  currentChord: string
  lyricContext?: string
}

function renderChordLine(
  chords: ChordPlacement[],
  _textLength?: number,
  onChordClick?: (chordIndex: number, chord: string) => void
) {
  if (chords.length === 0) return null

  // Create an aligned chord line with interactive elements
  const indexedChords = chords
    .map((c, originalIndex) => ({ ...c, originalIndex }))
    .sort((a, b) => a.pos - b.pos)

  const elements: React.ReactNode[] = []
  let cursor = 0

  for (const c of indexedChords) {
    if (c.pos > cursor) {
      elements.push(' '.repeat(c.pos - cursor))
      cursor = c.pos
    } else if (c.pos < cursor) {
      elements.push(' ')
      cursor += 1
    }

    elements.push(
      <span
        key={c.originalIndex}
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
          onChordClick
            ? 'cursor-pointer hover:underline hover:bg-amber-500/25 dark:hover:bg-amber-400/25 px-0.5 -mx-0.5 rounded transition-colors inline-block border-b border-dashed border-amber-500/70'
            : undefined
        }
      >
        {c.chord}
      </span>
    )
    cursor += c.chord.length
  }

  return (
    <div className="font-mono text-amber-600 dark:text-amber-400 font-bold leading-none select-none whitespace-pre">
      {elements}
    </div>
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
    lyricContext?: string
  ) => void
) {
  if (line.kind === 'tab') {
    return (
      <div key={key} className="font-mono text-neutral-600 dark:text-[#999999] text-xs py-0.5 whitespace-pre overflow-x-auto">
        {line.raw}
      </div>
    )
  }

  if (line.kind === 'chords-only') {
    return (
      <div key={key} className="font-mono text-amber-600 dark:text-amber-400 font-bold py-1 whitespace-pre">
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
                  ? 'cursor-pointer hover:underline hover:bg-amber-500/25 dark:hover:bg-amber-400/25 px-0.5 -mx-0.5 rounded transition-colors inline-block border-b border-dashed border-amber-500/70'
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

  return (
    <div key={key} className="py-1">
      {renderChordLine(
        line.chords,
        line.text.length,
        onChordClick
          ? (chordIndex, chord) =>
              onChordClick(sectionIndex, lineIndex, chordIndex, chord, line.text)
          : undefined
      )}
      <div className="font-mono text-neutral-800 dark:text-[#d4d4d4] whitespace-pre leading-relaxed">
        {line.text || ' '}
      </div>
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
  onEditChord,
  onDeleteChord,
}: SongSheetProps) {
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [editingChord, setEditingChord] = useState<EditingChordTarget | null>(null)
  const columnPartitions = useMemo(
    () => partitionSections(sections, columns),
    [sections, columns]
  )

  const gridClass =
    columns === 3
      ? 'grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8 items-start'
      : columns === 2
      ? 'grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8 items-start'
      : 'grid grid-cols-1 gap-6'

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
    lyricContext?: string
  ) => {
    setEditingChord({ sectionIndex, lineIndex, chordIndex, currentChord: chord, lyricContext })
  }

  const handleSaveChord = (newChord: string) => {
    if (!editingChord) return
    const trimmed = newChord.trim()
    if (!trimmed) {
      onDeleteChord?.(editingChord.sectionIndex, editingChord.lineIndex, editingChord.chordIndex)
    } else {
      onEditChord?.(editingChord.sectionIndex, editingChord.lineIndex, editingChord.chordIndex, trimmed)
    }
    setEditingChord(null)
  }

  const handleDeleteChord = () => {
    if (!editingChord) return
    onDeleteChord?.(editingChord.sectionIndex, editingChord.lineIndex, editingChord.chordIndex)
    setEditingChord(null)
  }

  return (
    <div
      className="song-sheet select-text"
      style={{ fontSize: `${fontSizePx}px` }}
    >
      {isEditingChords && (
        <div className="mb-4 bg-amber-500/10 dark:bg-amber-400/10 border border-amber-500/30 rounded-lg px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-medium">
            <span>✎</span>
            <span>
              <strong>Chord editing active:</strong> Click on any underlined chord below to change or delete it.
            </span>
          </span>
        </div>
      )}

      <div className={gridClass}>
        {columnPartitions.map((colItems, colIdx) => (
          <div key={colIdx} className="space-y-6 min-w-0">
            {colItems.map(({ section, originalIndex }) => {
              const isDragging = draggedIdx === originalIndex
              const isOver = dragOverIdx === originalIndex && draggedIdx !== originalIndex

              return (
                <div
                  key={originalIndex}
                  draggable={Boolean(onReorderSections)}
                  onDragStart={(e) => handleDragStart(e, originalIndex)}
                  onDragOver={(e) => handleDragOver(e, originalIndex)}
                  onDrop={(e) => handleDrop(e, originalIndex)}
                  onDragEnd={handleDragEnd}
                  className={`section-block mb-6 relative transition-all ${
                    isDragging ? 'opacity-30 scale-[0.99]' : ''
                  }`}
                >
                  {/* Top insertion indicator line when dragging over this section */}
                  {isOver && (
                    <div className="absolute -top-3 left-0 right-0 flex items-center z-10 pointer-events-none">
                      <div className="w-2 h-2 rounded-full bg-amber-500 -mr-1" />
                      <div className="h-0.5 flex-1 bg-amber-500 shadow-xs" />
                      <div className="w-2 h-2 rounded-full bg-amber-500 -ml-1" />
                    </div>
                  )}
                  <div className="flex items-center justify-between border-b border-neutral-300 dark:border-[#282828] pb-1 mb-2 select-none group">
                    <div
                      className="flex items-center gap-1.5 cursor-grab active:cursor-grabbing"
                      title={onReorderSections ? 'Drag to reorder section' : undefined}
                    >
                      {onReorderSections && (
                        <span
                          className="text-neutral-400 hover:text-neutral-700 dark:text-[#999999] dark:hover:text-[#e5e5e5] text-xs font-mono select-none px-0.5"
                          title="Drag to reorder"
                        >
                          ⋮⋮
                        </span>
                      )}
                      <h3
                        className="font-mono text-neutral-800 dark:text-[#d4d4d4] font-bold uppercase tracking-wider"
                        style={{ fontSize: `${fontSizePx}px` }}
                      >
                        {section.label || 'Section'}
                      </h3>
                    </div>
                    {onDeleteSection && (
                      <button
                        type="button"
                        onClick={() => onDeleteSection(originalIndex)}
                        title={`Delete ${section.label || 'this section'}`}
                        className="text-neutral-400 hover:text-red-500 dark:text-[#999999] dark:hover:text-red-400 text-xs px-1.5 py-0.5 rounded hover:bg-neutral-200 dark:hover:bg-[#252525] transition-colors cursor-pointer"
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
                        isEditingChords && (onEditChord || onDeleteChord) ? handleOpenEditChord : undefined
                      )
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Custom Musical Keyboard Modal for editing or deleting a chord */}
      {editingChord && (
        <ChordKeyboard
          initialChord={editingChord.currentChord}
          lyricContext={editingChord.lyricContext}
          onSave={handleSaveChord}
          onDelete={handleDeleteChord}
          onCancel={() => setEditingChord(null)}
        />
      )}
    </div>
  )
}
