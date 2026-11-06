import { useCallback, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import OverlayDialog from '../components/ui/OverlayDialog'
import { Button } from '../components/ui'
import type { FollowController } from './liveFollow'
import { sessionPath, sessionStore } from './sessionStore'

interface Options {
  following: boolean
  sessionId: string | undefined
  controllerRef: RefObject<FollowController | null>
}

/** Asks before an edit to a live set, which makes a copy instead of changing the live set. */
export function useFollowEditGuard({ following, sessionId, controllerRef }: Options) {
  const navigate = useNavigate()
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

  const cancel = () => {
    close()
    controllerRef.current?.flushDeferred()
  }

  const makeCopy = async () => {
    controllerRef.current?.dropDeferred()
    try {
      const stored = sessionId ? await sessionStore.getSession(sessionId) : null
      if (stored) navigate(sessionPath(await sessionStore.createSetCopy(stored)))
    } finally {
      close()
    }
  }

  const dialog: ReactNode = (
    <OverlayDialog
      isOpen={pending !== null}
      onClose={cancel}
      title="Make your own copy?"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={makeCopy}>
            Make a copy
          </Button>
        </>
      }
    >
      <p className="text-sm text-[var(--ui-text)]">
        Editing a live set makes a copy of it that is yours to change. The live set stays as it is.
      </p>
    </OverlayDialog>
  )

  return { guard, dialog, isOpenRef: openRef, makeCopy }
}
