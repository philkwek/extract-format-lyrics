import { useCallback, useEffect, useState } from 'react'
import { Radio, X } from 'lucide-react'
import { Button, IconButton, Toast } from '../ui'

export interface HostNote {
  text: string
  /** Set when the note is about a song other than the one on screen. */
  onShow?: () => void
}

interface Props {
  note: HostNote | null
  onDismiss: () => void
  durationMs?: number
}

/** Tells someone following a live set what the host just changed. */
export default function HostChangeToast({ note, onDismiss, durationMs = 5000 }: Props) {
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
      message={note ? `Host: ${note.text}` : ''}
      icon={<Radio size={16} className="text-emerald-700 dark:text-emerald-400" />}
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
