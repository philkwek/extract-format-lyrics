import type { SharedSetSnapshot } from '../types/song'
import { Button } from './ui'
import OverlayDialog from './ui/OverlayDialog'
import ShareSetLinkPanel from './share/ShareSetLinkPanel'

interface ShareModalProps {
  snapshot: SharedSetSnapshot
  isOpen: boolean
  onClose: () => void
}

export default function ShareModal({ snapshot, isOpen, onClose }: ShareModalProps) {
  if (!isOpen) return null

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Share “${snapshot.name}”`}
      description={`Create a private snapshot link for ${snapshot.songs.length} song${
        snapshot.songs.length === 1 ? '' : 's'
      }. Musical edits and transpositions are included.`}
      size="sm"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      }
    >
      <ShareSetLinkPanel snapshot={snapshot} />
    </OverlayDialog>
  )
}
