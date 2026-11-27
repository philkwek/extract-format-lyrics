import { useState } from 'react'
import { createPortal } from 'react-dom'
import { resolveConflict } from '../lib/accountSync'
import type { ClashDiff } from '../lib/setMerge'
import OverlayDialog from './ui/OverlayDialog'
import { Button, StatusBanner } from './ui'

export interface SyncConflictDialogProps {
  isOpen: boolean
  sessionId: string
  diffs: ClashDiff[]
  onClose: () => void
}

export default function SyncConflictDialog({
  isOpen,
  sessionId,
  diffs,
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

  const seenDiffs = new Set<string>()
  const uniqueDiffs = diffs.filter((diff) => {
    const key = `${diff.label}|${diff.local}|${diff.remote}`
    if (seenDiffs.has(key)) return false
    seenDiffs.add(key)
    return true
  })

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
      {uniqueDiffs.length > 0 && (
        <div className="mt-4 space-y-3">
          {uniqueDiffs.map((diff) => (
            <div key={`${diff.label}|${diff.local}|${diff.remote}`}>
              <h3 className="text-ui-text mb-1.5 text-sm font-semibold">{diff.label}</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="ui-diff-local rounded-xl px-3 py-2">
                  <p className="text-[11px] font-medium opacity-75">This device</p>
                  <p className="mt-0.5 text-sm font-semibold break-words whitespace-pre-line">
                    {diff.local}
                  </p>
                </div>
                <div className="ui-diff-remote rounded-xl px-3 py-2">
                  <p className="text-[11px] font-medium opacity-75">Cloud version</p>
                  <p className="mt-0.5 text-sm font-semibold break-words whitespace-pre-line">
                    {diff.remote}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {error && (
        <StatusBanner tone="error" className="mt-3">
          {error}
        </StatusBanner>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          className="ui-button--diff-local"
          disabled={choice !== null}
          loading={choice === 'keep-local'}
          onClick={() => void choose('keep-local')}
        >
          Keep this device
        </Button>
        <Button
          variant="secondary"
          className="ui-button--diff-remote"
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
