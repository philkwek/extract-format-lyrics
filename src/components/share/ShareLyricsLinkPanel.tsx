import { useEffect, useState } from 'react'
import { Check, Copy, Eye, FileText, Link2, RefreshCw } from 'lucide-react'
import type { Session } from '../../lib/sessionStore'
import type { SharedLyricsPayload, Song } from '../../types/song'
import { buildSharedLyricsPayload, ShareLyricsError } from '../../lib/exportLyrics'
import {
  getLyricsPublicationIdentity,
  publishLyricsForSession,
} from '../../lib/lyricsPublishIdentity'
import { trackEvent } from '../../lib/analytics'
import { Button, StatusBanner } from '../ui'
import LyricsPreviewModal from '../LyricsPreviewModal'

interface ShareLyricsLinkPanelProps {
  session: Session
  songsData: Map<string, Song>
}

export default function ShareLyricsLinkPanel({
  session,
  songsData,
}: ShareLyricsLinkPanelProps) {
  const [copied, setCopied] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewPayload, setPreviewPayload] = useState<SharedLyricsPayload | null>(null)

  const isPublished = Boolean(shareUrl && expiresAt)

  useEffect(() => {
    let isCurrent = true

    async function restoreIdentity() {
      try {
        const record = await getLyricsPublicationIdentity(session.id)
        if (isCurrent && record && record.expiresAt) {
          const origin = typeof window !== 'undefined' ? window.location.origin : ''
          setShareUrl(`${origin}/lyrics/${record.publicationId}`)
          setExpiresAt(record.expiresAt)
        }
      } catch {
        // Ignore local lookup errors
      } finally {
        if (isCurrent) setInitialized(true)
      }
    }

    restoreIdentity()

    return () => {
      isCurrent = false
    }
  }, [session.id])

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

  const handlePublish = async () => {
    if (isSaving) return
    setIsSaving(true)
    setError(null)

    try {
      const payload = buildSharedLyricsPayload(session, songsData)
      const result = await publishLyricsForSession(session.id, payload)
      setShareUrl(result.shareUrl)
      setExpiresAt(result.expiresAt)
      trackEvent('lyrics_published', {
        operation: isPublished ? 'update' : 'create',
        outcome: 'success',
        song_count: payload.songs.length,
      })
    } catch (err) {
      trackEvent('lyrics_published', {
        operation: isPublished ? 'update' : 'create',
        outcome: 'error',
        song_count: session.songs.length,
      })
      const message =
        err instanceof ShareLyricsError
          ? err.message
          : (err as Error).message || 'Failed to publish lyrics'
      setError(message)
    } finally {
      setIsSaving(false)
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

  return (
    <>
      <div className="space-y-3">
        <StatusBanner tone="info" icon={<Link2 size={16} />}>
          {isPublished
            ? 'Updates keep this link and renew expiry for seven days.'
            : 'Anyone with the link can view lyrics for this setlist. Each publication lasts seven days.'}
        </StatusBanner>

        <div className="space-y-2">
          <label
            htmlFor="share-lyrics-url"
            className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ui-text-muted)]"
          >
            Lyrics link
          </label>
          <input
            id="share-lyrics-url"
            type="text"
            readOnly
            value={
              shareUrl ||
              (isSaving
                ? 'Publishing lyrics…'
                : initialized
                  ? 'Generate a link when you are ready'
                  : 'Checking existing link…')
            }
            className="ui-field select-all px-3 py-2.5 font-mono text-xs"
          />

          <div className="flex flex-col gap-2 pt-1">
            {error && (
              <span className="text-[11px] text-red-600 dark:text-red-300" role="alert">
                {error}
              </span>
            )}
            {!error && expiresAt && (
              <span className="text-[11px] text-[var(--ui-text-muted)]">
                Expires {new Date(expiresAt).toLocaleString()}
              </span>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <Button
                variant="secondary"
                icon={<Eye size={15} />}
                onClick={handleOpenPreview}
                disabled={isSaving}
              >
                See Preview
              </Button>
              {isPublished ? (
                <>
                  <Button
                    variant="secondary"
                    icon={copied ? <Check size={15} /> : <Copy size={15} />}
                    onClick={handleCopy}
                    disabled={isSaving}
                  >
                    {copied ? 'Copied' : 'Copy link'}
                  </Button>
                  <Button
                    variant="primary"
                    icon={<RefreshCw size={15} className={isSaving ? 'animate-spin' : ''} />}
                    onClick={handlePublish}
                    loading={isSaving}
                    disabled={isSaving}
                  >
                    {isSaving ? 'Updating…' : 'Update lyrics'}
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  icon={<FileText size={15} />}
                  onClick={handlePublish}
                  loading={isSaving}
                  disabled={isSaving}
                >
                  {isSaving ? 'Generating…' : 'Generate link'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <LyricsPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        payload={previewPayload}
      />
    </>
  )
}
