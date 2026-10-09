import { useEffect } from 'react'

interface ChordPositionToolbarProps {
  chord: string
  onNudgeLeft: () => void
  onNudgeRight: () => void
  onSave: () => void
  onCancel: () => void
}

export default function ChordPositionToolbar({
  chord,
  onNudgeLeft,
  onNudgeRight,
  onSave,
  onCancel,
}: ChordPositionToolbarProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if an input or textarea is currently focused
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onNudgeLeft()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onNudgeRight()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onSave()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onNudgeLeft, onNudgeRight, onSave, onCancel])

  return (
    <div
      role="region"
      aria-label="Chord position adjustment"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-[92vw] w-auto animate-in fade-in slide-in-from-bottom-3 duration-200"
    >
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-white/95 dark:bg-[#1c1c1c]/95 backdrop-blur-md border border-[#C8DFDB] dark:border-[#2e2e2e] shadow-2xl flex-wrap justify-center">
        {/* Chord info badge */}
        <div className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-[#a0a0a0] font-medium whitespace-nowrap">
          <span>Positioning</span>
          <span className="font-mono font-bold text-[#255283] dark:text-amber-400 bg-neutral-100 dark:bg-[#282828] px-2 py-0.5 rounded border border-[#C8DFDB]/60 dark:border-[#383838]">
            {chord}
          </span>
        </div>

        {/* Nudge buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onNudgeLeft}
            aria-label="Nudge chord left"
            title="Move left (Left Arrow)"
            className="w-10 h-8 rounded-lg border border-[#C8DFDB] dark:border-[#2e2e2e] text-sm font-bold text-neutral-800 dark:text-[#e5e5e5] bg-neutral-50 dark:bg-[#222222] hover:bg-neutral-100 dark:hover:bg-[#2a2a2a] active:scale-95 transition cursor-pointer select-none flex items-center justify-center shadow-2xs"
          >
            &lt;
          </button>
          <button
            type="button"
            onClick={onNudgeRight}
            aria-label="Nudge chord right"
            title="Move right (Right Arrow)"
            className="w-10 h-8 rounded-lg border border-[#C8DFDB] dark:border-[#2e2e2e] text-sm font-bold text-neutral-800 dark:text-[#e5e5e5] bg-neutral-50 dark:bg-[#222222] hover:bg-neutral-100 dark:hover:bg-[#2a2a2a] active:scale-95 transition cursor-pointer select-none flex items-center justify-center shadow-2xs"
          >
            &gt;
          </button>
        </div>

        {/* Divider */}
        <div className="h-5 w-px bg-neutral-200 dark:bg-[#2e2e2e] hidden sm:block" />

        {/* Action buttons: Cancel & Save Changes */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            title="Discard position changes (Esc)"
            className="text-xs text-neutral-600 dark:text-[#999999] hover:bg-neutral-100 dark:hover:bg-[#252525] px-3 py-1.5 rounded-lg font-medium transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            title="Save changes to setlist (Enter)"
            className="text-xs font-semibold px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer bg-[#3368A0] hover:bg-[#255283] text-white dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-black shadow-xs flex items-center gap-1.5"
          >
            <span>✓</span>
            <span>Save Changes</span>
          </button>
        </div>
      </div>
    </div>
  )
}
