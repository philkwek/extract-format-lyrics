import { trackSongImport } from '../lib/analytics'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import {
  GripVertical,
  Lightbulb,
  Maximize2,
  Minimize2,
  Pencil,
  Settings2,
  Share2,
  SlidersHorizontal,
  X,
} from 'lucide-react'

import { makeEntryId, sessionStore, type PadKeyMode, type Session, type SessionSongItem } from '../lib/sessionStore'
import { songCache } from '../lib/songCache'
import { scrapeApi, simplifyApi } from '../lib/api'
import { mergeOfficialSimplification } from '../lib/simplification'
import { getDefaultSongPrefs, getSongPrefs, saveSongPrefs, type SongDisplayPrefs } from '../lib/songPrefs'
import { transposeSong, transposeChord, keyUsesFlats } from '../lib/transpose'
import { keyOffset, formatOffset } from '../lib/keys'
import SongHeader from '../components/SongHeader'
import SongSheet from '../components/SongSheet'
import DisplayControls from '../components/DisplayControls'
import PadControls from '../components/PadControls'
import TransposeSelector from '../components/TransposeSelector'
import ShareMenuModal from '../components/ShareMenuModal'
import ArrangeDrawer from '../components/ArrangeDrawer'
import EditSetModal from '../components/EditSetModal'
import { useThemeMode } from '../lib/useThemeMode'

import { getChordPos, setChordPos } from '../lib/chordNudge'
import {
  identityFlow,
  moveSectionInFlow,
  removeSectionFromFlow,
  resolveSessionFlow,
} from '../lib/sectionFlow'
import { mergeSectionLyricLineWithPrevious, splitSectionLyricLine } from '../lib/lineSplit'
import ChordPositionToolbar from '../components/ChordPositionToolbar'
import { buildSharedSetSnapshot, ShareSnapshotError } from '../lib/shareSnapshot'
import type { Song, Section, SharedSetSnapshot } from '../types/song'
import { Button, IconButton } from '../components/ui'
import { getNextTabIndex } from '../lib/tabNavigation'
import { ambientPadPlayer, resolvePadKey, type AmbientPadState, type PadKey } from '../lib/ambientPadPlayer'
import { useChromeVisibility } from '../lib/chromeVisibility'
import { useFitToScreen } from '../lib/useFitToScreen'

const SECTION_EDIT_TIP_STORAGE_KEY = 'has_dismissed_section_edit_tip'

interface PositioningChordState {
  sectionIndex: number
  lineIndex: number
  chordIndex: number
  chord: string
  startPos: number
  currentPos: number
}

