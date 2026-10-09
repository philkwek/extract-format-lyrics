import { useState } from 'react'
import type { Section, Line, ChordPlacement } from '../types/song'

interface SongSheetProps {
  sections: Section[]
  fontSizePx?: number
  columns?: 1 | 2 | 3
  onDeleteSection?: (sectionIndex: number) => void
  onReorderSections?: (fromIndex: number, toIndex: number) => void
}

function renderChordLine(chords: ChordPlacement[], textLength: number) {
  if (chords.length === 0) return null

  // Create an aligned chord line string with exact spacing
  const maxPos = Math.max(
    textLength,
    chords.reduce((acc, c) => Math.max(acc, c.pos + c.chord.length), 0)
  )

  const charArray = Array(maxPos).fill(' ')
  for (const { pos, chord } of chords) {
    for (let i = 0; i < chord.length; i++) {
      if (pos + i < charArray.length) {
        charArray[pos + i] = chord[i]
      }
    }
  }

  return (
    <div className="font-mono text-amber-600 dark:text-amber-400 font-bold leading-none select-none whitespace-pre">
      {charArray.join('')}
    </div>
  )
}

function renderLine(line: Line, key: number) {
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
        {line.chords.join('   ')}
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
      {renderChordLine(line.chords, line.text.length)}
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
  onDeleteSection,
  onReorderSections,
}: SongSheetProps) {
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const colClass = columns === 3 ? 'columns-3' : columns === 2 ? 'columns-2' : 'columns-1'

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

  return (
    <div
      className={`song-sheet select-text ${colClass}`}
      style={{ fontSize: `${fontSizePx}px` }}
    >
      {sections.map((section, sIdx) => {
        const isDragging = draggedIdx === sIdx
        const isOver = dragOverIdx === sIdx && draggedIdx !== sIdx

        return (
          <div
            key={sIdx}
            draggable={Boolean(onReorderSections)}
            onDragStart={(e) => handleDragStart(e, sIdx)}
            onDragOver={(e) => handleDragOver(e, sIdx)}
            onDrop={(e) => handleDrop(e, sIdx)}
            onDragEnd={handleDragEnd}
            className={`section-block mb-6 break-inside-avoid relative transition-all ${
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
                  onClick={() => onDeleteSection(sIdx)}
                  title={`Delete ${section.label || 'this section'}`}
                  className="text-neutral-400 hover:text-red-500 dark:text-[#999999] dark:hover:text-red-400 text-xs px-1.5 py-0.5 rounded hover:bg-neutral-200 dark:hover:bg-[#252525] transition-colors cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
            <div className="space-y-0.5">
              {section.lines.map((line, lIdx) => renderLine(line, lIdx))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
