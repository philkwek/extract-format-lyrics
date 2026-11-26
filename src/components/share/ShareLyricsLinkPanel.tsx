import { useEffect, useRef, useState } from 'react'
import { AppWindow, Check, Copy, Eye, Link2, Monitor } from 'lucide-react'
import type { Session } from '../../lib/sessionStore'
import type { SharedLyricsPayload, Song } from '../../types/song'
import { buildSharedLyricsPayload, ShareLyricsError } from '../../lib/exportLyrics'
import {
  getLyricsPublicationIdentity,
  publishLyricsForSession,
  type PublishLyricsResult,
} from '../../lib/lyricsPublishIdentity'
import { ensureLyricsFresh } from '../../lib/lyricsSync'
import { currentSongSender } from '../../lib/presenterCurrent'
import { trackEvent } from '../../lib/analytics'
import { Button, IconButton } from '../ui'
import LyricsPreviewModal from '../LyricsPreviewModal'

interface ShareLyricsLinkPanelProps {
  session: Session
  songsData: Map<string, Song>
}

export default function ShareLyricsLinkPanel({ session, songsData }: ShareLyricsLinkPanelProps) {
  const [copied, setCopied] = useState(false)
  const [presenterCopied, setPresenterCopied] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [publicationId, setPublicationId] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [error, setError] = useState<{ scope: 'lyrics' | 'presenter'; message: string } | null>(
    null,
  )
  const [isSaving, setIsSaving] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewPayload, setPreviewPayload] = useState<SharedLyricsPayload | null>(null)

  // Only a fresh stored link is restored, so any link here still has time left.
  const isPublished = Boolean(shareUrl && publicationId && expiresAt)
  const sessionRef = useRef(session)

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    let isCurrent = true

    async function restoreIdentity() {
      try {
        const record = await getLyricsPublicationIdentity(session.id)
        const expiry = record?.expiresAt ? new Date(record.expiresAt).getTime() : 0
        if (isCurrent && record && record.expiresAt && expiry > Date.now()) {
          const origin = typeof window !== 'undefined' ? window.location.origin : ''
          setShareUrl(`${origin}/lyrics/${record.publicationId}`)
          setPublicationId(record.publicationId)
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

  useEffect(() => {
    if (!isPublished) return

    void ensureLyricsFresh(sessionRef.current)

    const handleOnline = () => {
      void ensureLyricsFresh(sessionRef.current)
    }

    window.addEventListener('online', handleOnline)

    return () => {
      window.removeEventListener('online', handleOnline)
    }
  }, [isPublished])

  const presenterUrl = (id: string) => `${window.location.origin}/present/${id}`

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

  const handlePublish = async (
    errorScope: 'lyrics' | 'presenter' = 'lyrics',
  ): Promise<PublishLyricsResult | null> => {
    if (isSaving) return null
    setIsSaving(true)
    setError(null)

    try {
      const payload = buildSharedLyricsPayload(session, songsData)
      const result = await publishLyricsForSession(session.id, payload)
      setShareUrl(result.shareUrl)
      setPublicationId(result.id)
      setExpiresAt(result.expiresAt)
      currentSongSender.resend(session.id)
      trackEvent('lyrics_published', {
        operation: isPublished ? 'update' : 'create',
        outcome: 'success',
        song_count: payload.songs.length,
      })
      return result
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
      setError({ scope: errorScope, message })
      return null
    } finally {
      setIsSaving(false)
    }
  }

  const handleCopyPresenter = async () => {
    setError(null)
    let id = isPublished ? publicationId : null
    if (!id) {
      const result = await handlePublish('presenter')
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
    if (isPublished && publicationId) {
      window.open(presenterUrl(publicationId), '_blank')
      return
    }
    // Opened before publishing so the click still counts as a user gesture.
    const win = window.open('', '_blank')
    const result = await handlePublish('presenter')
    if (!result) {
      win?.close()
      return
    }
    const url = presenterUrl(result.id)
    if (win) win.location.href = url
    else window.open(url, '_blank')
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
      setError({ scope: 'lyrics', message })
    }
  }

  return (
    <>
      <section className="space-y-3">
        <div>
          <h3 className="text-ui-text text-base font-bold">Share lyrics only</h3>
          <p className="text-ui-text-muted text-sm">Send this link to your friends to see lyrics directly.</p>
        </div>

        <div className="space-y-2">
          {isPublished && shareUrl ? (
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
                  value={shareUrl.replace(/^https?:\/\//, '')}
                  className="ui-field truncate py-2 pr-3 pl-9 font-mono text-xs select-all"
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
              <Button
                variant="primary"
                className="shrink-0"
                icon={copied ? <Check size={15} /> : <Copy size={15} />}
                onClick={handleCopy}
                disabled={isSaving || !initialized}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          ) : (
            <div>
              <Button
                variant="primary"
                onClick={() => handlePublish('lyrics')}
                loading={isSaving}
                disabled={!initialized}
              >
                Create link
              </Button>
            </div>
          )}

          <p className="text-ui-text-muted text-xs leading-5">
            {isPublished && expiresAt
              ? `Works until ${new Date(expiresAt).toLocaleDateString()}. Link automatically updates when you add or remove songs.`
              : 'Link automatically updates when you add or remove songs.'}
          </p>

          {error?.scope === 'lyrics' && (
            <p role="alert" className="text-[11px] text-red-600 dark:text-red-300">
              {error.message}
            </p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-ui-text text-base font-bold">
            Start presentation mode for lyrics
          </h3>
          <p className="text-ui-text-muted text-sm">Just like a PowerPoint presentation.</p>
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="border-ui-border bg-ui-surface-raised flex flex-col rounded-xl border p-3.5">
              <AppWindow
                size={18}
                className="text-ui-accent mb-2.5 shrink-0"
                aria-hidden="true"
              />
              <p className="text-ui-text text-sm font-bold">Present on this device</p>
              <p className="text-ui-text-muted mt-1 flex-1 text-xs leading-5">
                Drag the new window into your 2nd display.
              </p>
              <Button
                variant="primary"
                className="mt-3 w-full"
                onClick={handleOpenPresenter}
                disabled={isSaving || !initialized}
              >
                Open in a new tab
              </Button>
            </div>

            <div className="border-ui-border bg-ui-surface-raised flex flex-col rounded-xl border p-3.5">
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

          {error?.scope === 'presenter' && (
            <p role="alert" className="text-[11px] text-red-600 dark:text-red-300">
              {error.message}
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
