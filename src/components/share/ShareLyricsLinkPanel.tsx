import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Eye } from 'lucide-react'
import type { Session } from '../../lib/sessionStore'
import type { SharedLyricsPayload, Song } from '../../types/song'
import { buildSharedLyricsPayload, ShareLyricsError } from '../../lib/exportLyrics'
import {
  getLyricsPublicationIdentity,
  publishLyricsForSession,
} from '../../lib/lyricsPublishIdentity'
import { ensureLyricsFresh } from '../../lib/lyricsSync'
import { trackEvent } from '../../lib/analytics'
import { Button } from '../ui'
import LyricsPreviewModal from '../LyricsPreviewModal'

interface ShareLyricsLinkPanelProps {
  session: Session
  songsData: Map<string, Song>
}

export default function ShareLyricsLinkPanel({ session, songsData }: ShareLyricsLinkPanelProps) {
  const [copied, setCopied] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewPayload, setPreviewPayload] = useState<SharedLyricsPayload | null>(null)

  // Only a fresh stored link is restored, so any link here still has time left.
  const isPublished = Boolean(shareUrl && expiresAt)
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
      <div className="rounded-xl border border-ui-border bg-ui-surface">
        <div className="px-3 py-3">
          <div className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-2">
            <div className="min-w-[12rem] flex-1">
              <p className="text-sm font-bold text-ui-text">Lyrics link</p>
              <p className="text-xs leading-5 text-ui-text-muted">
                {isPublished && expiresAt
                  ? `Link works until ${new Date(expiresAt).toLocaleDateString()}. Updates when you change the set.`
                  : 'Updates when you change the set.'}
              </p>
            </div>
            {isPublished ? (
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <Button
                  variant="secondary"
                  icon={<Eye size={15} />}
                  onClick={handleOpenPreview}
                  disabled={isSaving}
                >
                  Preview
                </Button>
                <Button
                  variant="secondary"
                  icon={copied ? <Check size={15} /> : <Copy size={15} />}
                  onClick={handleCopy}
                  disabled={isSaving || !initialized}
                >
                  {copied ? 'Copied' : 'Copy link'}
                </Button>
              </div>
            ) : (
              <Button
                variant="primary"
                className="shrink-0"
                onClick={handlePublish}
                loading={isSaving}
                disabled={!initialized}
              >
                Create link
              </Button>
            )}
          </div>

          {error && (
            <p role="alert" className="mt-2 text-[11px] text-red-600 dark:text-red-300">
              {error}
            </p>
          )}
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
