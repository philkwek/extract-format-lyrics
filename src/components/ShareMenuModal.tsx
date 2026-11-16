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
          Done
        </Button>
      }
    >
      <div className="space-y-6">
        <section className="space-y-3">
          <div>
            <h3 className="text-base font-bold text-ui-text">Share full set</h3>
            <p className="text-sm text-ui-text-muted">For other musicians</p>
          </div>
          <ShareSetPanel session={session} canShareLive={!session.liveSourceId} />
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="text-base font-bold text-ui-text">Share lyrics</h3>
            <p className="text-sm text-ui-text-muted">For people to follow along</p>
          </div>
          <ShareLyricsLinkPanel session={session} songsData={songsData} />
        </section>
      </div>
    </OverlayDialog>
  )
}
