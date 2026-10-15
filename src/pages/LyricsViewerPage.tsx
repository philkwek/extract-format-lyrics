import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AlertTriangle, Clock3, FileText, RefreshCw } from 'lucide-react'
import { getSharedLyricsApi, ShareApiError, type GetSharedLyricsResult } from '../lib/api'
import {
  saveRecentSharedLyrics,
  getCachedSharedLyrics,
  removeRecentSharedLyrics,
} from '../lib/recentLyricsStore'
import { Button, Surface } from '../components/ui'
import LyricsViewerContent from '../components/LyricsViewerContent'

export default function LyricsViewerPage() {
  const { shortId } = useParams<{ shortId?: string }>()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusKind, setStatusKind] = useState<'loading' | 'ok' | 'expired' | 'missing' | 'error'>('loading')
  const [lyricsData, setLyricsData] = useState<GetSharedLyricsResult | null>(null)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)

  const refreshLyrics = useCallback(
    async (showLoadingSpinner = false) => {
      if (!shortId) return
      if (showLoadingSpinner) {
        setLoading(true)
      }
      setError(null)
      try {
        const result = await getSharedLyricsApi(shortId)
        setLyricsData(result)
        setStatusKind('ok')
        setSelectedEntryId((prev) => {
          if (prev && result.lyrics.songs.some((s) => s.entryId === prev)) {
            return prev
          }
          return result.lyrics.songs[0]?.entryId || null
        })
        void saveRecentSharedLyrics(shortId, result.lyrics, result.expiresAt)
      } catch (err) {
        if (err instanceof ShareApiError) {
          if (err.code === 'EXPIRED' || err.status === 410) {
            setStatusKind('expired')
            return
          }
          if (err.code === 'NOT_FOUND' || err.status === 404) {
            void removeRecentSharedLyrics(shortId)
            setStatusKind('missing')
            return
          }
        }
        setError((err as Error).message || 'Failed to load lyrics')
        setStatusKind('error')
      } finally {
        if (showLoadingSpinner) {
          setLoading(false)
        }
      }
    },
    [shortId]
  )

  // Initial load
  useEffect(() => {
    let isCancelled = false

    async function load() {
      if (!shortId) {
        if (!isCancelled) {
          setStatusKind('missing')
          setLoading(false)
        }
        return
      }

      const cached = await getCachedSharedLyrics(shortId)
      if (cached && !isCancelled) {
        setLyricsData({
          id: cached.id,
          lyrics: { v: 1, name: cached.name, songs: cached.songs },
          expiresAt: cached.expiresAt,
        })
        setSelectedEntryId(cached.songs[0]?.entryId || null)
        setStatusKind('ok')
        setLoading(false)
      }

      try {
        const result = await getSharedLyricsApi(shortId)
        if (isCancelled) return
        setLyricsData(result)
        setStatusKind('ok')
        setSelectedEntryId((prev) => {
          if (prev && result.lyrics.songs.some((s) => s.entryId === prev)) {
            return prev
          }
          return result.lyrics.songs[0]?.entryId || null
        })
        void saveRecentSharedLyrics(shortId, result.lyrics, result.expiresAt)
      } catch (err) {
        if (isCancelled) return
        if (err instanceof ShareApiError) {
          if (err.code === 'EXPIRED' || err.status === 410) {
            setStatusKind('expired')
            setLoading(false)
            return
          }
          if (err.code === 'NOT_FOUND' || err.status === 404) {
            void removeRecentSharedLyrics(shortId)
            setStatusKind('missing')
            setLoading(false)
            return
          }
        }
        if (!cached) {
          setError((err as Error).message || 'Failed to load lyrics')
          setStatusKind('error')
        }
      } finally {
        if (!isCancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      isCancelled = true
    }
  }, [shortId])

  // Refresh when returning to the browser tab
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshLyrics(false)
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refreshLyrics])

  if (loading) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <Surface elevated className="space-y-4 p-8">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#3368A0]/10 text-[#3368A0] dark:bg-amber-400/10 dark:text-amber-400">
            <FileText className="animate-pulse" size={23} />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-[-0.025em] text-[var(--ui-text)]">
              Loading lyrics…
            </h1>
            <p className="mt-2 text-sm text-[var(--ui-text-muted)]" role="status">
              Retrieving setlist lyrics
            </p>
          </div>
          <div className="mx-auto h-1.5 max-w-48 overflow-hidden rounded-full bg-[#3368A0]/10 dark:bg-amber-400/10">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-[#3368A0] dark:bg-amber-400" />
          </div>
        </Surface>
      </div>
    )
  }

  if (statusKind === 'missing') {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <Surface elevated className="space-y-4 p-8">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-500/10 text-neutral-600 dark:text-neutral-400">
            <AlertTriangle size={23} />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-[-0.025em] text-[var(--ui-text)]">
              Lyrics link not found
            </h1>
            <p className="mt-2 text-sm leading-6 text-[var(--ui-text-muted)]">
              This link may have been mistyped or deleted.
            </p>
          </div>
          <Button variant="primary" onClick={() => navigate('/')}>
            Return home
          </Button>
        </Surface>
      </div>
    )
  }

  if (statusKind === 'expired') {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <Surface elevated className="space-y-4 p-8">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-400">
            <Clock3 size={23} />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-[-0.025em] text-[var(--ui-text)]">
              This lyrics link has expired
            </h1>
            <p className="mt-2 text-sm leading-6 text-[var(--ui-text-muted)]">
              Links expire after seven days. Ask the musician to update or republish this setlist to renew it.
            </p>
          </div>
          <Button variant="primary" onClick={() => navigate('/')}>
            Return home
          </Button>
        </Surface>
      </div>
    )
  }

  if (statusKind === 'error') {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <Surface elevated className="space-y-4 p-8">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400">
            <AlertTriangle size={23} />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-[-0.025em] text-[var(--ui-text)]">
              Could not load lyrics
            </h1>
            <p className="mt-2 text-sm leading-6 text-[var(--ui-text-muted)]">{error}</p>
          </div>
          <div className="flex justify-center gap-3">
            <Button variant="secondary" onClick={() => navigate('/')}>
              Home
            </Button>
            <Button variant="primary" icon={<RefreshCw size={15} />} onClick={() => refreshLyrics(true)}>
              Try again
            </Button>
          </div>
        </Surface>
      </div>
    )
  }

  return (
    <LyricsViewerContent
      songs={lyricsData?.lyrics.songs || []}
      setName={lyricsData?.lyrics.name || 'Shared Lyrics'}
      selectedEntryId={selectedEntryId}
      onSelectSong={setSelectedEntryId}
      onRefresh={() => refreshLyrics(false)}
      showRefresh={true}
    />
  )
}
