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
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-ui-surface-raised/95 backdrop-blur-md border border-ui-border shadow-2xl flex-wrap justify-center">
        {/* Chord info badge */}
        <div className="flex items-center gap-1.5 text-xs text-ui-text-muted font-medium whitespace-nowrap">
          <span>Positioning</span>
          <span className="font-mono font-bold text-ui-accent-strong bg-ui-surface-muted px-2 py-0.5 rounded border border-ui-border">
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
        <div className="h-5 w-px bg-ui-border hidden sm:block" />

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
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  )
}
