import { useEffect } from 'react'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, IconButton } from './ui'

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
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      ) {
        return
      }
      if (target?.tagName === 'BUTTON' && e.key === 'Enter') {
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
      className="animate-in fade-in slide-in-from-bottom-3 fixed bottom-6 left-1/2 z-40 w-auto max-w-[92vw] -translate-x-1/2 duration-200"
    >
      <div className="bg-ui-surface-raised/95 border-ui-border flex flex-wrap items-center justify-center gap-3 rounded-2xl border px-4 py-2.5 shadow-2xl backdrop-blur-md">
        {/* Chord info badge */}
        <div className="text-ui-text-muted flex items-center gap-1.5 text-xs font-medium whitespace-nowrap">
          <span>Positioning</span>
          <span className="text-ui-accent-strong bg-ui-surface-muted border-ui-border rounded border px-2 py-0.5 font-mono font-bold">
            {chord}
          </span>
        </div>

        {/* Nudge buttons */}
        <div className="flex items-center gap-1.5">
          <IconButton
            label="Nudge chord left"
            variant="secondary"
            title="Move left (Left Arrow)"
            onClick={onNudgeLeft}
          >
            <ChevronLeft size={16} />
          </IconButton>
          <IconButton
            label="Nudge chord right"
            variant="secondary"
            title="Move right (Right Arrow)"
            onClick={onNudgeRight}
          >
            <ChevronRight size={16} />
          </IconButton>
        </div>

        {/* Divider */}
        <div className="bg-ui-border hidden h-5 w-px sm:block" />

        {/* Action buttons: Cancel & Save Changes */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            title="Discard position changes (Esc)"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onSave}
            title="Save changes to setlist (Enter)"
            icon={<Check size={14} />}
          >
            Save changes
          </Button>
        </div>
      </div>
    </div>
  )
}
