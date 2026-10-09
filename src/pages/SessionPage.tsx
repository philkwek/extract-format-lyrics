import { useState, useEffect, useMemo } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { sessionStore, type Session, type SessionSongItem } from '../lib/sessionStore'
import { songCache } from '../lib/songCache'
import { scrapeApi } from '../lib/api'
import { getSongPrefs, saveSongPrefs, type SongDisplayPrefs } from '../lib/songPrefs'
import { transposeSong, transposeChord, keyUsesFlats } from '../lib/transpose'
import { keyOffset, formatOffset } from '../lib/keys'
import { calculateFitLayout } from '../lib/useFitToScreen'
import SongHeader from '../components/SongHeader'
import SongSheet from '../components/SongSheet'
import DisplayControls from '../components/DisplayControls'
import TransposeSelector from '../components/TransposeSelector'
import ShareModal from '../components/ShareModal'
import { getInitialTheme, saveTheme } from '../lib/theme'
import type { Song, Section, SharePayload } from '../types/song'

export default function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const [session, setSession] = useState<Session | null>(null)
  const [songsData, setSongsData] = useState<Map<string, Song>>(new Map())
  const [originalSongs, setOriginalSongs] = useState<Map<string, Song>>(new Map())
  const [retryingUrls, setRetryingUrls] = useState<Set<string>>(new Set())
  const [targetKeys, setTargetKeys] = useState<Map<string, string>>(new Map())
  const [songPrefsOverrides, setSongPrefsOverrides] = useState<Map<string, SongDisplayPrefs>>(new Map())
  const [isEditingName, setIsEditingName] = useState(false)
  const [editedName, setEditedName] = useState('')
  const [themeDark, setThemeDark] = useState<boolean>(getInitialTheme)
  const [sharingPayload, setSharingPayload] = useState<SharePayload | null>(null)
  const [draggedSongIdx, setDraggedSongIdx] = useState<number | null>(null)
  const [dragOverSongIdx, setDragOverSongIdx] = useState<number | null>(null)
  const [isEditingChords, setIsEditingChords] = useState(false)

  useEffect(() => {
    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ isDark: boolean }>
      if (customEvent.detail && typeof customEvent.detail.isDark === 'boolean') {
        setThemeDark(customEvent.detail.isDark)
      }
    }
    window.addEventListener('app_theme_changed', handleThemeChange)
    return () => {
      window.removeEventListener('app_theme_changed', handleThemeChange)
    }
  }, [])

  // Song index from ?song= query param, default 0
  const activeIndex = Math.max(0, parseInt(searchParams.get('song') || '0', 10) || 0)

  useEffect(() => {
    if (!sessionId) return
    sessionStore.getSession(sessionId).then(async (s) => {
      if (!s) return
      setSession(s)

      // Load cached song data for successful items
      const map = new Map<string, Song>()
      const origMap = new Map<string, Song>()
      for (const item of s.songs) {
        if (item.status === 'ok') {
          const loaded = await songCache.getSong(item.url)
          if (loaded) {
            origMap.set(item.url, loaded)
            let songToUse = loaded
            if (item.customSections) {
              songToUse = { ...songToUse, sections: item.customSections }
            }
            if (item.customSimplifiedSections && songToUse.simplifiedSections) {
              songToUse = { ...songToUse, simplifiedSections: item.customSimplifiedSections }
            }
            map.set(item.url, songToUse)
          }
        }
      }
      setSongsData(map)
      setOriginalSongs(origMap)
    })
  }, [sessionId])

  const currentItem = session?.songs[activeIndex]
  const currentSong = currentItem ? songsData.get(currentItem.url) : null

  const prefs = useMemo(() => {
    if (!currentSong) {
      return { columns: 1 as const, fontSizePx: 14, darkMode: themeDark }
    }
    const override = songPrefsOverrides.get(currentSong.id)
    const stored = override ?? getSongPrefs(currentSong.id)
    return { ...stored, darkMode: themeDark }
  }, [currentSong, songPrefsOverrides, themeDark])

  const handleUpdatePrefs = (newPrefs: SongDisplayPrefs) => {
    if (newPrefs.darkMode !== themeDark) {
      saveTheme(newPrefs.darkMode)
    }
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

  const canSimplify = Boolean(currentSong?.simplifiedSections && currentSong.simplifiedSections.length > 0)
  const isSimplified = Boolean(prefs.simplified && canSimplify)
  const activeSections = useMemo(() => {
    if (isSimplified && currentSong?.simplifiedSections && currentSong.simplifiedSections.length > 0) {
      return currentSong.simplifiedSections
    }
    return currentSong?.sections ?? []
  }, [isSimplified, currentSong])

  // Compute transposed song
  const displayedSong = useMemo(() => {
    if (!currentSong) return null
    const baseSong = {
      ...currentSong,
      sections: activeSections,
    }
    const targetKey = targetKeys.get(currentSong.id)
    if (!targetKey || !currentSong.originalKey || targetKey === currentSong.originalKey) {
      return baseSong
    }
    const offset = keyOffset(currentSong.originalKey, targetKey)
    return transposeSong(baseSong, offset, targetKey)
  }, [currentSong, activeSections, targetKeys])

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
    const approxLines = activeSections.reduce((acc, s) => acc + s.lines.length * 2, 0) || 50
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
  }, [prefs.columns, prefs.fontSizePx, activeSections])

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
        setOriginalSongs((prev) => new Map(prev).set(item.url, res.song!))
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

  const originalSong = currentSong ? originalSongs.get(currentSong.sourceUrl) : null
  const isSheetModified = Boolean(
    currentSong &&
    originalSong &&
    (isSimplified && currentSong.simplifiedSections && originalSong.simplifiedSections
      ? JSON.stringify(currentSong.simplifiedSections) !== JSON.stringify(originalSong.simplifiedSections)
      : JSON.stringify(currentSong.sections) !== JSON.stringify(originalSong.sections))
  )

  const handleReorderSections = async (fromIndex: number, toIndex: number) => {
    if (!currentSong || !session || fromIndex === toIndex) return

    const baseSections = isSimplified && currentSong.simplifiedSections
      ? [...currentSong.simplifiedSections]
      : [...currentSong.sections]

    if (fromIndex < 0 || fromIndex >= baseSections.length || toIndex < 0 || toIndex >= baseSections.length) {
      return
    }

    const [movedSection] = baseSections.splice(fromIndex, 1)
    baseSections.splice(toIndex, 0, movedSection)

    const updatedSong: Song = isSimplified && currentSong.simplifiedSections
      ? { ...currentSong, simplifiedSections: baseSections }
      : { ...currentSong, sections: baseSections }

    setSongsData((prev) => new Map(prev).set(currentSong.sourceUrl, updatedSong))

    // Persist reordered sections to session so it survives page reloads
    const updatedSongs = session.songs.map((s) =>
      s.url === currentSong.sourceUrl
        ? {
            ...s,
            customSections: isSimplified ? s.customSections : baseSections,
            customSimplifiedSections: isSimplified ? baseSections : s.customSimplifiedSections,
          }
        : s
    )
    const updatedSession = { ...session, songs: updatedSongs }
    await sessionStore.updateSession(updatedSession)
    setSession(updatedSession)
  }

  const handleReorderSongs = async (fromIndex: number, toIndex: number) => {
    if (!session || fromIndex === toIndex) return
    if (fromIndex < 0 || fromIndex >= session.songs.length || toIndex < 0 || toIndex >= session.songs.length) return

    const currentActiveUrl = session.songs[activeIndex]?.url

    const updatedSession = await sessionStore.reorderSongsInSession(session.id, fromIndex, toIndex)
    if (updatedSession) {
      setSession(updatedSession)
      if (currentActiveUrl) {
        const newActiveIndex = updatedSession.songs.findIndex((s) => s.url === currentActiveUrl)
        if (newActiveIndex >= 0 && newActiveIndex !== activeIndex) {
          setSearchParams({ song: newActiveIndex.toString() })
        }
      }
    }
  }

  const handleTabDragStart = (e: React.DragEvent, idx: number) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', idx.toString())
    setDraggedSongIdx(idx)
  }

  const handleTabDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverSongIdx !== idx) {
      setDragOverSongIdx(idx)
    }
  }

  const handleTabDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault()
    if (draggedSongIdx !== null && draggedSongIdx !== targetIdx) {
      handleReorderSongs(draggedSongIdx, targetIdx)
    }
    setDraggedSongIdx(null)
    setDragOverSongIdx(null)
  }

  const handleTabDragEnd = () => {
    setDraggedSongIdx(null)
    setDragOverSongIdx(null)
  }

  const handleDeleteSection = async (sectionIndex: number) => {
    if (!currentSong || !session) return
    const targetSection = activeSections[sectionIndex]
    const label = targetSection?.label || `Section ${sectionIndex + 1}`

    const confirmed = window.confirm(
      `Are you sure you want to delete "${label}"?\n\nYou can restore it to the original chord sheet at any time.`
    )
    if (!confirmed) return

    const baseSections = isSimplified && currentSong.simplifiedSections
      ? currentSong.simplifiedSections
      : currentSong.sections
    const updatedSections = baseSections.filter((_, idx) => idx !== sectionIndex)

    const updatedSong: Song = isSimplified && currentSong.simplifiedSections
      ? { ...currentSong, simplifiedSections: updatedSections }
      : { ...currentSong, sections: updatedSections }

    setSongsData((prev) => new Map(prev).set(currentSong.sourceUrl, updatedSong))

    // Persist custom sections to session so it survives page reloads
    const updatedSongs = session.songs.map((s) =>
      s.url === currentSong.sourceUrl
        ? {
            ...s,
            customSections: isSimplified ? s.customSections : updatedSections,
            customSimplifiedSections: isSimplified ? updatedSections : s.customSimplifiedSections,
          }
        : s
    )
    const updatedSession = { ...session, songs: updatedSongs }
    await sessionStore.updateSession(updatedSession)
    setSession(updatedSession)
  }

  const handleEditChord = async (
    sectionIndex: number,
    lineIndex: number,
    chordIndex: number,
    newChord: string
  ) => {
    if (!currentSong || !session) return

    // If currently transposed, map edited chord back to original key for base storage
    let baseChord = newChord
    const currentKey = targetKeys.get(currentSong.id) || currentSong.originalKey
    if (currentKey && currentSong.originalKey && currentKey !== currentSong.originalKey) {
      const offset = keyOffset(currentSong.originalKey, currentKey)
      if (offset !== 0) {
        const useFlats = keyUsesFlats(currentSong.originalKey)
        baseChord = transposeChord(newChord, -offset, useFlats)
      }
    }

    const baseSections: Section[] = (
      isSimplified && currentSong.simplifiedSections
        ? currentSong.simplifiedSections
        : currentSong.sections
    ).map((sec, sIdx) => {
      if (sIdx !== sectionIndex) return sec
      return {
        ...sec,
        lines: sec.lines.map((ln, lIdx) => {
          if (lIdx !== lineIndex) return ln
          if (ln.kind === 'lyric') {
            return {
              ...ln,
              chords: ln.chords.map((c, cIdx) => (cIdx === chordIndex ? { ...c, chord: baseChord } : c)),
            }
          }
          if (ln.kind === 'chords-only') {
            return {
              ...ln,
              chords: ln.chords.map((c, cIdx) => (cIdx === chordIndex ? baseChord : c)),
            }
          }
          return ln
        }),
      }
    })

    const updatedSong: Song =
      isSimplified && currentSong.simplifiedSections
        ? { ...currentSong, simplifiedSections: baseSections }
        : { ...currentSong, sections: baseSections }

    setSongsData((prev) => new Map(prev).set(currentSong.sourceUrl, updatedSong))

    const updatedSongs = session.songs.map((s) =>
      s.url === currentSong.sourceUrl
        ? {
            ...s,
            customSections: isSimplified ? s.customSections : baseSections,
            customSimplifiedSections: isSimplified ? baseSections : s.customSimplifiedSections,
          }
        : s
    )
    const updatedSession = { ...session, songs: updatedSongs }
    await sessionStore.updateSession(updatedSession)
    setSession(updatedSession)
  }

  const handleDeleteChord = async (
    sectionIndex: number,
    lineIndex: number,
    chordIndex: number
  ) => {
    if (!currentSong || !session) return

    const baseSections: Section[] = (
      isSimplified && currentSong.simplifiedSections
        ? currentSong.simplifiedSections
        : currentSong.sections
    ).map((sec, sIdx) => {
      if (sIdx !== sectionIndex) return sec
      return {
        ...sec,
        lines: sec.lines.map((ln, lIdx) => {
          if (lIdx !== lineIndex) return ln
          if (ln.kind === 'lyric') {
            return {
              ...ln,
              chords: ln.chords.filter((_, cIdx) => cIdx !== chordIndex),
            }
          }
          if (ln.kind === 'chords-only') {
            return {
              ...ln,
              chords: ln.chords.filter((_, cIdx) => cIdx !== chordIndex),
            }
          }
          return ln
        }),
      }
    })

    const updatedSong: Song =
      isSimplified && currentSong.simplifiedSections
        ? { ...currentSong, simplifiedSections: baseSections }
        : { ...currentSong, sections: baseSections }

    setSongsData((prev) => new Map(prev).set(currentSong.sourceUrl, updatedSong))

    const updatedSongs = session.songs.map((s) =>
      s.url === currentSong.sourceUrl
        ? {
            ...s,
            customSections: isSimplified ? s.customSections : baseSections,
            customSimplifiedSections: isSimplified ? baseSections : s.customSimplifiedSections,
          }
        : s
    )
    const updatedSession = { ...session, songs: updatedSongs }
    await sessionStore.updateSession(updatedSession)
    setSession(updatedSession)
  }

  const handleRestoreOriginal = async () => {
    if (!currentSong || !session) return
    const confirmed = window.confirm(
      `Restore "${currentSong.title}" to its original chord sheet? Any custom chord edits or deleted sections will be restored.`
    )
    if (!confirmed) return

    const orig = originalSongs.get(currentSong.sourceUrl) || (await songCache.getSong(currentSong.sourceUrl))
    if (orig) {
      setSongsData((prev) => new Map(prev).set(currentSong.sourceUrl, { ...orig }))
      const updatedSongs = session.songs.map((s) =>
        s.url === currentSong.sourceUrl
          ? { ...s, customSections: undefined, customSimplifiedSections: undefined }
          : s
      )
      const updatedSession = { ...session, songs: updatedSongs }
      await sessionStore.updateSession(updatedSession)
      setSession(updatedSession)
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

  const handleStartRename = () => {
    if (!session) return
    setEditedName(session.name)
    setIsEditingName(true)
  }

  const handleSaveRename = async () => {
    if (!session || !editedName.trim()) {
      setIsEditingName(false)
      return
    }
    const updated = await sessionStore.renameSession(session.id, editedName.trim())
    if (updated) {
      setSession(updated)
    }
    setIsEditingName(false)
  }

  const handleKeyDownRename = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveRename()
    } else if (e.key === 'Escape') {
      setIsEditingName(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Session Title Bar */}
      <div className="flex items-center justify-between pb-2 border-b border-neutral-200 dark:border-[#282828]">
        <div>
          {isEditingName ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                onBlur={handleSaveRename}
                onKeyDown={handleKeyDownRename}
                autoFocus
                className="bg-white dark:bg-[#101010] border border-amber-500 rounded px-2 py-0.5 text-sm font-bold text-neutral-900 dark:text-[#e5e5e5] focus:outline-none"
              />
              <button
                onClick={handleSaveRename}
                className="text-xs bg-amber-500 text-black px-2 py-0.5 rounded font-semibold cursor-pointer"
              >
                Save
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-neutral-900 dark:text-[#e5e5e5]">{session.name}</h1>
              <button
                onClick={handleStartRename}
                title="Rename set"
                className="text-xs text-neutral-500 hover:text-amber-500 p-1 cursor-pointer transition-colors"
              >
                ✎
              </button>
            </div>
          )}
          <p className="text-xs text-neutral-500 dark:text-[#999999]">
            {session.songs.length} song(s) in setlist
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const validSongs = session.songs
                .filter((s) => s.status === 'ok')
                .map((s) => {
                  const song = songsData.get(s.url)
                  const targetKey = song ? targetKeys.get(song.id) : undefined
                  const prefsOverride = song ? songPrefsOverrides.get(song.id) : undefined
                  return {
                    url: s.url,
                    title: s.title,
                    artist: s.artist,
                    targetKey: targetKey && song?.originalKey && targetKey !== song.originalKey ? targetKey : undefined,
                    simplified: prefsOverride?.simplified ?? false,
                    customSections: s.customSections,
                    customSimplifiedSections: s.customSimplifiedSections,
                  }
                })
              setSharingPayload({
                v: 1,
                name: session.name,
                songs: validSongs,
              })
            }}
            className="text-xs bg-neutral-200 hover:bg-neutral-300 dark:bg-[#1a1a1a] dark:hover:bg-[#252525] text-neutral-800 dark:text-[#e5e5e5] dark:border dark:border-[#282828] px-3 py-1.5 rounded transition-colors cursor-pointer flex items-center gap-1.5"
            title="Share setlist via link"
          >
            <span>🔗</span>
            <span>Share</span>
          </button>
          <button
            onClick={() => navigate(`/search?session=${session.id}`)}
            className="text-xs bg-neutral-200 hover:bg-neutral-300 dark:bg-[#1a1a1a] dark:hover:bg-[#252525] text-neutral-800 dark:text-[#e5e5e5] dark:border dark:border-[#282828] px-3 py-1.5 rounded transition-colors cursor-pointer"
          >
            + Add song
          </button>
        </div>
      </div>

      {/* Scrollable Song Tabs */}
      <div className="flex space-x-1.5 overflow-x-auto pb-1.5 pt-1 px-1 no-scrollbar border-b border-neutral-200 dark:border-[#282828] relative">
        {session.songs.map((item, idx) => {
          const isActive = idx === activeIndex
          const song = songsData.get(item.url)
          const label = song?.title || item.title || item.url.replace(/^https?:\/\//, '').slice(0, 18)
          const isDragging = draggedSongIdx === idx
          const isOver = dragOverSongIdx === idx && draggedSongIdx !== null && draggedSongIdx !== idx
          const canDrag = session.songs.length > 1

          return (
            <div
              key={`${item.url}-${idx}`}
              role="tab"
              aria-selected={isActive}
              tabIndex={0}
              draggable={canDrag}
              onDragStart={(e) => handleTabDragStart(e, idx)}
              onDragOver={(e) => handleTabDragOver(e, idx)}
              onDrop={(e) => handleTabDrop(e, idx)}
              onDragEnd={handleTabDragEnd}
              onClick={() => selectSong(idx)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  selectSong(idx)
                }
              }}
              title={canDrag ? 'Drag to reorder songs in setlist' : undefined}
              className={`relative flex items-center space-x-1.5 px-3 py-1.5 rounded-t-lg text-xs font-medium whitespace-nowrap transition-all select-none border-b-2 ${
                canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
              } ${
                isDragging ? 'opacity-40 scale-95' : ''
              } ${
                isActive
                  ? 'bg-neutral-200 dark:bg-[#1a1a1a] text-amber-600 dark:text-amber-400 border-amber-500'
                  : 'bg-neutral-100 dark:bg-[#101010] text-neutral-600 dark:text-[#999999] hover:text-neutral-900 dark:hover:text-[#e5e5e5] border-transparent'
              }`}
            >
              {/* Drop insertion indicator line */}
              {isOver && (
                draggedSongIdx! < idx ? (
                  <div className="absolute -right-1 top-0.5 bottom-0.5 flex flex-col items-center justify-between z-20 pointer-events-none">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    <div className="w-0.5 flex-1 bg-amber-500 shadow-xs" />
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  </div>
                ) : (
                  <div className="absolute -left-1 top-0.5 bottom-0.5 flex flex-col items-center justify-between z-20 pointer-events-none">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    <div className="w-0.5 flex-1 bg-amber-500 shadow-xs" />
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  </div>
                )
              )}

              {canDrag && (
                <span
                  className="text-neutral-400 hover:text-neutral-600 dark:text-[#999999] dark:hover:text-[#e5e5e5] text-xs font-mono select-none -ml-0.5 mr-0.5"
                  title="Drag tab to reorder"
                >
                  ⋮⋮
                </span>
              )}

              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  item.status === 'ok'
                    ? 'bg-emerald-500'
                    : item.status === 'error'
                      ? 'bg-red-500'
                      : 'bg-amber-500 animate-pulse'
                }`}
              />
              <span className="truncate max-w-[140px]">{label}</span>
              {session.songs.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemoveSong(item.url)
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Remove song from setlist"
                  className="text-neutral-400 hover:text-neutral-700 dark:text-[#999999] dark:hover:text-[#e5e5e5] ml-1 p-0.5 leading-none cursor-pointer"
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Main Song Content */}
      {currentItem && (
        <div className="space-y-4">
          {currentItem.status === 'error' ? (
            <div className="p-6 bg-red-50 dark:bg-red-950/20 border border-red-300 dark:border-red-800/40 rounded-xl space-y-3">
              <h3 className="text-red-700 dark:text-red-400 font-semibold text-sm">Failed to extract chord sheet</h3>
              <p className="text-xs font-mono text-neutral-600 dark:text-[#999999] break-all">{currentItem.url}</p>
              <p className="text-xs text-red-600 dark:text-red-300">{currentItem.errorMessage || 'Unknown extraction error'}</p>
              <button
                onClick={() => handleRetry(currentItem)}
                disabled={retryingUrls.has(currentItem.url)}
                className="px-4 py-2 bg-neutral-200 hover:bg-neutral-300 dark:bg-[#1a1a1a] dark:hover:bg-[#252525] dark:border dark:border-[#282828] disabled:opacity-50 text-xs font-medium rounded text-neutral-800 dark:text-[#e5e5e5] transition-colors cursor-pointer"
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
                isModified={isSheetModified}
                onRestoreOriginal={handleRestoreOriginal}
              />

              {/* Controls Toolbar: Transpose Key Selector & Display Controls */}
              <div className="space-y-2">
                <div className="bg-white dark:bg-[#1a1a1a] border border-neutral-200 dark:border-[#282828] rounded-xl p-3 flex flex-wrap items-center justify-between gap-4 shadow-xs">
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
                  canSimplify={canSimplify}
                  isModified={isSheetModified}
                  onRestoreOriginal={handleRestoreOriginal}
                  isEditingChords={isEditingChords}
                  onToggleEditChords={() => setIsEditingChords((prev) => !prev)}
                />
              </div>

              {/* Song Sheet Rendered with Columns and Monospace Offsets */}
              <div className="pt-2">
                <SongSheet
                  sections={displayedSong.sections}
                  fontSizePx={fitResult.fontSizePx}
                  columns={fitResult.columns}
                  isEditingChords={isEditingChords}
                  onDeleteSection={handleDeleteSection}
                  onReorderSections={handleReorderSections}
                  onEditChord={handleEditChord}
                  onDeleteChord={handleDeleteChord}
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

      {/* Share Modal */}
      {sharingPayload && (
        <ShareModal
          payload={sharingPayload}
          isOpen={Boolean(sharingPayload)}
          onClose={() => setSharingPayload(null)}
        />
      )}
    </div>
  )
}
