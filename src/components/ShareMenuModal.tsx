import { useState } from 'react'
import type { Session } from '../lib/sessionStore'
import type { Song } from '../types/song'
import { Button, SegmentedControl } from './ui'
import OverlayDialog from './ui/OverlayDialog'
import ShareSetPanel from './share/ShareSetPanel'
import ShareLyricsLinkPanel from './share/ShareLyricsLinkPanel'

interface ShareMenuModalProps {
  session: Session
  songsData: Map<string, Song>
  isOpen: boolean
  onClose: () => void
}

type ShareTab = 'set' | 'lyrics'

export default function ShareMenuModal({
  session,
  songsData,
  isOpen,
  onClose,
}: ShareMenuModalProps) {
  const [tab, setTab] = useState<ShareTab>('set')
  const [setActive, setSetActive] = useState(false)
  const [lyricsActive, setLyricsActive] = useState(false)

  if (!isOpen) return null
  const isFollowed = Boolean(session.liveSourceId)

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
      <div className="space-y-3">
        <SegmentedControl
          className="w-full"
          label="What to share"
          idPrefix="share-tabs"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'set', label: setActive ? 'Full set · On' : 'Full set' },
            { value: 'lyrics', label: lyricsActive ? 'Lyrics only · On' : 'Lyrics only' },
          ]}
        />

        <div
          role="tabpanel"
          id="share-tabs-panel-set"
          aria-labelledby="share-tabs-tab-set"
          hidden={tab !== 'set'}
          className="space-y-3"
        >
          <p className="text-xs leading-5 text-[var(--ui-text-muted)]">
            {isFollowed
              ? 'Copy the live link or make your own copy.'
              : 'Chords, keys and sections for the whole band.'}
          </p>
          <ShareSetPanel
            session={session}
            canShareLive={!session.liveSourceId}
            onActiveChange={setSetActive}
          />
        </div>

        <div
          role="tabpanel"
          id="share-tabs-panel-lyrics"
          aria-labelledby="share-tabs-tab-lyrics"
          hidden={tab !== 'lyrics'}
          className="space-y-3"
        >
          <p className="text-xs leading-5 text-[var(--ui-text-muted)]">
            Words only, no chords. Changes you make update it automatically.
          </p>
          <ShareLyricsLinkPanel
            session={session}
            songsData={songsData}
            onActiveChange={setLyricsActive}
          />
        </div>
      </div>
    </OverlayDialog>
  )
}
