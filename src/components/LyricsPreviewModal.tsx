import type { SharedLyricsPayload } from '../types/song'
import OverlayDialog from './ui/OverlayDialog'
import LyricsViewerContent from './LyricsViewerContent'
import { Button } from './ui'

export interface LyricsPreviewModalProps {
  isOpen: boolean
  onClose: () => void
  payload: SharedLyricsPayload | null
}

export default function LyricsPreviewModal({
  isOpen,
  onClose,
  payload,
}: LyricsPreviewModalProps) {
  if (!isOpen || !payload) return null

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title={`(Preview) ${payload.name}`}
      description="Preview of how vocalists and musicians will see these lyrics. Chords are excluded."
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close Preview
        </Button>
      }
    >
      <div className="max-h-[72vh] overflow-y-auto px-1 py-2">
        <LyricsViewerContent songs={payload.songs} />
      </div>
    </OverlayDialog>
  )
}
