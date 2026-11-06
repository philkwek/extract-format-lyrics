import type { Session } from '../lib/sessionStore'
import { Button } from './ui'
import OverlayDialog from './ui/OverlayDialog'
import ShareSetPanel from './share/ShareSetPanel'

interface ShareModalProps {
  session: Session
  isOpen: boolean
  onClose: () => void
}

export default function ShareModal({ session, isOpen, onClose }: ShareModalProps) {
  if (!isOpen) return null

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Share “${session.name}”`}
      description="Send a copy of the set, or share it live."
      size="sm"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      }
    >
      <ShareSetPanel session={session} />
    </OverlayDialog>
  )
}
