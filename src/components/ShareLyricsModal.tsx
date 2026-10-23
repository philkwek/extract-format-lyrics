import type { Session } from '../lib/sessionStore'
import type { Song } from '../types/song'
import { Button } from './ui'
import OverlayDialog from './ui/OverlayDialog'
import ShareLyricsLinkPanel from './share/ShareLyricsLinkPanel'

export interface ShareLyricsModalProps {
  session: Session
  songsData: Map<string, Song>
  isOpen: boolean
  onClose: () => void
}

export default function ShareLyricsModal({
  session,
  songsData,
  isOpen,
  onClose,
}: ShareLyricsModalProps) {
  if (!isOpen) return null

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Share lyrics for “${session.name}”`}
      description={`Create a stable, reusable link for ${session.songs.length} song${
        session.songs.length === 1 ? '' : 's'
      }. Lyric text and section order are included without chords.`}
      size="sm"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      }
    >
      <ShareLyricsLinkPanel session={session} songsData={songsData} />
    </OverlayDialog>
  )
}
