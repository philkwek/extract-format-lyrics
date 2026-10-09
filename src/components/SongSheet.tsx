import type { Section, Line, ChordPlacement } from '../types/song'

interface SongSheetProps {
  sections: Section[]
  fontSizePx?: number
  columns?: 1 | 2 | 3
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
    <div className="font-mono text-amber-400 font-bold leading-none select-none whitespace-pre">
      {charArray.join('')}
    </div>
  )
}

function renderLine(line: Line, key: number) {
  if (line.kind === 'tab') {
    return (
      <div key={key} className="font-mono text-neutral-400 text-xs py-0.5 whitespace-pre overflow-x-auto">
        {line.raw}
      </div>
    )
  }

  if (line.kind === 'chords-only') {
    return (
      <div key={key} className="font-mono text-amber-400 font-bold py-1 whitespace-pre">
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
      <div className="font-mono text-neutral-200 whitespace-pre leading-relaxed">
        {line.text || ' '}
      </div>
    </div>
  )
}

export default function SongSheet({ sections, fontSizePx = 14, columns = 1 }: SongSheetProps) {
  const colClass = columns === 3 ? 'columns-3' : columns === 2 ? 'columns-2' : 'columns-1'

  return (
    <div
      className={`song-sheet select-text ${colClass}`}
      style={{ fontSize: `${fontSizePx}px` }}
    >
      {sections.map((section, sIdx) => (
        <div key={sIdx} className="section-block mb-6 break-inside-avoid">
          {section.label && (
            <h3 className="text-xs uppercase tracking-wider font-semibold text-neutral-400 border-b border-neutral-800/80 pb-1 mb-2">
              {section.label}
            </h3>
          )}
          <div className="space-y-0.5">
            {section.lines.map((line, lIdx) => renderLine(line, lIdx))}
          </div>
        </div>
      ))}
    </div>
  )
}
