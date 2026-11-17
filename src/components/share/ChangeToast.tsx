import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button, IconButton, Toast } from '../ui'

export interface ChangeNote {
  text: string
  /** Set when the note is about something the viewer can open. */
  onShow?: () => void
  /** A single follow-up action, such as Undo. */
  action?: { label: string; run: () => void }
}

interface Props {
  note: ChangeNote | null
  onDismiss: () => void
  durationMs?: number
  /** Prefix such as "Host". Omit for a neutral notice. */
  label?: string
  icon?: ReactNode
  /** Shows a draining ring before the icon over this many milliseconds. */
  progressMs?: number
  /** Restarts the ring when this changes. */
  progressKey?: string | number
  /** Default true. Set false for a timed action that must not wait. */
  pauseOnHover?: boolean
  /** Default true. */
  dismissible?: boolean
}

/** A short note that tells someone a shared set changed. */
export default function ChangeToast({
  note,
  onDismiss,
  durationMs = 5000,
  label,
  icon,
  progressMs,
  progressKey,
  pauseOnHover = true,
  dismissible = true,
}: Props) {
  const [paused, setPaused] = useState(false)

  const close = useCallback(() => {
    setPaused(false)
    onDismiss()
  }, [onDismiss])

  useEffect(() => {
    if (!note || paused) return
    const timer = setTimeout(close, durationMs)
    return () => clearTimeout(timer)
  }, [note, paused, close, durationMs])

  const show = note?.onShow
  const action = note?.action
  return (
    <Toast
      open={note !== null}
      message={note ? (label ? `${label}: ${note.text}` : note.text) : ''}
      icon={icon}
      progressMs={progressMs}
      progressKey={progressKey}
      onPause={pauseOnHover ? () => setPaused(true) : undefined}
      onResume={pauseOnHover ? () => setPaused(false) : undefined}
      actions={
        <>
          {show && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                show()
                close()
              }}
            >
              Show
            </Button>
          )}
          {action && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                action.run()
                close()
              }}
            >
              {action.label}
            </Button>
          )}
          {dismissible && (
            <IconButton label="Dismiss" variant="ghost" onClick={close}>
              <X size={16} />
            </IconButton>
          )}
        </>
      }
    />
  )
}
