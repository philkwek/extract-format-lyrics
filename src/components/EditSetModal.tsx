import { useCallback, useState } from 'react'
import { FileUp, Link2, ListOrdered, Search } from 'lucide-react'
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
  onArrange: () => void
  onSessionUpdated: (session: Session, firstNewIndex: number) => void | Promise<void>
  onImportUploadedSongs: (songs: Song[]) => void | Promise<void>
}

export default function EditSetModal({
  isOpen,
  onClose,
  session,
  onArrange,
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
      title="Edit set"
      description="Arrange the setlist, add a song, or upload a chord sheet."
      size="lg"
      className={mode === 'upload' && isReviewingUpload ? 'h-[88dvh]' : ''}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SegmentedControl
            label="Edit set mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'search', label: 'Search', icon: <Search size={14} /> },
              { value: 'paste', label: 'Paste links', icon: <Link2 size={14} /> },
              { value: 'upload', label: 'Upload sheet', icon: <FileUp size={14} /> },
            ]}
          />
          <Button
            variant="secondary"
            icon={<ListOrdered size={14} />}
            onClick={onArrange}
          >
            Arrange setlist
          </Button>
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
