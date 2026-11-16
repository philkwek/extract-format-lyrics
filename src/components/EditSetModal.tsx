import { useState } from 'react'
import { Link2, Search } from 'lucide-react'
import type { Session } from '../lib/sessionStore'
import { Button, SegmentedControl } from './ui'
import OverlayDialog from './ui/OverlayDialog'
import AddSongPastePanel from './editSet/AddSongPastePanel'
import AddSongSearchPanel from './editSet/AddSongSearchPanel'

type EditSetMode = 'search' | 'paste'

interface EditSetModalProps {
  isOpen: boolean
  onClose: () => void
  session: Session
  onSessionUpdated: (session: Session, firstNewIndex: number) => void | Promise<void>
}

export default function EditSetModal({
  isOpen,
  onClose,
  session,
  onSessionUpdated,
}: EditSetModalProps) {
  const [mode, setMode] = useState<EditSetMode>('search')

  if (!isOpen) return null

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Add song"
      description="Search for a song or paste links."
      size="lg"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        <div>
          <SegmentedControl
            label="Add song mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'search', label: 'Search', icon: <Search size={14} /> },
              { value: 'paste', label: 'Paste links', icon: <Link2 size={14} /> },
            ]}
          />
        </div>

        <div className={mode === 'search' ? '' : 'hidden'}>
          <AddSongSearchPanel
            sessionId={session.id}
            onSessionUpdated={onSessionUpdated}
          />
        </div>

        <div className={mode === 'paste' ? '' : 'hidden'}>
          <AddSongPastePanel
            sessionId={session.id}
            onSessionUpdated={onSessionUpdated}
          />
        </div>
      </div>
    </OverlayDialog>
  )
}
