import { useState, useRef, useEffect } from 'react'
import { MoveHorizontal, Trash2 } from 'lucide-react'
import {
  parseChordComponents,
  applyRoot,
  applyAccidental,
  applyQuality,
  applySlash,
} from '../lib/chordEdit'
import { isMobileOrTablet } from '../lib/device'
import { Button, SegmentedControl } from './ui'
import OverlayDialog from './ui/OverlayDialog'

interface ChordKeyboardProps {
  initialChord: string
  lyricContext?: string
  onSave: (newChord: string) => void
  onDelete: () => void
  onCancel: () => void
  onEditPosition?: () => void
}

const ROOT_NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

const SIMPLE_QUALITIES = [
  { label: 'Major', value: 'maj', desc: 'Clear quality' },
  { label: 'm', value: 'm', desc: 'minor' },
  { label: '7', value: '7', desc: 'dominant 7' },
  { label: 'm7', value: 'm7', desc: 'minor 7' },
  { label: 'sus4', value: 'sus4', desc: 'suspended 4' },
  { label: 'sus2', value: 'sus2', desc: 'suspended 2' },
  { label: 'add9', value: 'add9', desc: 'added 9' },
]

const ADVANCED_QUALITIES = [
  { label: 'Major', value: 'maj' },
  { label: 'm', value: 'm' },
  { label: '7', value: '7' },
  { label: 'm7', value: 'm7' },
  { label: 'maj7', value: 'maj7' },
  { label: 'sus4', value: 'sus4' },
  { label: 'sus2', value: 'sus2' },
  { label: '7sus4', value: '7sus4' },
  { label: 'add9', value: 'add9' },
  { label: '9', value: '9' },
  { label: 'm9', value: 'm9' },
  { label: 'maj9', value: 'maj9' },
  { label: '6', value: '6' },
  { label: 'm6', value: 'm6' },
  { label: '11', value: '11' },
  { label: '13', value: '13' },
  { label: 'dim', value: 'dim' },
  { label: 'dim7', value: 'dim7' },
  { label: 'aug', value: 'aug' },
  { label: '5', value: '5' },
  { label: 'N.C.', value: 'N.C.' },
]

