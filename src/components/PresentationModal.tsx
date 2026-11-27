import { useState } from 'react'
import { AppWindow, Check, Copy, Monitor } from 'lucide-react'
import type { Session } from '../lib/sessionStore'
import type { Song } from '../types/song'
import { Button } from './ui'
import OverlayDialog from './ui/OverlayDialog'
import { useLyricsPublication } from './share/useLyricsPublication'

interface PresentationModalProps {
  session: Session
  songsData: Map<string, Song>
  isOpen: boolean
  onClose: () => void
}

export default function PresentationModal({
  session,
  songsData,
  isOpen,
  onClose,
}: PresentationModalProps) {
  const [presenterCopied, setPresenterCopied] = useState(false)
  const { publicationId, isPublished, isSaving, initialized, error, setError, publish } =
    useLyricsPublication(session, songsData)

  if (!isOpen) return null

  const presenterUrl = (id: string) => `${window.location.origin}/present/${id}`

  const handleCopyPresenter = async () => {
    setError(null)
    let id = isPublished ? publicationId : null
    if (!id) {
      const result = await publish('Failed to publish lyrics')
      if (!result) return
      id = result.id
    }
    const url = presenterUrl(id)
    try {
      await navigator.clipboard.writeText(url)
      setPresenterCopied(true)
      setTimeout(() => setPresenterCopied(false), 2500)
    } catch {
      window.prompt('Copy this presenter link:', url)
    }
  }

  const handleOpenPresenter = async () => {
    setError(null)
    const features = 'popup,width=1280,height=720'
    if (isPublished && publicationId) {
      window.open(presenterUrl(publicationId), '_blank', features)
      return
    }
    // Opened before publishing so the click still counts as a user gesture.
    const win = window.open('', '_blank', features)
    const result = await publish('Failed to publish lyrics')
    if (!result) {
      win?.close()
      return
    }
    const url = presenterUrl(result.id)
    if (win) win.location.href = url
    else window.open(url, '_blank', features)
  }

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Start presentation mode for lyrics"
      description="Just like a PowerPoint presentation."
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-2">
        <div className="divide-ui-border grid grid-cols-1 divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <div className="flex flex-col pb-4 sm:pr-4 sm:pb-0">
            <AppWindow
              size={18}
              className="text-ui-accent mb-2.5 shrink-0"
              aria-hidden="true"
            />
            <p className="text-ui-text text-sm font-bold">Present on this device</p>
            <p className="text-ui-text-muted mt-1 flex-1 text-xs leading-5">
              Drag the new window into your 2nd display. It automatically presents the lyrics of your currently selected song.
            </p>
            <Button
              variant="primary"
              className="mt-3 w-full"
              icon={<AppWindow size={16} />}
              onClick={handleOpenPresenter}
              disabled={isSaving || !initialized}
            >
              Open presenter window
            </Button>
          </div>

          <div className="flex flex-col pt-4 sm:pt-0 sm:pl-4">
            <Monitor
              size={18}
              className="text-ui-accent mb-2.5 shrink-0"
              aria-hidden="true"
            />
            <p className="text-ui-text text-sm font-bold">Present from a different laptop</p>
            <p className="text-ui-text-muted mt-1 flex-1 text-xs leading-5">
              Copy the link and open it on your 2nd device.
            </p>
            <Button
              variant="secondary"
              className="mt-3 w-full"
              icon={presenterCopied ? <Check size={15} /> : <Copy size={15} />}
              onClick={handleCopyPresenter}
              disabled={isSaving || !initialized}
            >
              {presenterCopied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-[11px] text-red-600 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
    </OverlayDialog>
  )
}
