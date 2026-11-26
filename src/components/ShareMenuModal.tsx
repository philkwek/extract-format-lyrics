import type { Session } from '../lib/sessionStore'
import type { Song } from '../types/song'
import { Button } from './ui'
import OverlayDialog from './ui/OverlayDialog'
import ShareSetPanel from './share/ShareSetPanel'
import ShareLyricsLinkPanel from './share/ShareLyricsLinkPanel'

interface ShareMenuModalProps {
  session: Session
  songsData: Map<string, Song>
  isOpen: boolean
  onClose: () => void
}

export default function ShareMenuModal({
  session,
  songsData,
  isOpen,
  onClose,
}: ShareMenuModalProps) {
  if (!isOpen) return null

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Share “${session.name}”`}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-6">
        <section className="space-y-3">
          <div>
            <h3 className="text-ui-text text-base font-bold">Share this entire set</h3>
            <p className="text-ui-text-muted text-sm">For other musicians to follow along your created set.</p>
          </div>
          <ShareSetPanel session={session} canShareLive={!session.liveSourceId} />
        </section>

        <ShareLyricsLinkPanel session={session} songsData={songsData} />
      </div>
    </OverlayDialog>
  )
}