export default function ChordKeyboard({
  initialChord,
  lyricContext,
  onSave,
  onDelete,
  onCancel,
  onEditPosition,
}: ChordKeyboardProps) {
  const [chord, setChord] = useState(initialChord)
  const [mode, setMode] = useState<'simple' | 'advanced'>('simple')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Only auto-focus on desktop devices with physical keyboards.
    // On mobile and iPad devices, auto-focusing summons the virtual on-screen keyboard,
    // which is unnecessary and obscures the custom chord selector.
    if (!isMobileOrTablet() && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [])

  const parsed = parseChordComponents(chord)
  const activeRoot = parsed?.root || ''
  const activeAccidental = parsed?.accidental || ''
  const activeQuality = parsed?.quality || ''

  const handleRootClick = (root: string) => {
    setChord((prev) => applyRoot(prev, root))
  }

  const handleAccidentalClick = (acc: '#' | 'b') => {
    setChord((prev) => applyAccidental(prev, acc))
  }

  const handleQualityClick = (q: string) => {
    if (q === 'N.C.') {
      setChord('N.C.')
      return
    }
    setChord((prev) => applyQuality(prev, q))
  }

  const handleSlashClick = () => {
    setChord((prev) => applySlash(prev))
  }

  const handleBackspace = () => {
    setChord((prev) => (prev ? prev.slice(0, -1) : ''))
  }

  const handleClear = () => {
    setChord('')
    if (!isMobileOrTablet()) {
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (chord.trim()) onSave(chord.trim())
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <OverlayDialog
      isOpen
      onClose={onCancel}
      title="Edit chord"
      description="Choose a root and quality, or type the chord directly."
      size="sm"
    >
      <div className="space-y-4 select-none">
        <SegmentedControl
          label="Chord editor detail"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'simple', label: 'Simple' },
            { value: 'advanced', label: 'Advanced' },
          ]}
        />

        {/* Lyric Context (if available) */}
        {lyricContext && (
          <div className="dark:text-ui-text-muted dark:bg-ui-surface-muted rounded-lg bg-neutral-100 p-2 font-mono text-xs text-neutral-600">
            <span className="dark:text-ui-text-muted mb-0.5 block font-sans text-[10px] font-semibold text-neutral-400 uppercase">
              Above Lyric
            </span>
            <span className="font-medium break-words">&ldquo;{lyricContext}&rdquo;</span>
          </div>
        )}

        {/* Live Chord Input Display */}
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={chord}
            onChange={(e) => setChord(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Chord (e.g. G, C#m7/G#)"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="dark:bg-ui-surface-muted dark:border-ui-border w-full rounded-xl border-2 border-neutral-300 bg-neutral-50 px-3 py-2.5 pr-10 text-center font-mono text-xl font-bold tracking-wider text-[#255283] focus:border-[#3368A0] focus:outline-none dark:text-amber-400 dark:focus:border-amber-500"
          />
          {chord && (
            <button
              type="button"
              onClick={handleClear}
              title="Clear chord"
              className="dark:text-ui-text-muted dark:hover:text-ui-text absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer p-1 text-xs text-neutral-400 hover:text-neutral-700"
            >
              ✕
            </button>
          )}
        </div>

        {/* Custom Musical Keyboard */}
        <div className="space-y-3 pt-1">
          {/* Row 1: Root Notes */}
          <div>
            <div className="dark:text-ui-text-muted mb-1 text-[10px] font-semibold text-neutral-400 uppercase">
              Root Note
            </div>
            <div className="grid grid-cols-7 gap-1">
              {ROOT_NOTES.map((note) => {
                const isActive = activeRoot === note
                return (
                  <button
                    key={note}
                    type="button"
                    onClick={() => handleRootClick(note)}
                    className={`cursor-pointer rounded-lg border py-2 text-sm font-bold transition-all active:scale-95 ${
                      isActive
                        ? 'border-[#3368A0] bg-[#3368A0] text-white shadow-xs dark:border-amber-500 dark:bg-amber-500 dark:text-black'
                        : 'dark:bg-ui-surface-raised dark:text-ui-text dark:border-ui-border dark:hover:bg-ui-text/10 border-neutral-200 bg-neutral-100 text-neutral-800 hover:bg-neutral-200'
                    }`}
                  >
                    {note}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Row 2: Accidentals, Bass Slash, Backspace */}
          <div>
            <div className="dark:text-ui-text-muted mb-1 text-[10px] font-semibold text-neutral-400 uppercase">
              Accidentals & Modifiers
            </div>
            <div className="grid grid-cols-4 gap-1.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => handleAccidentalClick('#')}
                className={`flex cursor-pointer items-center justify-center gap-1 rounded-lg border py-2 transition-all active:scale-95 ${
                  activeAccidental === '#'
                    ? 'border-[#3368A0] bg-[#3368A0] text-white dark:border-amber-500 dark:bg-amber-500 dark:text-black'
                    : 'dark:bg-ui-surface-raised dark:text-ui-text dark:border-ui-border dark:hover:bg-ui-text/10 border-neutral-200 bg-neutral-100 text-neutral-800 hover:bg-neutral-200'
                }`}
              >
                <span>♯</span>
                <span>(#)</span>
              </button>

              <button
                type="button"
                onClick={() => handleAccidentalClick('b')}
                className={`flex cursor-pointer items-center justify-center gap-1 rounded-lg border py-2 transition-all active:scale-95 ${
                  activeAccidental === 'b'
                    ? 'border-[#3368A0] bg-[#3368A0] text-white dark:border-amber-500 dark:bg-amber-500 dark:text-black'
                    : 'dark:bg-ui-surface-raised dark:text-ui-text dark:border-ui-border dark:hover:bg-ui-text/10 border-neutral-200 bg-neutral-100 text-neutral-800 hover:bg-neutral-200'
                }`}
              >
                <span>♭</span>
                <span>(b)</span>
              </button>

              <button
                type="button"
                onClick={handleSlashClick}
                className={`flex cursor-pointer items-center justify-center gap-1 rounded-lg border py-2 transition-all active:scale-95 ${
                  chord.includes('/')
                    ? 'border-[#66A3BF]/50 bg-[#C8DFDB]/60 text-[#1c436b] dark:border-amber-500/50 dark:bg-amber-500/20 dark:text-amber-400'
                    : 'dark:bg-ui-surface-raised dark:text-ui-text dark:border-ui-border dark:hover:bg-ui-text/10 border-neutral-200 bg-neutral-100 text-neutral-800 hover:bg-neutral-200'
                }`}
                aria-label="Add bass note"
                title="Add bass note"
              >
                <span>/</span>
                <span className="text-[11px] font-normal">Bass</span>
              </button>

              <button
                type="button"
                onClick={handleBackspace}
                className="dark:bg-ui-surface-raised dark:text-ui-text dark:border-ui-border dark:hover:bg-ui-text/10 flex cursor-pointer items-center justify-center gap-1 rounded-lg border border-neutral-200 bg-neutral-100 py-2 text-neutral-700 transition-all hover:bg-neutral-200 active:scale-95"
                aria-label="Delete last character"
                title="Delete last character"
              >
                <span>⌫</span>
                <span className="text-[11px] font-normal">Del</span>
              </button>
            </div>
          </div>

          {/* Row 3: Chord Qualities */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="dark:text-ui-text-muted text-[10px] font-semibold text-neutral-400 uppercase">
                {mode === 'simple' ? 'Simple Qualities' : 'Advanced Qualities & Extensions'}
              </span>
              <span className="dark:text-ui-text-muted text-[10px] text-neutral-400">
                {mode === 'simple' ? 'Common types' : 'All extensions'}
              </span>
            </div>

            {mode === 'simple' ? (
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-4">
                {SIMPLE_QUALITIES.map((q) => {
                  const isCurrent =
                    q.value === 'maj' ? activeQuality === '' : activeQuality === q.value
                  return (
                    <button
                      key={q.value}
                      type="button"
                      onClick={() => handleQualityClick(q.value)}
                      className={`cursor-pointer rounded-lg border px-1 py-2 text-xs font-semibold transition-all active:scale-95 ${
                        isCurrent
                          ? 'border-[#3368A0] bg-[#3368A0] text-white dark:border-amber-500 dark:bg-amber-500 dark:text-black'
                          : 'dark:bg-ui-surface-raised dark:text-ui-text dark:border-ui-border dark:hover:bg-ui-text/10 border-neutral-200 bg-neutral-100 text-neutral-800 hover:bg-neutral-200'
                      }`}
                      title={q.desc}
                    >
                      {q.label}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="no-scrollbar grid max-h-40 grid-cols-4 gap-1.5 overflow-y-auto overscroll-contain pr-0.5 sm:grid-cols-5">
                {ADVANCED_QUALITIES.map((q) => {
                  const isCurrent =
                    q.value === 'maj' ? activeQuality === '' : activeQuality === q.value
                  return (
                    <button
                      key={q.value}
                      type="button"
                      onClick={() => handleQualityClick(q.value)}
                      className={`cursor-pointer truncate rounded-lg border px-1 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
                        isCurrent
                          ? 'border-[#3368A0] bg-[#3368A0] text-white dark:border-amber-500 dark:bg-amber-500 dark:text-black'
                          : 'dark:bg-ui-surface-raised dark:text-ui-text dark:border-ui-border dark:hover:bg-ui-text/10 border-neutral-200 bg-neutral-100 text-neutral-800 hover:bg-neutral-200'
                      }`}
                    >
                      {q.label}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Modal Action Buttons: Delete Chord, Edit Position, Cancel, Save */}
        <div className="dark:border-ui-border flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 pt-3">
          <div className="flex items-center gap-2">
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={onDelete}
              title="Cancel out / remove this chord"
            >
              Delete
            </Button>
            {onEditPosition && (
              <Button
                variant="secondary"
                size="sm"
                icon={<MoveHorizontal size={14} />}
                onClick={onEditPosition}
                title="Adjust chord position over lyrics"
              >
                Edit position
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!chord.trim()}
              onClick={() => onSave(chord.trim())}
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </OverlayDialog>
  )
}
