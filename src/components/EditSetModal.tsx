import { useCallback, useState } from 'react'
import { FileUp, Link2, Search } from 'lucide-react'
import type { Session } from '../lib/sessionStore'
import type { Song } from '../types/song'
import { Button, SegmentedControl } from './ui'
import OverlayDialog from './ui/OverlayDialog'
import AddSongPastePanel from './editSet/AddSongPastePanel'
import AddSongSearchPanel from './editSet/AddSongSearchPanel'
import UploadSheetModal from './UploadSheetModal'

type EditSetMode = 'search' | 'paste' | 'upload'

interface EditSetModalProps {
  isOpen: boolean
  onClose: () => void
  session: Session
  onSessionUpdated: (session: Session, firstNewIndex: number) => void | Promise<void>
  onImportUploadedSongs: (songs: Song[]) => void | Promise<void>
}

export default function EditSetModal({
  isOpen,
  onClose,
  session,
  onSessionUpdated,
  onImportUploadedSongs,
}: EditSetModalProps) {
  const [mode, setMode] = useState<EditSetMode>('search')
  const [isReviewingUpload, setIsReviewingUpload] = useState(false)
  const handleUploadReviewChange = useCallback((isReviewing: boolean) => {
    setIsReviewingUpload(isReviewing)
  }, [])

  if (!isOpen) return null

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Add song"
      description="Search for a song, paste links, or upload a chord sheet."
      size="lg"
      className={mode === 'upload' && isReviewingUpload ? 'h-[88dvh]' : ''}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Done
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
              { value: 'upload', label: 'Upload sheet', icon: <FileUp size={14} /> },
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

        <div className={mode === 'upload' ? '' : 'hidden'}>
          <UploadSheetModal
            inline
            isOpen={isOpen}
            onClose={onClose}
            onImport={onImportUploadedSongs}
            onReviewChange={handleUploadReviewChange}
          />
        </div>
      </div>
    </OverlayDialog>
  )
}
