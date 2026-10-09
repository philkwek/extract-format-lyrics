import { useState, useEffect, useMemo } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { sessionStore, type Session, type SessionSongItem } from '../lib/sessionStore'
import { songCache } from '../lib/songCache'
import { scrapeApi } from '../lib/api'
import { getSongPrefs, saveSongPrefs, type SongDisplayPrefs } from '../lib/songPrefs'
import { transposeSong } from '../lib/transpose'
import { keyOffset, formatOffset } from '../lib/keys'
import { calculateFitLayout } from '../lib/useFitToScreen'
import SongHeader from '../components/SongHeader'
import SongSheet from '../components/SongSheet'
import DisplayControls from '../components/DisplayControls'
import TransposeSelector from '../components/TransposeSelector'
import type { Song } from '../types/song'

export default function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const [session, setSession] = useState<Session | null>(null)
  const [songsData, setSongsData] = useState<Map<string, Song>>(new Map())
  const [retryingUrls, setRetryingUrls] = useState<Set<string>>(new Set())
  const [targetKeys, setTargetKeys] = useState<Map<string, string>>(new Map())
  const [songPrefsOverrides, setSongPrefsOverrides] = useState<Map<string, SongDisplayPrefs>>(new Map())

  // Song index from ?song= query param, default 0
  const activeIndex = Math.max(0, parseInt(searchParams.get('song') || '0', 10) || 0)

  useEffect(() => {
    if (!sessionId) return
    sessionStore.getSession(sessionId).then(async (s) => {
      if (!s) return
      setSession(s)

      // Load cached song data for successful items
      const map = new Map<string, Song>()
      for (const item of s.songs) {
        if (item.status === 'ok') {
          const loaded = await songCache.getSong(item.url)
          if (loaded) {
            map.set(item.url, loaded)
          }
        }
      }
      setSongsData(map)
    })
  }, [sessionId])

  const currentItem = session?.songs[activeIndex]
  const currentSong = currentItem ? songsData.get(currentItem.url) : null

  const prefs = useMemo(() => {
    if (!currentSong) {
      return { columns: 1 as const, fontSizePx: 14, darkMode: true }
    }
    const override = songPrefsOverrides.get(currentSong.id)
    return override ?? getSongPrefs(currentSong.id)
  }, [currentSong, songPrefsOverrides])

  const handleUpdatePrefs = (newPrefs: SongDisplayPrefs) => {
    if (currentSong) {
      setSongPrefsOverrides((prev) => new Map(prev).set(currentSong.id, newPrefs))
      saveSongPrefs(currentSong.id, newPrefs)
    }
  }

  const selectSong = (index: number) => {
    setSearchParams({ song: index.toString() })
  }

  const handleSelectKey = (newKey: string) => {
    if (!currentSong) return
    setTargetKeys((prev) => new Map(prev).set(currentSong.id, newKey))
  }

  const handleResetKey = () => {
    if (!currentSong) return
    setTargetKeys((prev) => {
      const next = new Map(prev)
      next.delete(currentSong.id)
      return next
    })
  }

  // Compute transposed song
  const displayedSong = useMemo(() => {
    if (!currentSong) return null
    const targetKey = targetKeys.get(currentSong.id)
    if (!targetKey || !currentSong.originalKey || targetKey === currentSong.originalKey) {
      return currentSong
    }
    const offset = keyOffset(currentSong.originalKey, targetKey)
    return transposeSong(currentSong, offset, targetKey)
  }, [currentSong, targetKeys])

  // Compute effective layout (handling 'fit' mode)
  const fitResult = useMemo(() => {
    if (prefs.columns !== 'fit') {
      return {
        columns: prefs.columns as 1 | 2 | 3,
        fontSizePx: prefs.fontSizePx,
        notice: null,
      }
    }

    const availableHeight = window.innerHeight - 240
    const availableWidth = window.innerWidth
    const approxLines = currentSong?.sections.reduce((acc, s) => acc + s.lines.length * 2, 0) || 50
    const approxHeight = approxLines * prefs.fontSizePx * 1.5

    const fit = calculateFitLayout(
      availableHeight,
      availableWidth,
      approxHeight,
      1,
      prefs.fontSizePx
    )

    return {
      columns: fit.columns,
      fontSizePx: fit.fontSizePx,
      notice: fit.fitsOnScreen ? null : 'Song exceeds screen height; minimum readable size applied.',
    }
  }, [prefs.columns, prefs.fontSizePx, currentSong])

  const handleRetry = async (item: SessionSongItem) => {
    if (!session || retryingUrls.has(item.url)) return
    setRetryingUrls((prev) => new Set(prev).add(item.url))

    try {
      const response = await scrapeApi([item.url])
      const res = response.results[0]
      if (res && res.status === 'ok' && res.song) {
        await songCache.saveSong(res.song)
        const updatedSongs = session.songs.map((s) =>
          s.url === item.url
            ? { ...s, status: 'ok' as const, title: res.song?.title, artist: res.song?.artist, errorMessage: undefined }
            : s
        )
        const updatedSession = { ...session, songs: updatedSongs }
        await sessionStore.updateSession(updatedSession)
        setSession(updatedSession)
        setSongsData((prev) => new Map(prev).set(item.url, res.song!))
      } else {
        const errorMsg = res?.message || 'Retry failed'
        const updatedSongs = session.songs.map((s) =>
          s.url === item.url ? { ...s, errorMessage: errorMsg } : s
        )
        const updatedSession = { ...session, songs: updatedSongs }
        await sessionStore.updateSession(updatedSession)
        setSession(updatedSession)
      }
    } catch (err) {
      const errorMsg = (err as Error).message || 'Retry network error'
      const updatedSongs = session.songs.map((s) =>
        s.url === item.url ? { ...s, errorMessage: errorMsg } : s
      )
      const updatedSession = { ...session, songs: updatedSongs }
      await sessionStore.updateSession(updatedSession)
      setSession(updatedSession)
    } finally {
      setRetryingUrls((prev) => {
        const next = new Set(prev)
        next.delete(item.url)
        return next
      })
    }
  }

  const handleRemoveSong = async (url: string) => {
    if (!session) return
    const updated = await sessionStore.removeSongFromSession(session.id, url)
    if (updated) {
      setSession(updated)
      if (activeIndex >= updated.songs.length) {
        setSearchParams({ song: Math.max(0, updated.songs.length - 1).toString() })
      }
    }
  }

  if (!session) {
    return (
      <div className="py-12 text-center text-neutral-400 text-sm">
        Session not found. <button onClick={() => navigate('/')} className="text-amber-400 underline">Return home</button>
      </div>
    )
  }

  const currentKey = currentSong ? targetKeys.get(currentSong.id) || currentSong.originalKey : null
  const offset = currentSong && currentSong.originalKey && currentKey
    ? keyOffset(currentSong.originalKey, currentKey)
    : 0

  return (
    <div className="space-y-4">
      {/* Session Title Bar */}
      <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
        <div>
          <h1 className="text-lg font-bold">{session.name}</h1>
          <p className="text-xs text-neutral-500">
            {session.songs.length} song(s) in setlist
          </p>
        </div>
        <button
          onClick={() => navigate('/search')}
          className="text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-3 py-1.5 rounded transition-colors cursor-pointer"
        >
          + Add song
        </button>
      </div>

      {/* Scrollable Song Tabs */}
      <div className="flex space-x-1.5 overflow-x-auto pb-1.5 no-scrollbar border-b border-neutral-800">
        {session.songs.map((item, idx) => {
          const isActive = idx === activeIndex
          const song = songsData.get(item.url)
          const label = song?.title || item.title || item.url.replace(/^https?:\/\//, '').slice(0, 18)

          return (
            <button
              key={idx}
              onClick={() => selectSong(idx)}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-t-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer border-b-2 ${
                isActive
                  ? 'bg-neutral-800 text-amber-400 border-amber-400'
                  : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 border-transparent'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  item.status === 'ok'
                    ? 'bg-emerald-500'
                    : item.status === 'error'
                      ? 'bg-red-500'
                      : 'bg-amber-500 animate-pulse'
                }`}
              />
              <span className="truncate max-w-[140px]">{label}</span>
              {session.songs.length > 1 && (
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemoveSong(item.url)
                  }}
                  className="text-neutral-500 hover:text-neutral-300 ml-1"
                >
                  ×
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Main Song Content */}
      {currentItem && (
        <div className="space-y-4">
          {currentItem.status === 'error' ? (
            <div className="p-6 bg-red-950/20 border border-red-800/40 rounded-xl space-y-3">
              <h3 className="text-red-400 font-semibold text-sm">Failed to extract chord sheet</h3>
              <p className="text-xs font-mono text-neutral-400 break-all">{currentItem.url}</p>
              <p className="text-xs text-red-300">{currentItem.errorMessage || 'Unknown extraction error'}</p>
              <button
                onClick={() => handleRetry(currentItem)}
                disabled={retryingUrls.has(currentItem.url)}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-xs font-medium rounded text-neutral-200 transition-colors cursor-pointer"
              >
                {retryingUrls.has(currentItem.url) ? 'Retrying...' : 'Retry extraction'}
              </button>
            </div>
          ) : displayedSong ? (
            <div className="space-y-4">
              {/* Header with Title, Artist, Original Key Badge */}
              <SongHeader
                song={displayedSong}
                currentKey={currentKey}
                offsetDisplay={offset !== 0 ? formatOffset(offset) : undefined}
                onResetKey={handleResetKey}
              />

              {/* Controls Toolbar: Transpose Key Selector & Display Controls */}
              <div className="space-y-2">
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-4">
                  <TransposeSelector
                    originalKey={displayedSong.originalKey}
                    currentKey={currentKey}
                    onSelectKey={handleSelectKey}
                    onReset={handleResetKey}
                  />
                </div>

                <DisplayControls
                  prefs={prefs}
                  onChangePrefs={handleUpdatePrefs}
                  fitsNotice={fitResult.notice}
                />
              </div>

              {/* Song Sheet Rendered with Columns and Monospace Offsets */}
              <div className="pt-2">
                <SongSheet
                  sections={displayedSong.sections}
                  fontSizePx={fitResult.fontSizePx}
                  columns={fitResult.columns}
                />
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-neutral-500 animate-pulse">
              Loading song sheet...
            </div>
          )}
        </div>
      )}
    </div>
  )
}
