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
      description="Send a copy of the set, share it live, or send a lyrics-only link."
      size="lg"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] p-4">
          <div>
            <h3 className="text-sm font-bold text-[var(--ui-text)]">Share this set</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--ui-text-muted)]">
              Send a copy, or let people follow your changes live.
            </p>
          </div>
          <ShareSetPanel session={session} />
        </section>

        <section className="space-y-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] p-4">
          <div>
            <h3 className="text-sm font-bold text-[var(--ui-text)]">Share lyrics</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--ui-text-muted)]">
              Send a lyrics-only view with song tabs and no chords. The link can be updated later.
            </p>
          </div>
          <ShareLyricsLinkPanel session={session} songsData={songsData} />
        </section>
      </div>
    </OverlayDialog>
  )
}
