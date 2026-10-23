import { AlertTriangle } from 'lucide-react'
import type { Session } from '../lib/sessionStore'
import type { SharedSetSnapshot, Song } from '../types/song'
import { Button, StatusBanner } from './ui'
import OverlayDialog from './ui/OverlayDialog'
import ShareSetLinkPanel from './share/ShareSetLinkPanel'
import ShareLyricsLinkPanel from './share/ShareLyricsLinkPanel'

interface ShareMenuModalProps {
  snapshot: SharedSetSnapshot | null
  snapshotError?: string | null
  session: Session
  songsData: Map<string, Song>
  isOpen: boolean
  onClose: () => void
}

export default function ShareMenuModal({
  snapshot,
  snapshotError,
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
      description="Share the full set with chords, or send everyone a lyrics-only link."
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
              Send the full chord sheet, including the set order, keys and musical edits.
            </p>
          </div>
          {snapshot ? (
            <ShareSetLinkPanel snapshot={snapshot} />
          ) : (
            <StatusBanner tone="error" icon={<AlertTriangle size={16} />}>
              {snapshotError || 'This set could not be prepared for sharing right now.'}
            </StatusBanner>
          )}
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
