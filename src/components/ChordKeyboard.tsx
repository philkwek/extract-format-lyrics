import { useState, useRef, useEffect } from 'react'
import {
  parseChordComponents,
  applyRoot,
  applyAccidental,
  applyQuality,
  applySlash,
} from '../lib/chordEdit'
import { isMobileOrTablet } from '../lib/device'

interface ChordKeyboardProps {
  initialChord: string
  lyricContext?: string
  onSave: (newChord: string) => void
  onDelete: () => void
  onCancel: () => void
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
      onSave(chord.trim())
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs overflow-y-auto"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-[#1a1a1a] border border-neutral-300 dark:border-[#282828] rounded-2xl shadow-2xl p-4 sm:p-5 w-full max-w-md space-y-4 my-auto select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Title, Mode Switcher, and Close button */}
        <div className="flex items-center justify-between pb-2 border-b border-neutral-200 dark:border-[#282828]">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-neutral-900 dark:text-[#e5e5e5]">
              Edit Chord
            </h3>
            {/* Simple / Advanced Mode Pill */}
            <div className="flex bg-neutral-100 dark:bg-[#101010] p-0.5 rounded-lg border border-neutral-200 dark:border-[#282828] text-xs">
              <button
                type="button"
                onClick={() => setMode('simple')}
                className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
                  mode === 'simple'
                    ? 'bg-[#3368A0] text-white font-semibold dark:bg-amber-500 dark:text-black'
                    : 'text-neutral-600 dark:text-[#999999] hover:text-neutral-900 dark:hover:text-[#e5e5e5]'
                }`}
              >
                Simple
              </button>
              <button
                type="button"
                onClick={() => setMode('advanced')}
                className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
                  mode === 'advanced'
                    ? 'bg-[#3368A0] text-white font-semibold dark:bg-amber-500 dark:text-black'
                    : 'text-neutral-600 dark:text-[#999999] hover:text-neutral-900 dark:hover:text-[#e5e5e5]'
                }`}
              >
                Advanced
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-neutral-400 hover:text-neutral-700 dark:text-[#999999] dark:hover:text-[#e5e5e5] text-base p-1 leading-none cursor-pointer"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Lyric Context (if available) */}
        {lyricContext && (
          <div className="text-xs text-neutral-600 dark:text-[#999999] font-mono bg-neutral-100 dark:bg-[#101010] p-2 rounded-lg">
            <span className="text-neutral-400 dark:text-[#777777] block text-[10px] uppercase font-sans font-semibold mb-0.5">
              Above Lyric
            </span>
            <span className="break-words font-medium">&ldquo;{lyricContext}&rdquo;</span>
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
            className="w-full font-mono text-xl font-bold text-[#255283] dark:text-amber-400 bg-neutral-50 dark:bg-[#101010] border-2 border-neutral-300 dark:border-[#282828] focus:border-[#3368A0] dark:focus:border-amber-500 focus:outline-none rounded-xl px-3 py-2.5 pr-10 text-center tracking-wider"
          />
          {chord && (
            <button
              type="button"
              onClick={handleClear}
              title="Clear chord"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 dark:text-[#777777] dark:hover:text-[#e5e5e5] p-1 text-xs cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        {/* Custom Musical Keyboard */}
        <div className="space-y-3 pt-1">
          {/* Row 1: Root Notes */}
          <div>
            <div className="text-[10px] uppercase font-semibold text-neutral-400 dark:text-[#777777] mb-1">
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
                    className={`py-2 text-sm font-bold rounded-lg transition-all active:scale-95 cursor-pointer border ${
                      isActive
                        ? 'bg-[#3368A0] text-white border-[#3368A0] shadow-xs dark:bg-amber-500 dark:text-black dark:border-amber-500'
                        : 'bg-neutral-100 dark:bg-[#202020] text-neutral-800 dark:text-[#e5e5e5] border-neutral-200 dark:border-[#2e2e2e] hover:bg-neutral-200 dark:hover:bg-[#2a2a2a]'
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
            <div className="text-[10px] uppercase font-semibold text-neutral-400 dark:text-[#777777] mb-1">
              Accidentals & Modifiers
            </div>
            <div className="grid grid-cols-4 gap-1.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => handleAccidentalClick('#')}
                className={`py-2 rounded-lg transition-all active:scale-95 cursor-pointer border flex items-center justify-center gap-1 ${
                  activeAccidental === '#'
                    ? 'bg-[#3368A0] text-white border-[#3368A0] dark:bg-amber-500 dark:text-black dark:border-amber-500'
                    : 'bg-neutral-100 dark:bg-[#202020] text-neutral-800 dark:text-[#e5e5e5] border-neutral-200 dark:border-[#2e2e2e] hover:bg-neutral-200 dark:hover:bg-[#2a2a2a]'
                }`}
              >
                <span>♯</span>
                <span>(#)</span>
              </button>

              <button
                type="button"
                onClick={() => handleAccidentalClick('b')}
                className={`py-2 rounded-lg transition-all active:scale-95 cursor-pointer border flex items-center justify-center gap-1 ${
                  activeAccidental === 'b'
                    ? 'bg-[#3368A0] text-white border-[#3368A0] dark:bg-amber-500 dark:text-black dark:border-amber-500'
                    : 'bg-neutral-100 dark:bg-[#202020] text-neutral-800 dark:text-[#e5e5e5] border-neutral-200 dark:border-[#2e2e2e] hover:bg-neutral-200 dark:hover:bg-[#2a2a2a]'
                }`}
              >
                <span>♭</span>
                <span>(b)</span>
              </button>

              <button
                type="button"
                onClick={handleSlashClick}
                className={`py-2 rounded-lg transition-all active:scale-95 cursor-pointer border flex items-center justify-center gap-1 ${
                  chord.includes('/')
                    ? 'bg-[#C8DFDB]/60 text-[#1c436b] border-[#66A3BF]/50 dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-500/50'
                    : 'bg-neutral-100 dark:bg-[#202020] text-neutral-800 dark:text-[#e5e5e5] border-neutral-200 dark:border-[#2e2e2e] hover:bg-neutral-200 dark:hover:bg-[#2a2a2a]'
                }`}
                title="Add slash chord bass note"
              >
                <span>/</span>
                <span className="text-[11px] font-normal">Bass</span>
              </button>

              <button
                type="button"
                onClick={handleBackspace}
                className="py-2 bg-neutral-100 dark:bg-[#202020] text-neutral-700 dark:text-[#d4d4d4] border border-neutral-200 dark:border-[#2e2e2e] hover:bg-neutral-200 dark:hover:bg-[#2a2a2a] rounded-lg transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1"
                title="Backspace"
              >
                <span>⌫</span>
                <span className="text-[11px] font-normal">Del</span>
              </button>
            </div>
          </div>

          {/* Row 3: Chord Qualities */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase font-semibold text-neutral-400 dark:text-[#777777]">
                {mode === 'simple' ? 'Simple Qualities' : 'Advanced Qualities & Extensions'}
              </span>
              <span className="text-[10px] text-neutral-400 dark:text-[#777777]">
                {mode === 'simple' ? 'Common types' : 'All extensions'}
              </span>
            </div>

            {mode === 'simple' ? (
              <div className="grid grid-cols-4 sm:grid-cols-4 gap-1.5">
                {SIMPLE_QUALITIES.map((q) => {
                  const isCurrent =
                    q.value === 'maj' ? activeQuality === '' : activeQuality === q.value
                  return (
                    <button
                      key={q.value}
                      type="button"
                      onClick={() => handleQualityClick(q.value)}
                      className={`py-2 px-1 text-xs font-semibold rounded-lg transition-all active:scale-95 cursor-pointer border ${
                        isCurrent
                          ? 'bg-[#3368A0] text-white border-[#3368A0] dark:bg-amber-500 dark:text-black dark:border-amber-500'
                          : 'bg-neutral-100 dark:bg-[#202020] text-neutral-800 dark:text-[#e5e5e5] border-neutral-200 dark:border-[#2e2e2e] hover:bg-neutral-200 dark:hover:bg-[#2a2a2a]'
                      }`}
                      title={q.desc}
                    >
                      {q.label}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5 max-h-40 overflow-y-auto pr-0.5 no-scrollbar">
                {ADVANCED_QUALITIES.map((q) => {
                  const isCurrent =
                    q.value === 'maj' ? activeQuality === '' : activeQuality === q.value
                  return (
                    <button
                      key={q.value}
                      type="button"
                      onClick={() => handleQualityClick(q.value)}
                      className={`py-1.5 px-1 text-xs font-semibold rounded-lg transition-all active:scale-95 cursor-pointer border truncate ${
                        isCurrent
                          ? 'bg-[#3368A0] text-white border-[#3368A0] dark:bg-amber-500 dark:text-black dark:border-amber-500'
                          : 'bg-neutral-100 dark:bg-[#202020] text-neutral-800 dark:text-[#e5e5e5] border-neutral-200 dark:border-[#2e2e2e] hover:bg-neutral-200 dark:hover:bg-[#2a2a2a]'
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

        {/* Modal Action Buttons: Delete Chord, Cancel, Save */}
        <div className="flex items-center justify-between pt-3 border-t border-neutral-200 dark:border-[#282828]">
          <button
            type="button"
            onClick={onDelete}
            className="text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 px-3 py-2 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5"
            title="Cancel out / remove this chord"
          >
            <span>🗑️</span>
            <span>Delete chord</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="text-xs text-neutral-600 dark:text-[#999999] hover:bg-neutral-100 dark:hover:bg-[#252525] px-3.5 py-2 rounded-lg font-medium transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSave(chord.trim())}
              className="text-xs bg-[#3368A0] hover:bg-[#255283] text-white font-semibold px-4 py-2 rounded-lg transition-colors cursor-pointer dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-black"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
