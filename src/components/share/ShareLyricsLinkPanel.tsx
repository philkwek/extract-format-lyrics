import { useState } from 'react'
import { Check, Copy, Eye, Link2 } from 'lucide-react'
import type { Session } from '../../lib/sessionStore'
import type { SharedLyricsPayload, Song } from '../../types/song'
import { buildSharedLyricsPayload, ShareLyricsError } from '../../lib/exportLyrics'
import { Button, IconButton } from '../ui'
import LyricsPreviewModal from '../LyricsPreviewModal'
import { useLyricsPublication } from './useLyricsPublication'

interface ShareLyricsLinkPanelProps {
  session: Session
  songsData: Map<string, Song>
}

export default function ShareLyricsLinkPanel({ session, songsData }: ShareLyricsLinkPanelProps) {
  const [copied, setCopied] = useState(false)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewPayload, setPreviewPayload] = useState<SharedLyricsPayload | null>(null)
  const { shareUrl, expiresAt, isPublished, isSaving, initialized, error, setError, publish } =
    useLyricsPublication(session, songsData)

  const handleCopy = async () => {
    try {
      if (!shareUrl) return
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      window.prompt('Copy this lyrics link:', shareUrl || '')
    }
  }

  const handleOpenPreview = () => {
    setError(null)
    try {
      const payload = buildSharedLyricsPayload(session, songsData)
      setPreviewPayload(payload)
      setIsPreviewOpen(true)
    } catch (err) {
      const message =
        err instanceof ShareLyricsError
          ? err.message
          : (err as Error).message || 'Failed to prepare lyrics preview'
      setError(message)
    }
  }

  const hasLink = Boolean(isPublished && shareUrl)

  return (
    <>
      <section className="space-y-3">
        <div>
          <h3 className="text-ui-text text-base font-bold">Share lyrics only</h3>
          <p className="text-ui-text-muted text-sm">
            Send this link to your friends to see lyrics directly.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Link2
                size={15}
                className="text-ui-text-muted pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="text"
                readOnly
                aria-label="Lyrics link"
                value={hasLink && shareUrl ? shareUrl.replace(/^https?:\/\//, '') : ''}
                placeholder="Click Create link to get your link"
                className={`ui-field truncate py-2 pr-3 pl-9 font-mono text-xs ${hasLink ? 'select-all' : ''}`}
              />
            </div>
            <IconButton
              variant="secondary"
              label="Preview"
              onClick={handleOpenPreview}
              disabled={isSaving}
            >
              <Eye size={16} />
            </IconButton>
            {hasLink ? (
              <Button
                variant="primary"
                className="shrink-0"
                icon={copied ? <Check size={15} /> : <Copy size={15} />}
                onClick={handleCopy}
                disabled={isSaving || !initialized}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            ) : (
              <Button
                variant="primary"
                className="shrink-0"
                onClick={() => publish('Failed to publish lyrics')}
                loading={isSaving}
                disabled={!initialized}
              >
                Create link
              </Button>
            )}
          </div>

          <p className="text-ui-text-muted text-xs leading-5">
            {isPublished && expiresAt
              ? `Works until ${new Date(expiresAt).toLocaleDateString()}. Link automatically updates when you add or remove songs.`
              : 'Link automatically updates when you add or remove songs.'}
          </p>

          {error && (
            <p role="alert" className="text-[11px] text-red-600 dark:text-red-300">
              {error}
            </p>
          )}
        </div>
      </section>

      <LyricsPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        payload={previewPayload}
      />
    </>
  )
}
