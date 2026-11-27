import { useState } from 'react'
import { createPortal } from 'react-dom'
import { resolveConflict } from '../lib/accountSync'
import OverlayDialog from './ui/OverlayDialog'
import { Button, StatusBanner } from './ui'

export interface SyncConflictDialogProps {
  isOpen: boolean
  sessionId: string
  clashes: string[]
  onClose: () => void
}

export default function SyncConflictDialog({
  isOpen,
  sessionId,
  clashes,
  onClose,
}: SyncConflictDialogProps) {
  const [choice, setChoice] = useState<'keep-local' | 'use-remote' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function choose(next: 'keep-local' | 'use-remote') {
    setChoice(next)
    setError(null)
    try {
      await resolveConflict(sessionId, next)
      onClose()
    } catch {
      setError("Couldn't update the set. Try again.")
    } finally {
      setChoice(null)
    }
  }

  const uniqueClashes = [...new Set(clashes)]

  return createPortal(
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Choose which version to keep"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <p className="text-ui-text text-sm">
        This set changed in two places. Pick one version; the other is replaced.
      </p>
      {uniqueClashes.length > 0 && (
        <ul className="text-ui-text-muted mt-3 list-disc space-y-1 pl-5 text-sm">
          {uniqueClashes.map((clash, index) => (
            <li key={`${clash}-${index}`}>{clash}</li>
          ))}
        </ul>
      )}
      {error && (
        <StatusBanner tone="error" className="mt-3">
          {error}
        </StatusBanner>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          disabled={choice !== null}
          loading={choice === 'keep-local'}
          onClick={() => void choose('keep-local')}
        >
          Keep this device
        </Button>
        <Button
          variant="primary"
          disabled={choice !== null}
          loading={choice === 'use-remote'}
          onClick={() => void choose('use-remote')}
        >
          Use cloud version
        </Button>
      </div>
    </OverlayDialog>,
    document.body,
  )
}
