import { useEffect, useRef, useState } from 'react'
import type { Session } from '../../lib/sessionStore'
import type { Song } from '../../types/song'
import { buildSharedLyricsPayload, ShareLyricsError } from '../../lib/exportLyrics'
import {
  getLyricsPublicationIdentity,
  publishLyricsForSession,
  type PublishLyricsResult,
} from '../../lib/lyricsPublishIdentity'
import { ensureLyricsFresh } from '../../lib/lyricsSync'
import { currentSongSender } from '../../lib/presenterCurrent'
import { trackEvent } from '../../lib/analytics'

/** Manages the published lyrics link identity, freshness sync, and publish action for a session. */
export function useLyricsPublication(session: Session, songsData: Map<string, Song>) {
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [publicationId, setPublicationId] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [initialized, setInitialized] = useState(false)

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

  const publish = async (fallbackErrorMessage: string): Promise<PublishLyricsResult | null> => {
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
          : (err as Error).message || fallbackErrorMessage
      setError(message)
      return null
    } finally {
      setIsSaving(false)
    }
  }

  return {
    shareUrl,
    publicationId,
    expiresAt,
    isPublished,
    isSaving,
    initialized,
    error,
    setError,
    publish,
  }
}