export default function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const [session, setSession] = useState<Session | null>(null)
  const [songsData, setSongsData] = useState<Map<string, Song>>(new Map())
  const [originalSongs, setOriginalSongs] = useState<Map<string, Song>>(new Map())
  const [prefsRevision, setPrefsRevision] = useState(0)
  const [retryingUrls, setRetryingUrls] = useState<Set<string>>(new Set())
  const simplificationAttempts = useRef<Set<string>>(new Set())
  const sessionRef = useRef<Session | null>(null)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editedName, setEditedName] = useState('')
  const { isDark: themeDark, setMode: setThemeMode } = useThemeMode()
  const [sharingSnapshot, setSharingSnapshot] = useState<SharedSetSnapshot | null>(null)
  const [draggedSongIdx, setDraggedSongIdx] = useState<number | null>(null)
  const [dragOverSongIdx, setDragOverSongIdx] = useState<number | null>(null)
  const [isEditingChords, setIsEditingChords] = useState(false)
  const [hasLyricOverflow, setHasLyricOverflow] = useState(false)
  const [positioningChord, setPositioningChord] = useState<PositioningChordState | null>(null)
  const [isArrangingSongs, setIsArrangingSongs] = useState(false)
  const [showSectionEditTip, setShowSectionEditTip] = useState<boolean>(() => {
    try {
      return !localStorage.getItem(SECTION_EDIT_TIP_STORAGE_KEY)
    } catch {
      return false
    }
  })
  const [isShareMenuOpen, setIsShareMenuOpen] = useState(false)
  const [isPreparingShare, setIsPreparingShare] = useState(false)
  const [isEditSetOpen, setIsEditSetOpen] = useState(false)
  const [padState, setPadState] = useState<AmbientPadState>(() => ambientPadPlayer.getState())
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [showFullScreenDisplayControls, setShowFullScreenDisplayControls] = useState(false)
  const fullScreenTriggerRef = useRef<HTMLElement | null>(null)
  const tabListRef = useRef<HTMLDivElement | null>(null)
  const { setHidden: setChromeHidden } = useChromeVisibility()

  const handleImportUploadedSongs = async (songs: Song[]) => {
    if (!session) throw new Error('Setlist is unavailable')
    for (const song of songs) {
      await songCache.saveSong(song)
    }
    const newItems: SessionSongItem[] = songs.map((s) => ({
      entryId: makeEntryId(),
      url: s.sourceUrl,
      title: s.title,
      artist: s.artist,
      status: 'ok',
    }))
    const updatedSongs = [...session.songs, ...newItems]
    const updatedSession = { ...session, songs: updatedSongs }
    await sessionStore.updateSession(updatedSession)
    setSession(updatedSession)
    setSongsData((prev) => {
      const next = new Map(prev)
      newItems.forEach((item, index) => next.set(item.entryId!, songs[index]))
      return next
    })
    setOriginalSongs((prev) => {
      const next = new Map(prev)
      newItems.forEach((item, index) => next.set(item.entryId!, songs[index]))
      return next
    })
    trackSongImport('upload', songs.length, songs.length)
    selectSong(session.songs.length)
  }

  const handleDismissSectionEditTip = () => {
    setShowSectionEditTip(false)
    try {
      localStorage.setItem(SECTION_EDIT_TIP_STORAGE_KEY, 'true')
    } catch {
      // ignore
    }
  }

  // Song index from ?song= query param, default 0
  const activeIndex = Math.max(0, parseInt(searchParams.get('song') || '0', 10) || 0)

  const loadSessionSongs = useCallback(async (nextSession: Session) => {
    const map = new Map<string, Song>()
    const origMap = new Map<string, Song>()
    for (const item of nextSession.songs) {
      if (item.status === 'ok') {
        const loaded = await songCache.getSong(item.url)
        if (loaded) {
          origMap.set(item.entryId || item.url, loaded)
          let songToUse = loaded
          if (item.customSections) {
            songToUse = {
              ...songToUse,
              sections: item.customSections,
              flow: item.customFlow ?? identityFlow(item.customSections.length),
            }
          }
          if (item.customSimplifiedSections && songToUse.simplifiedSections) {
            songToUse = {
              ...songToUse,
              simplifiedSections: item.customSimplifiedSections,
              simplifiedFlow:
                item.customSimplifiedFlow ?? identityFlow(item.customSimplifiedSections.length),
            }
          }
          map.set(item.entryId || item.url, songToUse)
        }
      }
    }
    setSongsData(map)
    setOriginalSongs(origMap)
  }, [])

  useEffect(() => {
    if (!sessionId) return
    sessionStore.getSession(sessionId).then(async (s) => {
      if (!s) return
      setSession(s)
      await loadSessionSongs(s)
    })
  }, [sessionId, loadSessionSongs])

  const currentItem = session?.songs[activeIndex]
  const songForItem = (item: SessionSongItem) => songsData.get(item.entryId || item.url)
  const currentSong = currentItem ? songForItem(currentItem) : null

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  // Official simplification is optional enrichment. The original chart is
  // already displayed, and only the simplified fields are merged on success.
  useEffect(() => {
    if (!currentItem || !currentSong) return
    if (!currentSong.simplificationPending || currentSong.simplifiedSource === 'official') return
    // Preserve explicit edits to a simplified chart instead of replacing them.
    if (currentItem.customSimplifiedSections?.length) return

    const key = currentItem.entryId || currentItem.url
    const attempts = simplificationAttempts.current
    if (attempts.has(key)) return
    attempts.add(key)

    const controller = new AbortController()
    void (async () => {
      try {
        const response = await simplifyApi(currentSong.sourceUrl, controller.signal)
        if (controller.signal.aborted || response.status !== 'ok') return

        const currentSessionItem = sessionRef.current?.songs.find(
          (item) => (item.entryId || item.url) === key
        )
        if (currentSessionItem?.customSimplifiedSections?.length) return

        const sourceSong = originalSongs.get(key) ?? currentSong
        const mergedSource = mergeOfficialSimplification(sourceSong, response)
        setOriginalSongs((prev) => new Map(prev).set(key, mergedSource))
        setSongsData((prev) => {
          const latest = prev.get(key)
          if (!latest) return prev
          return new Map(prev).set(key, mergeOfficialSimplification(latest, response))
        })
        await songCache.saveSong(mergedSource, currentItem.url)
      } catch {
        // Enrichment failures leave the original/generated chart usable.
      }
    })()

    return () => {
      controller.abort()
      attempts.delete(key)
    }
  }, [currentItem, currentSong, originalSongs])
  const currentKey = currentSong ? currentItem?.targetKey || currentSong.originalKey : null
  const padKeyMode: PadKeyMode = currentItem?.padKeyMode ?? 'match'
  const customPadKey: PadKey =
    padKeyMode === 'custom'
      ? resolvePadKey(currentItem?.customPadKey) ?? resolvePadKey(currentKey) ?? 'C'
      : resolvePadKey(currentKey) ?? 'C'
  const effectivePadKey = padKeyMode === 'custom' ? customPadKey : currentKey

  useEffect(() => {
    const unsubscribe = ambientPadPlayer.subscribe(setPadState)
    return () => {
      unsubscribe()
      ambientPadPlayer.stop()
    }
  }, [])

  useEffect(() => {
    if (padState.isPlaying && effectivePadKey) {
      void ambientPadPlayer.setKey(effectivePadKey).catch(() => {
        // Ignore audio transition errors
      })
    }
  }, [effectivePadKey, padState.isPlaying])

  const handleTogglePad = () => {
    if (padState.isPlaying) {
      ambientPadPlayer.stop()
    } else if (effectivePadKey) {
      void ambientPadPlayer.play(effectivePadKey).catch(() => {
        // Ignore audio start errors
      })
    }
  }

  // Preference storage is not reactive, so prefsRevision makes a control click
  // render immediately after persisting the new values.
  void prefsRevision
  const prefs = !currentSong
    ? { ...getDefaultSongPrefs(), darkMode: themeDark }
    : {
        ...getSongPrefs(currentSong.id),
        darkMode: themeDark,
        simplified: currentItem?.simplified ?? false,
      }

  const handleUpdatePrefs = (newPrefs: SongDisplayPrefs) => {
    if (newPrefs.darkMode !== themeDark) {
      setThemeMode(newPrefs.darkMode ? 'dark' : 'light')
    }
    if (currentSong && currentItem && session) {
      saveSongPrefs(currentSong.id, { ...newPrefs, simplified: undefined })
      setPrefsRevision((revision) => revision + 1)
      if (newPrefs.simplified !== currentItem.simplified) {
        const updated = { ...session, songs: session.songs.map((item) => item.entryId === currentItem.entryId ? { ...item, simplified: newPrefs.simplified } : item) }
        void sessionStore.updateSession(updated)
        setSession(updated)
      }
    }
  }

  const selectSong = (index: number) => {
    setPositioningChord(null)
    setSearchParams({ song: index.toString() })
  }

  const handleSessionUpdated = async (updatedSession: Session, firstNewIndex?: number) => {
    setSession(updatedSession)
    await loadSessionSongs(updatedSession)
    if (typeof firstNewIndex === 'number') {
      selectSong(firstNewIndex)
    }
  }

  const handleSelectKey = async (newKey: string) => {
    if (!currentItem || !session) return
    const updated = { ...session, songs: session.songs.map((item) => item.entryId === currentItem.entryId ? { ...item, targetKey: newKey } : item) }
    await sessionStore.updateSession(updated)
    setSession(updated)
  }

  const handleResetKey = async () => {
    if (!currentItem || !session) return
    const updated = { ...session, songs: session.songs.map((item) => item.entryId === currentItem.entryId ? { ...item, targetKey: undefined } : item) }
    await sessionStore.updateSession(updated)
    setSession(updated)
  }

  const handleChangePadKeyMode = async (mode: PadKeyMode) => {
    if (!currentItem || !session) return
    if ((currentItem.padKeyMode ?? 'match') === mode) return
    const nextCustomKey =
      mode === 'custom'
        ? resolvePadKey(currentKey) ?? resolvePadKey(currentItem.customPadKey) ?? 'C'
        : undefined
    const updated = {
      ...session,
      songs: session.songs.map((item) =>
        item.entryId === currentItem.entryId
          ? {
              ...item,
              padKeyMode: mode,
              customPadKey: nextCustomKey,
            }
          : item
      ),
    }
    await sessionStore.updateSession(updated)
    setSession(updated)
  }

  const handleSelectCustomPadKey = async (newPadKey: PadKey) => {
    if (!currentItem || !session) return
    const updated = {
      ...session,
      songs: session.songs.map((item) =>
        item.entryId === currentItem.entryId
          ? { ...item, padKeyMode: 'custom' as const, customPadKey: newPadKey }
          : item
      ),
    }
    await sessionStore.updateSession(updated)
    setSession(updated)
  }

  const canSimplify = Boolean(currentSong?.simplifiedSections && currentSong.simplifiedSections.length > 0)
  const isSimplified = Boolean(prefs.simplified && canSimplify)
  const activeSections = useMemo(() => {
    if (isSimplified && currentSong?.simplifiedSections && currentSong.simplifiedSections.length > 0) {
      return currentSong.simplifiedSections
    }
    return currentSong?.sections ?? []
  }, [isSimplified, currentSong])

  const activeFlow = useMemo(
    () =>
      currentSong && currentItem
        ? resolveSessionFlow(currentItem, currentSong, isSimplified, activeSections.length)
        : identityFlow(activeSections.length),
    [activeSections.length, currentItem, currentSong, isSimplified]
  )

  const withUpdatedSections = (
    item: SessionSongItem,
    sections: Section[],
    flow: number[]
  ): SessionSongItem =>
    isSimplified
      ? { ...item, customSimplifiedSections: sections, customSimplifiedFlow: flow }
      : { ...item, customSections: sections, customFlow: flow }

  // Compute transposed song
  const displayedSong = useMemo(() => {
    if (!currentSong) return null
    const baseSong = {
      ...currentSong,
      sections: activeSections,
    }
    const targetKey = currentItem?.targetKey
    if (!targetKey || !currentSong.originalKey || targetKey === currentSong.originalKey) {
      return baseSong
    }
    const offset = keyOffset(currentSong.originalKey, targetKey)
    return transposeSong(baseSong, offset, targetKey)
  }, [currentSong, activeSections, currentItem?.targetKey])

  // Sections rendered on the sheet, incorporating live position draft if positioning a chord
  const displayedSections = useMemo(() => {
    if (!displayedSong) return []
    if (!positioningChord) return displayedSong.sections
    return setChordPos(
      displayedSong.sections,
      positioningChord.sectionIndex,
      positioningChord.lineIndex,
      positioningChord.chordIndex,
      positioningChord.currentPos
    )
  }, [displayedSong, positioningChord])

  const fitEnabled = isFullScreen && (prefs.fitToScreen ?? true)
  const { viewportRef: fitViewportRef, layout: fitLayout } = useFitToScreen({
    enabled: fitEnabled,
    sections: displayedSections,
    preferredColumns: prefs.columns,
    preferredFontSizePx: prefs.fontSizePx,
    revision: showFullScreenDisplayControls,
  })
  const effectiveColumns = fitEnabled ? fitLayout.columns : prefs.columns
  const effectiveFontSizePx = fitEnabled ? fitLayout.fontSizePx : prefs.fontSizePx
  const fitNotice =
    fitEnabled && !fitLayout.fitsOnScreen
      ? 'Smallest readable text applied. Scroll to see the rest.'
      : null
  const fullScreenStatus =
    fitNotice ??
    (hasLyricOverflow
      ? 'Lyric overflow detected. Try fewer columns or a smaller text size.'
      : null) ??
    (fitEnabled
      ? `Auto layout · ${fitLayout.columns} column${
          fitLayout.columns === 1 ? '' : 's'
        } · ${fitLayout.fontSizePx}px`
      : null)

  const handleToggleFit = () => {
    if (!currentSong || !currentItem || !session) return
    handleUpdatePrefs({ ...prefs, fitToScreen: !fitEnabled })
  }

  const handleExitFullScreen = useCallback(() => {
    setIsFullScreen(false)
    setShowFullScreenDisplayControls(false)
    setChromeHidden(false)
    window.setTimeout(() => {
      const storedTrigger = fullScreenTriggerRef.current
      const trigger = storedTrigger?.isConnected
        ? storedTrigger
        : document.querySelector<HTMLElement>('[data-fullscreen-trigger]')
      trigger?.focus()
    }, 0)
  }, [setChromeHidden])

  const handleEnterFullScreen = (trigger?: HTMLElement | null) => {
    fullScreenTriggerRef.current =
      trigger ?? (document.activeElement as HTMLElement | null)
    setIsEditingChords(false)
    setPositioningChord(null)
    setSharingSnapshot(null)
    setIsShareMenuOpen(false)
    setIsEditSetOpen(false)
    setIsArrangingSongs(false)
    setIsFullScreen(true)
    setShowFullScreenDisplayControls(false)
    setChromeHidden(true)
  }

  useEffect(
    () => () => {
      setChromeHidden(false)
    },
    [setChromeHidden]
  )

  useEffect(() => {
    if (!isFullScreen) return
    const html = document.documentElement
    const body = document.body
    const previousHtmlOverflow = html.style.overflow
    const previousBodyOverflow = body.style.overflow
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => {
      html.style.overflow = previousHtmlOverflow
      body.style.overflow = previousBodyOverflow
    }
  }, [isFullScreen])

  useEffect(() => {
    if (!isFullScreen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('input, select, textarea, [role="dialog"]')
      ) {
        return
      }
      if (document.querySelector('[role="dialog"]')) return
      handleExitFullScreen()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isFullScreen, handleExitFullScreen])

  useEffect(() => {
    if (!isFullScreen) return
    const container = tabListRef.current
    const tab = container?.querySelector<HTMLElement>(`[data-song-tab="${activeIndex}"]`)
    if (!container || !tab) return
    const left = tab.offsetLeft
    const right = left + tab.offsetWidth
    if (left < container.scrollLeft) {
      container.scrollTo({ left: Math.max(0, left - 8), behavior: 'smooth' })
    } else if (right > container.scrollLeft + container.clientWidth) {
      container.scrollTo({
        left: right - container.clientWidth + 8,
        behavior: 'smooth',
      })
    }
  }, [activeIndex, isFullScreen])

  const handleRetry = async (item: SessionSongItem) => {
    if (!session || retryingUrls.has(item.url)) return
    setRetryingUrls((prev) => new Set(prev).add(item.url))

    try {
      const response = await scrapeApi([item.url])
      const res = response.results[0]
      if (res && res.status === 'ok' && res.song) {
        await songCache.saveSong(res.song, item.url)
        const updatedSongs = session.songs.map((s) =>
          s.entryId === item.entryId
            ? { ...s, status: 'ok' as const, title: res.song?.title, artist: res.song?.artist, errorMessage: undefined }
            : s
        )
        const updatedSession = { ...session, songs: updatedSongs }
        await sessionStore.updateSession(updatedSession)
        setSession(updatedSession)
        setSongsData((prev) => new Map(prev).set(item.entryId || item.url, res.song!))
        setOriginalSongs((prev) => new Map(prev).set(item.entryId || item.url, res.song!))
      } else {
        const errorMsg = res?.message || 'Retry failed'
        const updatedSongs = session.songs.map((s) =>
          s.entryId === item.entryId ? { ...s, errorMessage: errorMsg } : s
        )
        const updatedSession = { ...session, songs: updatedSongs }
        await sessionStore.updateSession(updatedSession)
        setSession(updatedSession)
      }
    } catch (err) {
      const errorMsg = (err as Error).message || 'Retry network error'
      const updatedSongs = session.songs.map((s) =>
        s.entryId === item.entryId ? { ...s, errorMessage: errorMsg } : s
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

  const handleRemoveSong = async (entryId: string) => {
    if (!session) return
    const updated = await sessionStore.removeSongFromSession(session.id, entryId)
    if (updated) {
      setSession(updated)
      if (activeIndex >= updated.songs.length) {
        setSearchParams({ song: Math.max(0, updated.songs.length - 1).toString() })
      }
    }
  }


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
    const nextFlow = moveSectionInFlow(activeFlow, fromIndex, toIndex)

    const updatedSong: Song = isSimplified && currentSong.simplifiedSections
      ? { ...currentSong, simplifiedSections: baseSections, simplifiedFlow: nextFlow }
      : { ...currentSong, sections: baseSections, flow: nextFlow }

    setSongsData((prev) => new Map(prev).set(currentItem?.entryId || currentSong.sourceUrl, updatedSong))

    // Persist reordered sections to session so it survives page reloads
    const updatedSongs = session.songs.map((s) =>
      s.entryId === currentItem?.entryId
        ? withUpdatedSections(s, baseSections, nextFlow)
        : s
    )
    const updatedSession = { ...session, songs: updatedSongs }
    await sessionStore.updateSession(updatedSession)
    setSession(updatedSession)
  }

  const handleRenameSection = async (sectionIndex: number, newLabel: string) => {
    if (!currentSong || !session) return
    const trimmed = newLabel.trim()
    if (!trimmed) return

    const baseSections = (
      isSimplified && currentSong.simplifiedSections
        ? currentSong.simplifiedSections
        : currentSong.sections
    ).map((sec, idx) => (idx === sectionIndex ? { ...sec, label: trimmed } : sec))

    const updatedSong: Song =
      isSimplified && currentSong.simplifiedSections
        ? { ...currentSong, simplifiedSections: baseSections }
        : { ...currentSong, sections: baseSections }

    setSongsData((prev) => new Map(prev).set(currentItem?.entryId || currentSong.sourceUrl, updatedSong))

    const updatedSongs = session.songs.map((s) =>
      s.entryId === currentItem?.entryId
        ? withUpdatedSections(s, baseSections, activeFlow)
        : s
    )
    const updatedSession = { ...session, songs: updatedSongs }
    await sessionStore.updateSession(updatedSession)
    setSession(updatedSession)
  }

  const handleReorderSongs = async (fromIndex: number, toIndex: number) => {
    if (!session || fromIndex === toIndex) return
    if (fromIndex < 0 || fromIndex >= session.songs.length || toIndex < 0 || toIndex >= session.songs.length) return

    const currentActiveEntryId = session.songs[activeIndex]?.entryId

    const updatedSession = await sessionStore.reorderSongsInSession(session.id, fromIndex, toIndex)
    if (updatedSession) {
      setSession(updatedSession)
      if (currentActiveEntryId) {
        const newActiveIndex = updatedSession.songs.findIndex((s) => s.entryId === currentActiveEntryId)
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
    const repeatCount = activeFlow.filter((index) => index === sectionIndex).length

    const confirmed = window.confirm(
      `Are you sure you want to delete "${label}"?${
        repeatCount > 1 ? `\n\nThis removes ${repeatCount} occurrences that share this section.` : ''
      }\n\nYou can restore it to the original chord sheet at any time.`
    )
    if (!confirmed) return

    const baseSections = isSimplified && currentSong.simplifiedSections
      ? currentSong.simplifiedSections
      : currentSong.sections
    const updatedSections = baseSections.filter((_, idx) => idx !== sectionIndex)
    const nextFlow = removeSectionFromFlow(activeFlow, sectionIndex)

    const updatedSong: Song = isSimplified && currentSong.simplifiedSections
      ? { ...currentSong, simplifiedSections: updatedSections, simplifiedFlow: nextFlow }
      : { ...currentSong, sections: updatedSections, flow: nextFlow }

    setSongsData((prev) => new Map(prev).set(currentItem?.entryId || currentSong.sourceUrl, updatedSong))

    // Persist custom sections to session so it survives page reloads
    const updatedSongs = session.songs.map((s) =>
      s.entryId === currentItem?.entryId
        ? withUpdatedSections(s, updatedSections, nextFlow)
        : s
    )
    const updatedSession = { ...session, songs: updatedSongs }
    await sessionStore.updateSession(updatedSession)
    setSession(updatedSession)
  }

  const handleSplitLine = async (sectionIndex: number, lineIndex: number, splitAt: number) => {
    if (!currentSong || !session) return

    const sourceSections = isSimplified && currentSong.simplifiedSections
      ? currentSong.simplifiedSections
      : currentSong.sections
    const updatedSections = splitSectionLyricLine(sourceSections, sectionIndex, lineIndex, splitAt)
    if (!updatedSections) return

    const updatedSong: Song = isSimplified && currentSong.simplifiedSections
      ? { ...currentSong, simplifiedSections: updatedSections }
      : { ...currentSong, sections: updatedSections }

    setSongsData((prev) => new Map(prev).set(currentItem?.entryId || currentSong.sourceUrl, updatedSong))
    const updatedSongs = session.songs.map((song) =>
      song.entryId === currentItem?.entryId
        ? withUpdatedSections(song, updatedSections, activeFlow)
        : song
    )
    const updatedSession = { ...session, songs: updatedSongs }
    await sessionStore.updateSession(updatedSession)
    setSession(updatedSession)
  }

  const handleMergeLineWithPrevious = async (sectionIndex: number, lineIndex: number) => {
    if (!currentSong || !session) return

    const sourceSections = isSimplified && currentSong.simplifiedSections
      ? currentSong.simplifiedSections
      : currentSong.sections
    const updatedSections = mergeSectionLyricLineWithPrevious(sourceSections, sectionIndex, lineIndex)
    if (!updatedSections) return

    const updatedSong: Song = isSimplified && currentSong.simplifiedSections
      ? { ...currentSong, simplifiedSections: updatedSections }
      : { ...currentSong, sections: updatedSections }

    setSongsData((prev) => new Map(prev).set(currentItem?.entryId || currentSong.sourceUrl, updatedSong))
    const updatedSongs = session.songs.map((song) =>
      song.entryId === currentItem?.entryId
        ? withUpdatedSections(song, updatedSections, activeFlow)
        : song
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
    const currentKey = currentItem?.targetKey || currentSong.originalKey
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

    setSongsData((prev) => new Map(prev).set(currentItem?.entryId || currentSong.sourceUrl, updatedSong))

    const updatedSongs = session.songs.map((s) =>
      s.entryId === currentItem?.entryId
        ? withUpdatedSections(s, baseSections, activeFlow)
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

    setSongsData((prev) => new Map(prev).set(currentItem?.entryId || currentSong.sourceUrl, updatedSong))

    const updatedSongs = session.songs.map((s) =>
      s.entryId === currentItem?.entryId
        ? withUpdatedSections(s, baseSections, activeFlow)
        : s
    )
    const updatedSession = { ...session, songs: updatedSongs }
    await sessionStore.updateSession(updatedSession)
    setSession(updatedSession)
  }

  const handleMoveChord = async (
    sectionIndex: number,
    lineIndex: number,
    chordIndex: number,
    newPos: number
  ) => {
    if (!currentSong || !session) return

    const source =
      isSimplified && currentSong.simplifiedSections
        ? currentSong.simplifiedSections
        : currentSong.sections

    const baseSections = setChordPos(source, sectionIndex, lineIndex, chordIndex, newPos)

    const updatedSong: Song =
      isSimplified && currentSong.simplifiedSections
        ? { ...currentSong, simplifiedSections: baseSections }
        : { ...currentSong, sections: baseSections }

    setSongsData((prev) => new Map(prev).set(currentItem?.entryId || currentSong.sourceUrl, updatedSong))

    const updatedSongs = session.songs.map((s) =>
      s.entryId === currentItem?.entryId
        ? withUpdatedSections(s, baseSections, activeFlow)
        : s
    )
    const updatedSession = { ...session, songs: updatedSongs }
    await sessionStore.updateSession(updatedSession)
    setSession(updatedSession)
  }

  const handleStartEditPosition = (target: {
    sectionIndex: number
    lineIndex: number
    chordIndex: number
    chord: string
  }) => {
    if (!currentSong) return
    const sections =
      isSimplified && currentSong.simplifiedSections
        ? currentSong.simplifiedSections
        : currentSong.sections
    const pos = getChordPos(sections, target.sectionIndex, target.lineIndex, target.chordIndex)
    if (pos === null) return

    setPositioningChord({
      sectionIndex: target.sectionIndex,
      lineIndex: target.lineIndex,
      chordIndex: target.chordIndex,
      chord: target.chord,
      startPos: pos,
      currentPos: pos,
    })
  }

  const handleNudgePosition = (delta: number) => {
    if (!positioningChord || !displayedSong) return
    const line = displayedSong.sections[positioningChord.sectionIndex]?.lines[positioningChord.lineIndex]
    if (!line || line.kind !== 'lyric') return
    const maxPos = line.text.length
    const nextPos = Math.max(0, Math.min(maxPos, positioningChord.currentPos + delta))
    setPositioningChord((prev) => (prev ? { ...prev, currentPos: nextPos } : null))
  }

  const handleCancelPosition = () => {
    setPositioningChord(null)
  }

  const handleSavePosition = async () => {
    if (!positioningChord) return
    await handleMoveChord(
      positioningChord.sectionIndex,
      positioningChord.lineIndex,
      positioningChord.chordIndex,
      positioningChord.currentPos
    )
    setPositioningChord(null)
  }

  const handleRestoreOriginal = async () => {
    setPositioningChord(null)
    if (!currentSong || !session) return
    const confirmed = window.confirm(
      `Restore "${currentSong.title}" to its original chord sheet? Any custom chord edits or deleted sections will be restored.`
    )
    if (!confirmed) return

    const cached = await songCache.getSong(currentSong.sourceUrl)
    const orig = cached || originalSongs.get(currentItem?.entryId || currentSong.sourceUrl)
    if (orig) {
      const freshCopy: Song = JSON.parse(JSON.stringify(orig))
      setSongsData((prev) => new Map(prev).set(currentItem?.entryId || currentSong.sourceUrl, freshCopy))
      const updatedSongs = session.songs.map((s) =>
        s.entryId === currentItem?.entryId
          ? {
              ...s,
              customSections: undefined,
              customFlow: undefined,
              customSimplifiedSections: undefined,
              customSimplifiedFlow: undefined,
            }
          : s
      )
      const updatedSession = { ...session, songs: updatedSongs }
      await sessionStore.updateSession(updatedSession)
      setSession(updatedSession)
    }
  }

  if (!session) {
    return (
      <div className="bg-white dark:bg-[#151515] rounded-2xl shadow-sm p-12 text-center text-neutral-400 text-sm border border-[#C8DFDB]/50 dark:border-[#282828]">
        Session not found. <button onClick={() => navigate('/')} className="text-[#3368A0] dark:text-amber-400 underline cursor-pointer">Return home</button>
      </div>
    )
  }

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

  const handleOpenShareMenu = async () => {
    if (isPreparingShare) return
    setIsPreparingShare(true)
    try {
      setSharingSnapshot(await buildSharedSetSnapshot(session))
      setIsShareMenuOpen(true)
    } catch (err) {
      window.alert(
        err instanceof ShareSnapshotError
          ? err.message
          : 'Unable to prepare this set for sharing.'
      )
    } finally {
      setIsPreparingShare(false)
    }
  }

  return (
    <div
      className={
        isFullScreen
          ? 'flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[var(--ui-canvas)]'
          : 'ui-surface space-y-5 p-4 sm:p-6'
      }
    >
      {/* Session Title Bar */}
      {!isFullScreen && (
        <div className="flex flex-col gap-3 border-b border-[var(--ui-border)] pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  onBlur={handleSaveRename}
                  onKeyDown={handleKeyDownRename}
                  autoFocus
                  className="ui-field max-w-sm px-2.5 py-1.5 text-sm font-bold"
                />
                <Button size="sm" variant="primary" onClick={handleSaveRename}>Save</Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-bold tracking-[-0.025em] text-[var(--ui-text)]">{session.name}</h1>
                <IconButton label="Rename set" variant="ghost" onClick={handleStartRename}><Pencil size={14} /></IconButton>
              </div>
            )}
            <p className="mt-0.5 text-xs text-[var(--ui-text-muted)]">
              {session.songs.length} song(s) in setlist
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              icon={<Share2 size={14} />}
              onClick={handleOpenShareMenu}
              loading={isPreparingShare}
            >
              Share
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<Settings2 size={14} />}
              onClick={() => setIsEditSetOpen(true)}
            >
              Edit Set
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<Maximize2 size={14} />}
              onClick={(event) => handleEnterFullScreen(event.currentTarget)}
              title="Fill the window with this chord sheet"
              aria-label="Full screen"
              data-fullscreen-trigger
            >
              <span className="hidden sm:inline">Full screen</span>
            </Button>
          </div>
        </div>
      )}

      {/* Scrollable Song Tabs */}
      <div
        className={
          isFullScreen
            ? 'flex shrink-0 items-center gap-2 border-b border-[var(--ui-border)] px-2'
            : ''
        }
      >
        <div
          ref={tabListRef}
          className={`no-scrollbar relative flex space-x-1.5 overflow-x-auto ${
            isFullScreen
              ? 'flex-1 py-1.5'
              : 'border-b border-[var(--ui-border)] px-1 pb-2 pt-1'
          }`}
          role="tablist"
          aria-label="Songs in setlist"
        >
          {session.songs.map((item, idx) => {
          const isActive = idx === activeIndex
          const song = songForItem(item)
          const label = song?.title || item.title || item.url.replace(/^https?:\/\//, '').slice(0, 18)
          const isDragging = draggedSongIdx === idx
          const isOver = dragOverSongIdx === idx && draggedSongIdx !== null && draggedSongIdx !== idx
          const canDrag = !isFullScreen && session.songs.length > 1

          return (
            <div
              key={`${item.url}-${idx}`}
              data-song-tab={idx}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
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
                } else {
                  const nextIndex = getNextTabIndex(e.key, idx, session.songs.length)
                  if (nextIndex === null) return
                  e.preventDefault()
                  selectSong(nextIndex)
                  window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-song-tab="${nextIndex}"]`)?.focus())
                }
              }}
              title={canDrag ? 'Drag to reorder songs in setlist' : undefined}
              className={`relative flex min-h-9 items-center space-x-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium outline-none transition-all select-none focus-visible:ring-3 focus-visible:ring-[var(--ui-focus)] ${
                canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
              } ${
                isDragging ? 'opacity-40 scale-95' : ''
              } ${
                isActive
                  ? 'bg-[var(--ui-surface-raised)] text-[#255283] dark:text-amber-400 border-[var(--ui-border-strong)] font-bold shadow-sm'
                  : 'bg-[var(--ui-surface-muted)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)] border-transparent'
              }`}
            >
              {/* Drop insertion indicator line */}
              {isOver && (
                draggedSongIdx! < idx ? (
                  <div className="absolute -right-1 top-0.5 bottom-0.5 flex flex-col items-center justify-between z-20 pointer-events-none">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#3368A0] dark:bg-amber-500" />
                    <div className="w-0.5 flex-1 bg-[#3368A0] dark:bg-amber-500 shadow-xs" />
                    <div className="w-1.5 h-1.5 rounded-full bg-[#3368A0] dark:bg-amber-500" />
                  </div>
                ) : (
                  <div className="absolute -left-1 top-0.5 bottom-0.5 flex flex-col items-center justify-between z-20 pointer-events-none">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#3368A0] dark:bg-amber-500" />
                    <div className="w-0.5 flex-1 bg-[#3368A0] dark:bg-amber-500 shadow-xs" />
                    <div className="w-1.5 h-1.5 rounded-full bg-[#3368A0] dark:bg-amber-500" />
                  </div>
                )
              )}

              {canDrag && (
                <span
                  className="mr-1 text-[var(--ui-text-muted)]"
                  title="Drag tab to reorder"
                >
                  <GripVertical size={13} />
                </span>
              )}

              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  item.status === 'ok'
                    ? 'bg-emerald-500'
                    : item.status === 'error'
                      ? 'bg-red-500'
                      : 'bg-[#3368A0] dark:bg-amber-500 animate-pulse'
                }`}
              />
              <span className="truncate max-w-[140px]">{label}</span>
              {!isFullScreen && session.songs.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemoveSong(item.entryId || '')
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Remove song from setlist"
                  aria-label={`Remove ${label}`}
                  className="ml-1 rounded p-0.5 leading-none text-[var(--ui-text-muted)] transition hover:bg-red-500/10 hover:text-red-500"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )
        })}
        </div>
        {isFullScreen && (
          <Button
            size="sm"
            variant="secondary"
            icon={<Minimize2 size={14} />}
            onClick={handleExitFullScreen}
            title="Exit full screen"
            aria-label="Exit full screen"
            className="shrink-0"
          >
            <span className="hidden sm:inline">Exit full screen</span>
          </Button>
        )}
      </div>

      {/* Main Song Content */}
      {currentItem && (
        <div className={isFullScreen ? 'flex min-h-0 flex-1 flex-col' : 'space-y-4'}>
          {currentItem.status === 'error' ? (
            <div className={isFullScreen ? 'min-h-0 flex-1 overflow-y-auto p-3' : ''}>
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
            </div>
          ) : displayedSong ? (
            <div className={isFullScreen ? 'flex min-h-0 flex-1 flex-col' : 'space-y-4'}>
              {/* Header and Toolbar tightly grouped */}
              <div
                className={
                  isFullScreen
                    ? 'shrink-0 border-b border-[#C8DFDB] px-3 pb-1.5 pt-1.5 dark:border-[#282828]'
                    : 'space-y-1.5 pb-3 border-b border-[#C8DFDB] dark:border-[#282828]'
                }
              >
                {isFullScreen ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <SongHeader
                        song={displayedSong}
                        currentKey={currentKey}
                        offsetDisplay={offset !== 0 ? formatOffset(offset) : undefined}
                        onResetKey={handleResetKey}
                        onSelectKey={handleSelectKey}
                        variant="fullscreen"
                      />
                      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                        <TransposeSelector
                          originalKey={displayedSong.originalKey}
                          currentKey={currentKey}
                          onSelectKey={handleSelectKey}
                          onReset={handleResetKey}
                          compact
                        />
                        <PadControls
                          currentKey={currentKey}
                          padKeyMode={padKeyMode}
                          customPadKey={customPadKey}
                          isPadPlaying={padState.isPlaying}
                          isPadLoading={padState.isLoading}
                          onChangePadKeyMode={handleChangePadKeyMode}
                          onSelectCustomPadKey={handleSelectCustomPadKey}
                          onTogglePad={handleTogglePad}
                          variant="fullscreen"
                        />
                        <Button
                          size="sm"
                          variant={showFullScreenDisplayControls ? 'primary' : 'secondary'}
                          icon={<SlidersHorizontal size={14} />}
                          onClick={() =>
                            setShowFullScreenDisplayControls((visible) => !visible)
                          }
                          aria-expanded={showFullScreenDisplayControls}
                          aria-controls="fullscreen-display-controls"
                          title="Customise song sheet display"
                          aria-label="Customise song sheet display"
                        >
                          <span className="hidden sm:inline">Customise</span>
                        </Button>
                      </div>
                    </div>

                    {showFullScreenDisplayControls && (
                      <div
                        id="fullscreen-display-controls"
                        className="mt-2 border-t border-[var(--ui-border)] pt-2"
                      >
                        <DisplayControls
                          prefs={prefs}
                          onChangePrefs={handleUpdatePrefs}
                          variant="fullscreen"
                          showPads={false}
                          showStatus={false}
                          fitActive={fitEnabled}
                          fitLayout={fitLayout}
                          onToggleFit={handleToggleFit}
                        />
                      </div>
                    )}

                    <div
                      role="status"
                      className="min-h-[14px] text-[10px] leading-[14px] text-[var(--ui-text-muted)]"
                    >
                      {fullScreenStatus ?? '\u00A0'}
                    </div>
                  </>
                ) : (
                  <>
                    <SongHeader
                      song={displayedSong}
                      currentKey={currentKey}
                      offsetDisplay={offset !== 0 ? formatOffset(offset) : undefined}
                      onResetKey={handleResetKey}
                      onSelectKey={handleSelectKey}
                    />

                    <DisplayControls
                      prefs={prefs}
                      onChangePrefs={handleUpdatePrefs}
                      canSimplify={canSimplify}
                      simplifiedSource={currentSong?.simplifiedSource}
                      onRestoreOriginal={handleRestoreOriginal}
                      isEditingChords={isEditingChords}
                      hasLyricOverflow={hasLyricOverflow}
                      isPadPlaying={padState.isPlaying}
                      isPadLoading={padState.isLoading}
                      currentKey={currentKey}
                      padKeyMode={padKeyMode}
                      customPadKey={customPadKey}
                      onChangePadKeyMode={handleChangePadKeyMode}
                      onSelectCustomPadKey={handleSelectCustomPadKey}
                      onTogglePad={handleTogglePad}
                      onToggleEditChords={() => {
                        setIsEditingChords((prev) => {
                          if (prev) {
                            setPositioningChord(null)
                          }
                          return !prev
                        })
                      }}
                    />
                  </>
                )}
              </div>

              {/* Song Sheet Rendered with Columns and Monospace Offsets */}
              <div
                ref={fitViewportRef}
                className={
                  isFullScreen
                    ? `min-h-0 flex-1 px-3 pb-2 pt-2 ${
                        fitEnabled && fitLayout.fitsOnScreen
                          ? 'overflow-hidden'
                          : 'overflow-auto'
                      }`
                    : 'pt-1'
                }
              >
                <SongSheet
                  key={isFullScreen ? 'fullscreen' : 'normal'}
                  sections={displayedSections}
                  fontSizePx={effectiveFontSizePx}
                  columns={effectiveColumns}
                  isEditingChords={isEditingChords}
                  selectedChord={
                    positioningChord
                      ? {
                          sectionIndex: positioningChord.sectionIndex,
                          lineIndex: positioningChord.lineIndex,
                          chordIndex: positioningChord.chordIndex,
                        }
                      : null
                  }
                  onDeleteSection={
                    isFullScreen
                      ? undefined
                      : (idx) => {
                          setPositioningChord(null)
                          handleDeleteSection(idx)
                        }
                  }
                  onReorderSections={
                    isFullScreen
                      ? undefined
                      : (from, to) => {
                          setPositioningChord(null)
                          handleReorderSections(from, to)
                        }
                  }
                  onRenameSection={isFullScreen ? undefined : handleRenameSection}
                  onEditChord={handleEditChord}
                  onDeleteChord={handleDeleteChord}
                  onStartEditPosition={handleStartEditPosition}
                  onSplitLine={handleSplitLine}
                  onMergeLineWithPrevious={handleMergeLineWithPrevious}
                  onLyricOverflowChange={setHasLyricOverflow}
                />
              </div>
            </div>
          ) : (
            <div className={isFullScreen ? 'min-h-0 flex-1 overflow-y-auto p-3' : ''}>
              <div className="py-8 text-center text-xs text-neutral-500 animate-pulse">
                Loading song sheet...
              </div>
            </div>
          )}
        </div>
      )}

      {/* Share Modal */}
      {isShareMenuOpen && sharingSnapshot && session && !isFullScreen && (
        <ShareMenuModal
          snapshot={sharingSnapshot}
          session={session}
          songsData={songsData}
          isOpen={isShareMenuOpen}
          onClose={() => setIsShareMenuOpen(false)}
        />
      )}

      {/* Edit Set Modal */}
      {isEditSetOpen && session && !isFullScreen && (
        <EditSetModal
          isOpen={isEditSetOpen}
          onClose={() => setIsEditSetOpen(false)}
          session={session}
          onArrange={() => {
            setIsEditSetOpen(false)
            setIsArrangingSongs(true)
          }}
          onSessionUpdated={handleSessionUpdated}
          onImportUploadedSongs={handleImportUploadedSongs}
        />
      )}

      {/* Arrange Songs Drawer */}
      <ArrangeDrawer
        isOpen={isArrangingSongs && !isFullScreen}
        title="Arrange Setlist"
        subtitle={`Reorder songs in "${session.name}"`}
        items={session.songs.map((item, idx) => {
          const s = songForItem(item)
          return {
            id: item.entryId || `${item.url}-${idx}`,
            title: s?.title || item.title || item.url.replace(/^https?:\/\//, '').slice(0, 24),
            subtitle: s?.artist || item.artist,
            badge: `#${idx + 1}`,
          }
        })}
        onMove={handleReorderSongs}
        onDelete={session.songs.length > 1 ? (idx) => handleRemoveSong(session.songs[idx].entryId || '') : undefined}
        onClose={() => setIsArrangingSongs(false)}
      />

      {/* Floating Section Customization Helper Tip (First song & first instance only) */}
      {showSectionEditTip && !isFullScreen && activeIndex === 0 && Boolean(displayedSong) && (
        <aside
          role="complementary"
          aria-label="Section customization tip"
          className="ui-surface ui-surface--elevated fixed bottom-4 right-4 z-40 flex max-w-xs flex-col gap-2.5 p-3.5 sm:bottom-6 sm:right-6 sm:max-w-sm"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#255283] dark:text-amber-400">
              <Lightbulb size={14} />
              <span>Customize sections</span>
            </div>
            <IconButton label="Dismiss tip" variant="ghost" onClick={handleDismissSectionEditTip}><X size={14} /></IconButton>
          </div>
          <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
            You can delete duplicate sections with <strong className="text-neutral-800 dark:text-neutral-100">✕</strong>, rename sections with <strong className="text-neutral-800 dark:text-neutral-100">✎</strong>, and reorder them anytime by <strong className="text-neutral-800 dark:text-neutral-100">dragging and dropping</strong>.
          </p>
          <div className="flex justify-end pt-0.5">
            <Button size="sm" variant="primary" onClick={handleDismissSectionEditTip}>Got it</Button>
          </div>
        </aside>
      )}

      {/* Floating Chord Position Adjustment Toolbar */}
      {positioningChord && !isFullScreen && (
        <ChordPositionToolbar
          chord={positioningChord.chord}
          onNudgeLeft={() => handleNudgePosition(-1)}
          onNudgeRight={() => handleNudgePosition(1)}
          onSave={handleSavePosition}
          onCancel={handleCancelPosition}
        />
      )}
    </div>
  )
}
