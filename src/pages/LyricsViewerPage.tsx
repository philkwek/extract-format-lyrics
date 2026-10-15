import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AlertTriangle, Clock3, FileText, RefreshCw, RotateCcw } from 'lucide-react'
import { getSharedLyricsApi, ShareApiError, type GetSharedLyricsResult } from '../lib/api'
import type { SharedLyricsSong } from '../types/song'
import { Button, Surface } from '../components/ui'

export default function LyricsViewerPage() {
  const { shortId } = useParams<{ shortId?: string }>()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusKind, setStatusKind] = useState<'loading' | 'ok' | 'expired' | 'missing' | 'error'>('loading')
  const [lyricsData, setLyricsData] = useState<GetSharedLyricsResult | null>(null)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)

  const activeTabRef = useRef<HTMLButtonElement | null>(null)
  const contentContainerRef = useRef<HTMLDivElement | null>(null)

  const fetchLyrics = useCallback(async (isRefresh = false) => {
    if (!shortId) {
      setStatusKind('missing')
      setLoading(false)
      return
    }

    if (!isRefresh) {
      setLoading(true)
    }
    setError(null)

    try {
      const result = await getSharedLyricsApi(shortId)
      setLyricsData(result)
      setStatusKind('ok')
      setLoading(false)

      // Ensure active song selection
      setSelectedEntryId((prev) => {
        if (prev && result.lyrics.songs.some((s) => s.entryId === prev)) {
          return prev
        }
        return result.lyrics.songs[0]?.entryId || null
      })
    } catch (err) {
      setLoading(false)
      if (err instanceof ShareApiError) {
        if (err.code === 'EXPIRED' || err.status === 410) {
          setStatusKind('expired')
          return
        }
        if (err.code === 'NOT_FOUND' || err.status === 404) {
          setStatusKind('missing')
          return
        }
      }
      setError((err as Error).message || 'Failed to load lyrics')
      setStatusKind('error')
    }
  }, [shortId])

  // Initial load
  useEffect(() => {
    fetchLyrics(false)
  }, [fetchLyrics])

  // Refresh when returning to the browser tab
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchLyrics(true)
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [fetchLyrics])

  // Keep selected tab in view when active song changes
  useEffect(() => {
    if (activeTabRef.current) {
      activeTabRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      })
    }
  }, [selectedEntryId])

  // Reset scroll position when switching songs
  const handleSelectSong = (entryId: string) => {
    if (entryId !== selectedEntryId) {
      setSelectedEntryId(entryId)
      if (contentContainerRef.current) {
        contentContainerRef.current.scrollTop = 0
      }
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
  }

  // Keyboard navigation for song tabs (Left/Right arrow keys)
  const handleKeyDownTab = (e: React.KeyboardEvent, index: number, songs: SharedLyricsSong[]) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      const nextIdx = (index + 1) % songs.length
      const nextSong = songs[nextIdx]
      if (nextSong) handleSelectSong(nextSong.entryId)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const prevIdx = (index - 1 + songs.length) % songs.length
      const prevSong = songs[prevIdx]
      if (prevSong) handleSelectSong(prevSong.entryId)
    }
  }

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
            <Button variant="primary" icon={<RefreshCw size={15} />} onClick={() => fetchLyrics(false)}>
              Try again
            </Button>
          </div>
        </Surface>
      </div>
    )
  }

  const songs = lyricsData?.lyrics.songs || []
  const activeSong = songs.find((s) => s.entryId === selectedEntryId) || songs[0]

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Set Header */}
      <div className="flex items-center justify-between border-b border-[var(--ui-border)] pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-[-0.025em] text-[var(--ui-text)]">
            {lyricsData?.lyrics.name || 'Shared Lyrics'}
          </h1>
          <p className="mt-0.5 text-xs text-[var(--ui-text-muted)]">
            {songs.length} song{songs.length === 1 ? '' : 's'} in setlist
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw size={14} />}
          onClick={() => fetchLyrics(true)}
          title="Refresh lyrics"
        >
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {/* Sticky, Horizontally Scrollable Song Tabs */}
      {songs.length > 0 && (
        <div
          className="no-scrollbar sticky top-[57px] z-20 flex space-x-1.5 overflow-x-auto border-b border-[var(--ui-border)] bg-[var(--ui-bg)]/95 py-2.5 backdrop-blur-md"
          role="tablist"
          aria-label="Songs in setlist"
        >
          {songs.map((song, index) => {
            const isActive = song.entryId === activeSong?.entryId
            return (
              <button
                key={song.entryId}
                ref={isActive ? activeTabRef : null}
                role="tab"
                id={`lyrics-tab-${song.entryId}`}
                aria-selected={isActive}
                aria-controls={`lyrics-panel-${song.entryId}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => handleSelectSong(song.entryId)}
                onKeyDown={(e) => handleKeyDownTab(e, index, songs)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold outline-none transition ${
                  isActive
                    ? 'bg-[#3368A0] text-white shadow-sm dark:bg-amber-500 dark:text-[#16120a]'
                    : 'bg-black/5 text-neutral-600 hover:bg-black/10 dark:bg-white/5 dark:text-neutral-300 dark:hover:bg-white/10'
                } focus-visible:ring-2 focus-visible:ring-[#3368A0]/40`}
              >
                <span className="opacity-70">{index + 1}.</span>
                <span className="truncate max-w-[180px] sm:max-w-[240px]">{song.title}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Single-Column Lyrics Display */}
      <div ref={contentContainerRef} className="space-y-6">
        {!activeSong ? (
          <Surface elevated className="p-8 text-center text-sm text-[var(--ui-text-muted)]">
            No songs available in this set.
          </Surface>
        ) : activeSong.sections.length === 0 ? (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight text-[var(--ui-text)]">
              {activeSong.title}
            </h2>
            <Surface elevated className="p-8 text-center text-sm text-[var(--ui-text-muted)]">
              No lyrics available for this song.
            </Surface>
          </div>
        ) : (
          <div
            id={`lyrics-panel-${activeSong.entryId}`}
            role="tabpanel"
            aria-labelledby={`lyrics-tab-${activeSong.entryId}`}
            className="space-y-6"
          >
            <h2 className="text-2xl font-bold tracking-tight text-[var(--ui-text)]">
              {activeSong.title}
            </h2>

            <div className="space-y-6">
              {activeSong.sections.map((section, sIdx) => (
                <div key={sIdx} className="space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-[var(--ui-text-muted)]">
                    [{section.label}]
                  </div>
                  {section.lines.length === 0 ? (
                    <div className="text-xs italic text-[var(--ui-text-muted)]">
                      Instrumental
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {section.lines.map((line, lIdx) => (
                        <p
                          key={lIdx}
                          className="whitespace-pre-wrap break-words text-base leading-relaxed text-[var(--ui-text)]"
                        >
                          {line || '\u00A0'}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
