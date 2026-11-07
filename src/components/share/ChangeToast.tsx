import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button, IconButton, Toast } from '../ui'

export interface ChangeNote {
  text: string
  /** Set when the note is about something the viewer can open. */
  onShow?: () => void
}

interface Props {
  note: ChangeNote | null
  onDismiss: () => void
  durationMs?: number
  /** Prefix such as "Host". Omit for a neutral notice. */
  label?: string
  icon?: ReactNode
}

/** A short note that tells someone a shared set changed. */
export default function ChangeToast({ note, onDismiss, durationMs = 5000, label, icon }: Props) {
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
  return (
    <Toast
      open={note !== null}
      message={note ? (label ? `${label}: ${note.text}` : note.text) : ''}
      icon={icon}
      onPause={() => setPaused(true)}
      onResume={() => setPaused(false)}
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
          <IconButton label="Dismiss" variant="ghost" onClick={close}>
            <X size={16} />
          </IconButton>
        </>
      }
    />
  )
}
