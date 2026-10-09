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
  onRenameSection?: (sectionIndex: number, newLabel: string) => void
  onEditChord?: (sectionIndex: number, lineIndex: number, chordIndex: number, newChord: string) => void
  onDeleteChord?: (sectionIndex: number, lineIndex: number, chordIndex: number) => void
  /** When set, tapping a lyric-line chord selects it (instead of opening the chord keyboard). */
  onChordSelect?: (sectionIndex: number, lineIndex: number, chordIndex: number) => void
  /** Chord currently selected for repositioning; rendered highlighted. */
  selectedChord?: { sectionIndex: number; lineIndex: number; chordIndex: number } | null
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
  chords: ChordPlacement[],
  onChordClick?: (chordIndex: number, chord: string) => void,
  selectedIndex?: number
) {
  const sorted = chords
    .map((c, originalIndex) => ({ ...c, originalIndex }))
    .sort((a, b) => a.pos - b.pos || a.originalIndex - b.originalIndex)

  const segments: { chord?: (typeof sorted)[number]; text: string }[] = []
  const firstPos = sorted.length > 0 ? Math.min(Math.max(sorted[0].pos, 0), text.length) : text.length
  if (firstPos > 0 || sorted.length === 0) {
    segments.push({ text: text.slice(0, firstPos) })
  }
  sorted.forEach((c, i) => {
    const start = Math.min(Math.max(c.pos, 0), text.length)
    const next = sorted[i + 1]
    const end = next ? Math.min(Math.max(next.pos, start), text.length) : text.length
    segments.push({ chord: c, text: text.slice(start, end) })
  })

  return (
    <div className="font-mono whitespace-pre leading-none flex items-end w-max max-w-full">
      {segments.map((seg, i) => {
        const c = seg.chord
        return (
          <span key={i} className="inline-flex flex-col shrink-0">
            <span
              className="text-[#255283] dark:text-amber-400 font-bold select-none min-h-[1em] leading-none pb-0.5"
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
                      ? 'cursor-pointer inline-block px-1 -mx-1 rounded bg-[#3368A0] text-white dark:bg-amber-400 dark:text-black ring-2 ring-[#3368A0]/40 dark:ring-amber-400/40'
                      : onChordClick
                      ? 'cursor-pointer hover:underline hover:bg-[#3368A0]/15 dark:hover:bg-amber-400/25 px-0.5 -mx-0.5 rounded transition-colors inline-block border-b border-dashed border-[#3368A0]/70 dark:border-amber-500/70'
                      : undefined
                  }
                >
                  {c.chord}
                </span>
              ) : (
                ' '
              )}
            </span>
            <span className="text-neutral-800 dark:text-[#d4d4d4] leading-relaxed select-none">
              {seg.text || ' '}
            </span>
          </span>
        )
      })}
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
  ) => void,
  selectedChordIndex?: number
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
      <div key={key} className="font-mono text-[#255283] dark:text-amber-400 font-bold py-1 whitespace-pre">
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
                  ? 'cursor-pointer hover:underline hover:bg-[#3368A0]/15 dark:hover:bg-amber-400/25 px-0.5 -mx-0.5 rounded transition-colors inline-block border-b border-dashed border-[#3368A0]/70 dark:border-amber-500/70'
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
      {renderLyricSegments(
        line.text,
        line.chords,
        onChordClick
          ? (chordIndex, chord) =>
              onChordClick(sectionIndex, lineIndex, chordIndex, chord, line.text)
          : undefined,
        selectedChordIndex
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
}: SongSheetProps) {
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [editingChord, setEditingChord] = useState<EditingChordTarget | null>(null)
  const [editingSectionIdx, setEditingSectionIdx] = useState<number | null>(null)
  const [editingLabel, setEditingLabel] = useState<string>('')
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
      className="song-sheet select-text"
      style={{ fontSize: `${fontSizePx}px` }}
    >
      {isEditingChords && (
        <div className="mb-4 bg-[#C8DFDB]/40 dark:bg-amber-400/10 border border-[#66A3BF]/40 dark:border-amber-500/30 rounded-lg px-3 py-2 text-xs text-[#1c436b] dark:text-amber-300 flex items-center justify-between">
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
                  title={onReorderSections ? 'Drag section to reorder' : undefined}
                  className={`section-block mb-6 relative transition-all rounded-xl p-3 -m-3 select-none ${
                    onReorderSections
                      ? 'cursor-grab active:cursor-grabbing hover:bg-neutral-100/60 dark:hover:bg-[#1a1a1a]/60'
                      : ''
                  } ${isDragging ? 'opacity-30 scale-[0.99]' : ''}`}
                >
                  {/* Top insertion indicator line when dragging over this section */}
                  {isOver && (
                    <div className="absolute -top-3 left-0 right-0 flex items-center z-10 pointer-events-none">
                      <div className="w-2 h-2 rounded-full bg-[#3368A0] dark:bg-amber-500 -mr-1" />
                      <div className="h-0.5 flex-1 bg-[#3368A0] dark:bg-amber-500 shadow-xs" />
                      <div className="w-2 h-2 rounded-full bg-[#3368A0] dark:bg-amber-500 -ml-1" />
                    </div>
                  )}
                  <div className="flex items-center justify-between border-b border-[#C8DFDB] dark:border-[#282828] pb-1 mb-2 select-none group">
                    {editingSectionIdx === originalIndex ? (
                      <div
                        className="flex items-center gap-1.5 flex-1 min-w-0"
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
                          className="text-xs font-bold uppercase tracking-wider bg-white dark:bg-[#101010] text-neutral-900 dark:text-[#e5e5e5] border border-[#3368A0] dark:border-amber-500 rounded px-1.5 py-0.5 focus:outline-none w-full max-w-[180px] select-text cursor-text"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSaveRenameSection(originalIndex)
                          }}
                          className="text-[11px] bg-[#3368A0] hover:bg-[#255283] text-white dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-black px-2 py-0.5 rounded font-semibold cursor-pointer shrink-0 transition-colors"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCancelRenameSection()
                          }}
                          className="text-[11px] text-neutral-500 hover:text-neutral-700 dark:text-[#999999] dark:hover:text-[#e5e5e5] px-1 py-0.5 rounded cursor-pointer shrink-0"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div
                        className="flex items-center gap-1.5 min-w-0 flex-1 group/title"
                        title={onRenameSection ? 'Click or tap ✎ to edit section title' : undefined}
                      >
                        {onReorderSections && (
                          <span
                            className="text-neutral-400 hover:text-neutral-700 dark:text-[#999999] dark:hover:text-[#e5e5e5] text-xs select-none px-0.5 shrink-0 cursor-grab active:cursor-grabbing"
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
                                  handleStartRenameSection(originalIndex, section.label || 'Section')
                                }
                              : undefined
                          }
                          className={`text-neutral-800 dark:text-[#d4d4d4] font-bold uppercase tracking-wider truncate ${
                            onRenameSection ? 'cursor-pointer hover:text-[#3368A0] dark:hover:text-amber-400 hover:underline' : ''
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
                            className="text-neutral-400 hover:text-[#3368A0] dark:text-[#777777] dark:hover:text-amber-400 text-xs p-0.5 rounded transition-colors cursor-pointer opacity-70 group-hover/title:opacity-100"
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
                        className="text-neutral-400 hover:text-red-500 dark:text-[#999999] dark:hover:text-red-400 text-xs px-1.5 py-0.5 rounded hover:bg-neutral-200 dark:hover:bg-[#252525] transition-colors cursor-pointer ml-2 shrink-0"
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
                          : isEditingChords && (onEditChord || onDeleteChord)
                          ? handleOpenEditChord
                          : undefined,
                        selectedChord &&
                          selectedChord.sectionIndex === originalIndex &&
                          selectedChord.lineIndex === lIdx
                          ? selectedChord.chordIndex
                          : undefined
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
