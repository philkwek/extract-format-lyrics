import { useCallback, useRef, useState, type ReactNode, type RefObject } from 'react'
import OverlayDialog from '../components/ui/OverlayDialog'
import { Button } from '../components/ui'
import { stopFollowing, type FollowController } from './liveFollow'
import type { Session } from './sessionStore'

interface Options {
  following: boolean
  sessionId: string | undefined
  controllerRef: RefObject<FollowController | null>
  /** Called with the stored set once following is off, before the action runs. */
  onStopped: (session: Session) => void
}

/** Asks before an edit turns a followed set into the follower's own copy. */
export function useFollowEditGuard({ following, sessionId, controllerRef, onStopped }: Options) {
  const [pending, setPending] = useState<(() => void) | null>(null)
  const openRef = useRef(false)

  const guard = useCallback(
    (action: () => void) => {
      if (!following) return action()
      openRef.current = true
      setPending(() => action)
    },
    [following],
  )

  const close = () => {
    openRef.current = false
    setPending(null)
  }

  const keepFollowing = () => {
    close()
    controllerRef.current?.flushDeferred()
  }

  const editMyCopy = async () => {
    const action = pending
    controllerRef.current?.dropDeferred()
    try {
      const stored = sessionId ? await stopFollowing(sessionId) : null
      if (stored) onStopped(stored)
    } finally {
      close()
    }
    action?.()
  }

  const dialog: ReactNode = (
    <OverlayDialog
      isOpen={pending !== null}
      onClose={keepFollowing}
      title="Make this your own copy?"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={keepFollowing}>
            Keep following
          </Button>
          <Button variant="primary" onClick={editMyCopy}>
            Edit my copy
          </Button>
        </>
      }
    >
      <p className="text-sm text-[var(--ui-text)]">
        Editing stops following the host&apos;s edits. You&apos;ll keep the set as it is now, and
        the host&apos;s later changes won&apos;t reach you. You can turn{' '}
        <strong>Follow Host Edits</strong> back on later, but that replaces your changes.
      </p>
    </OverlayDialog>
  )

  return { guard, dialog, isOpenRef: openRef }
}
