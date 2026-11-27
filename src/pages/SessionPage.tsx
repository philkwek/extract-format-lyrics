import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  CopyPlus,
  Link2,
  GripVertical,
  Lightbulb,
  ListOrdered,
  Maximize2,
  Minimize2,
  Monitor,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Share2,
  SlidersHorizontal,
  WandSparkles,
  X,
} from 'lucide-react'

import {
  sessionStore,
  sessionPath,
  type PadKeyMode,
  type Session,
  type SessionSongItem,
} from '../lib/sessionStore'
import { songCache } from '../lib/songCache'
import { ensureSetLinkFresh } from '../lib/setLinkSync'
import { isSetLinkId } from '../lib/setLinkIdentity'
import { diffLinkSnapshot, savePreviewAsNew, type SetLinkPreview } from '../lib/setLinkImport'
import SetLinkImportView, {
  type SetLinkFallback,
  type SetLinkNavState,
} from '../components/SetLinkImportView'
import OverlayDialog from '../components/ui/OverlayDialog'
import { scrapeApi, simplifyApi } from '../lib/api'
import { mergeOfficialSimplification } from '../lib/simplification'
import {
  getDefaultSongPrefs,
  getSongPrefs,
  saveSongPrefs,
  type SongDisplayPrefs,
} from '../lib/songPrefs'
import { transposeSong, transposeChord, keyUsesFlats } from '../lib/transpose'
import { songCount } from '../lib/plural'
import { keyOffset } from '../lib/keys'
import SongHeader from '../components/SongHeader'
import FullScreenTitleBlock from '../components/FullScreenTitleBlock'
import SongSheet from '../components/SongSheet'
import SongSwipe from '../components/SongSwipe'
import SheetPage from '../components/SheetPage'
import { getSheetSections } from '../lib/sheetSections'
import DisplayControls from '../components/DisplayControls'
import PadControls from '../components/PadControls'
import TransposeSelector from '../components/TransposeSelector'
import PresentationModal from '../components/PresentationModal'
import ShareMenuModal from '../components/ShareMenuModal'
import LiveShareChip from '../components/share/LiveShareChip'
import HostChangeToast, { type HostNote } from '../components/share/HostChangeToast'
import ChangeToast, { type ChangeNote } from '../components/share/ChangeToast'
import ArrangeDrawer from '../components/ArrangeDrawer'
import EditSetModal from '../components/EditSetModal'
import SyncConflictDialog from '../components/SyncConflictDialog'
import { useThemeMode } from '../lib/useThemeMode'
import { applyPendingRemote, dismissDeleted, keepDeletedCopy, setOpenSet } from '../lib/accountSync'
import { useSyncState } from '../lib/useSyncState'

import { getChordPos, setChordPos } from '../lib/chordNudge'
import {
  identityFlow,
  moveSectionInFlow,
  removeSectionFromFlow,
  resolveSessionFlow,
} from '../lib/sectionFlow'
import { mergeSectionLyricLineWithPrevious, splitSectionLyricLine } from '../lib/lineSplit'
import ChordPositionToolbar from '../components/ChordPositionToolbar'
import type { Song, Section } from '../types/song'
import { Button, IconButton, LivePill, StatusBanner } from '../components/ui'
import {
  liveDotClasses,
  liveToneButtonClasses,
  liveToneClasses,
  type LiveTone,
} from '../components/ui/liveTone'
import { followLiveSet, type FollowController, type FollowStatus } from '../lib/liveFollow'
import { useFollowEditGuard } from '../lib/useFollowEditGuard'
import {
  describeHostChanges,
  mergeHostChanges,
  summarizeHostChanges,
  type HostChange,
} from '../lib/liveChanges'
import { getNextTabIndex } from '../lib/tabNavigation'
import { useSongArrowKeys } from '../lib/useSongArrowKeys'
import { currentSongSender } from '../lib/presenterCurrent'
import { useFullScreenLayout } from '../lib/useMediaQuery'
import { useOnlineStatus } from '../lib/useOnlineStatus'
import { useWakeLock } from '../lib/useWakeLock'
import {
  ambientPadPlayer,
  resolvePadKey,
  type AmbientPadState,
  type PadKey,
} from '../lib/ambientPadPlayer'
import { useChromeVisibility } from '../lib/chromeVisibility'
import type { FitLayout } from '../lib/useFitToScreen'
import { useSeo } from '../lib/useSeo'
import { getFloatingActionMotion } from '../lib/uiMotion'
import { UNDO_WINDOW_MS, usePendingRemoval } from '../lib/usePendingRemoval'

const SECTION_EDIT_TIP_STORAGE_KEY = 'has_dismissed_section_edit_tip'

interface PositioningChordState {
  sectionIndex: number
  lineIndex: number
  chordIndex: number
  chord: string
  startPos: number
  currentPos: number
}

interface SongRemoval {
  kind: 'song'
  entryId: string
  title: string
}

interface SectionRemoval {
  kind: 'section'
  entryId?: string
  index: number
  label: string
  isSimplified: boolean
  sections: Section[]
  flow: number[]
  song: Song
  songKey: string
}

/** One removal can be pending at a time, whichever kind it is. */
type Removal = SongRemoval | SectionRemoval

const FALLBACK_TITLES: Record<SetLinkFallback, string> = {
  expired: 'This set link has expired',
  missing: 'This set link no longer exists',
  empty: 'None of the songs could be loaded',
  error: 'Couldn\u2019t load the latest version',
}

function withSections(
  item: SessionSongItem,
  sections: Section[],
  flow: number[],
  isSimplified: boolean,
): SessionSongItem {
  return isSimplified
    ? { ...item, customSimplifiedSections: sections, customSimplifiedFlow: flow }
    : { ...item, customSections: sections, customFlow: flow }
}

function describeLinkChanges({
  added,
  removed,
  keyChanged,
}: {
  added: number
  removed: number
  keyChanged: number
}): string {
  const parts = [
    added ? `${added} song${added === 1 ? '' : 's'} added` : '',
    removed ? `${removed} removed` : '',
    keyChanged ? `${keyChanged} key${keyChanged === 1 ? '' : 's'} changed` : '',
  ].filter(Boolean)
  return parts.length > 0
    ? `Since you saved it: ${parts.join(', ')}.`
    : 'No songs added, removed or re-keyed.'
}

export default function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const fromSetLink = (location.state as Partial<SetLinkNavState> | null)?.fromSetLink
  // Keyed by id: after navigating to a new copy, a stale "not found" must not render the import view for it.
  const [notFoundId, setNotFoundId] = useState<string | null>(null)
  const [linkPreview, setLinkPreview] = useState<{
    preview: SetLinkPreview
    copy: Session | null
  } | null>(null)
  const [savingPreview, setSavingPreview] = useState(false)
  const [confirmingUpdate, setConfirmingUpdate] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<{ entryId: string; title: string } | null>(
    null,
  )
  const [pendingSectionDelete, setPendingSectionDelete] = useState<{
    index: number
    label: string
    repeatCount: number
  } | null>(null)
  const [previewError, setPreviewError] = useState<ChangeNote | null>(null)
  const [removalError, setRemovalError] = useState<Removal | null>(null)

  const [session, setSession] = useState<Session | null>(null)
  const syncState = useSyncState()
  const syncSetId = session?.id
  const syncDeleted = syncSetId ? syncState.deletedElsewhere.has(syncSetId) : false
  const syncConflict = syncSetId ? syncState.conflicts.has(syncSetId) : false
  const syncPending = syncSetId ? syncState.pendingRemote.has(syncSetId) : false
  const [syncAction, setSyncAction] = useState<'update' | 'keep' | 'back' | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  const setName = session?.name?.trim()
  useSeo({
    title: setName ? `Session · ${setName}` : 'Session · Sets & Sheets',
    noindex: true,
  })
  const hasSession = Boolean(session)
  useWakeLock(hasSession)
  const [songsData, setSongsData] = useState<Map<string, Song>>(new Map())
  const songsDataRef = useRef<Map<string, Song>>(new Map())
  const [originalSongs, setOriginalSongs] = useState<Map<string, Song>>(new Map())
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null)
  const [reloadingSong, setReloadingSong] = useState(false)
  const online = useOnlineStatus()
  const [reloadError, setReloadError] = useState<string | null>(null)
  const [prefsRevision, setPrefsRevision] = useState(0)
  const simplificationAttempts = useRef<Set<string>>(new Set())
  const sessionRef = useRef<Session | null>(null)
  /** Saves a change to one set item, always starting from the latest set. */
  const updateSongItem = useCallback(
    async (entryId: string | undefined, change: (item: SessionSongItem) => SessionSongItem) => {
      const latest = sessionRef.current
      if (!latest) return null
      const updated = {
        ...latest,
        songs: latest.songs.map((item) => (item.entryId === entryId ? change(item) : item)),
      }
      sessionRef.current = updated
      setSession(updated)
      await sessionStore.updateSession(updated)
      return updated
    },
    [],
  )

  const commitRemoval = useCallback(
    async (payload: Removal) => {
      if (payload.kind === 'song') {
        const latest = sessionRef.current
        if (!latest) return
        const updated = {
          ...latest,
          songs: latest.songs.filter((song) => song.entryId !== payload.entryId),
        }
        await sessionStore.updateSession(updated)
        sessionRef.current = updated
        setSession(updated)
        setRemovalError(null)
        return
      }
      const latestSong = songsDataRef.current.get(payload.songKey) ?? payload.song
      const latestItem = sessionRef.current?.songs.find(
        (item) => (item.entryId || item.url) === payload.songKey,
      )
      const currentSections =
        payload.isSimplified && latestSong.simplifiedSections
          ? latestSong.simplifiedSections
          : latestSong.sections
      const currentFlow = latestItem
        ? resolveSessionFlow(latestItem, latestSong, payload.isSimplified, currentSections.length)
        : payload.flow
      const sections = currentSections.filter((_, index) => index !== payload.index)
      const flow = removeSectionFromFlow(currentFlow, payload.index)
      const updatedSong: Song = payload.isSimplified
        ? { ...latestSong, simplifiedSections: sections, simplifiedFlow: flow }
        : { ...latestSong, sections, flow }
      await updateSongItem(payload.entryId, (item) =>
        withSections(item, sections, flow, payload.isSimplified),
      )
      setSongsData((prev) => new Map(prev).set(payload.songKey, updatedSong))
      setRemovalError(null)
    },
    [updateSongItem],
  )

  const {
    pending: pendingRemoval,
    start: startRemoval,
    undo: undoRemoval,
  } = usePendingRemoval<Removal>({ onCommit: commitRemoval, onError: setRemovalError })

  const pendingSongRemoval = pendingRemoval?.kind === 'song' ? pendingRemoval : null
  const pendingSectionRemoval = pendingRemoval?.kind === 'section' ? pendingRemoval : null
  const originalSongsRef = useRef<Map<string, Song>>(new Map())
  const [isEditingName, setIsEditingName] = useState(false)
  const [editedName, setEditedName] = useState('')
  const { isDark: themeDark, setMode: setThemeMode } = useThemeMode()
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
  const [isPresentationModalOpen, setIsPresentationModalOpen] = useState(false)
  const [isShareMenuOpen, setIsShareMenuOpen] = useState(false)
  const [isEditSetOpen, setIsEditSetOpen] = useState(false)
  const [followStatus, setFollowStatus] = useState<FollowStatus>('live')
  const [removedByHost, setRemovedByHost] = useState<{
    item: SessionSongItem
    song: Song | undefined
    index: number
  } | null>(null)
  const followRef = useRef<FollowController | null>(null)
  const viewRef = useRef({
    activeIndex: 0,
    shown: [] as SessionSongItem[],
    songs: new Map<string, Song>(),
  })
  const deferRef = useRef(false)
  const onHostUpdateRef = useRef<(next: Session) => void>(() => {})
  const [hostChanges, setHostChanges] = useState<HostChange[] | null>(null)
  const [padState, setPadState] = useState<AmbientPadState>(() => ambientPadPlayer.getState())
  const [isFullScreen, setIsFullScreen] = useState(false)
  const fullScreenLayout = useFullScreenLayout()
  const isPhonePortrait = fullScreenLayout === 'phone-portrait'
  const isPhoneLandscape = fullScreenLayout === 'phone-landscape'
  const [showFullScreenDisplayControls, setShowFullScreenDisplayControls] = useState(false)
  const [showFloatingFullScreen, setShowFloatingFullScreen] = useState(false)
  const [activeSheetLayout, setActiveSheetLayout] = useState<FitLayout | null>(null)
  const fullScreenTriggerRef = useRef<HTMLElement | null>(null)
  const fullScreenScrollYRef = useRef(0)
  const tabListRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion()
  const floatingFullScreenMotion = getFloatingActionMotion(Boolean(reduceMotion))
  const { setHidden: setChromeHidden } = useChromeVisibility()

  const handleDismissSectionEditTip = () => {
    setShowSectionEditTip(false)
    try {
      localStorage.setItem(SECTION_EDIT_TIP_STORAGE_KEY, 'true')
    } catch {
      // ignore
    }
  }

  // Song index from ?song= query param, default 0
  const rawActiveIndex = Math.max(0, parseInt(searchParams.get('song') || '0', 10) || 0)

  const loadSessionSongs = useCallback(async (nextSession: Session) => {
    const map = new Map<string, Song>()
    const origMap = new Map<string, Song>()
    for (const item of nextSession.songs) {
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
    setSongsData(map)
    setOriginalSongs(origMap)
    setLoadedSessionId(nextSession.id)
    setReloadError(null)
  }, [])

  const adoptSession = useCallback((stored: Session) => {
    sessionRef.current = stored
    setSession(stored)
  }, [])

  const following = Boolean(session?.liveSourceId)
  const handleSavePreview = useCallback(async () => {
    if (!linkPreview) return
    setSavingPreview(true)
    try {
      const saved = await savePreviewAsNew(linkPreview.preview, !linkPreview.copy)
      const nav: SetLinkNavState = { fromSetLink: { kind: 'saved', name: saved.name } }
      navigate(sessionPath(saved), { replace: true, state: nav })
    } catch (err) {
      console.error('Could not save the shared set', err)
      setPreviewError({ text: 'Couldn\u2019t save the set. Try again.' })
    } finally {
      setSavingPreview(false)
    }
  }, [linkPreview, navigate])
  const {
    guard,
    dialog: editGuardDialog,
    isOpenRef: guardOpenRef,
    makeCopy,
  } = useFollowEditGuard({
    following,
    sessionId: session?.id,
    controllerRef: followRef,
    onSavePreview: linkPreview ? handleSavePreview : undefined,
  })
  const setDialogOpen =
    isPresentationModalOpen || isShareMenuOpen || isEditSetOpen || isArrangingSongs

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    sessionStore.getSession(sessionId).then(async (s) => {
      if (cancelled) return
      setRemovedByHost(null)
      setHostChanges(null)
      setLinkPreview(null)
      if (!s) {
        setSession(null)
        setLoadedSessionId(null)
        setNotFoundId(sessionId)
        return
      }
      setNotFoundId(null)
      setLoadedSessionId(null)
      setSession(s)
      // Opened by legacy id: show the shareable address instead.
      if (s.publicId && sessionId !== s.publicId) {
        navigate(sessionPath(s), { replace: true, state: location.state })
      }
      void ensureSetLinkFresh(s)
      await loadSessionSongs(s)
    })
    return () => {
      cancelled = true
    }
    // location.state is only read to carry it across the one-time address replace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, loadSessionSongs, navigate])

  useEffect(() => {
    if (!session?.id) return
    setOpenSet(session.id)
    return () => setOpenSet(null)
  }, [session?.id])

  const shownSongs = useMemo(() => {
    const songs = session?.songs ?? []
    const withHostRemoved = !removedByHost
      ? songs
      : (() => {
          const at = Math.min(removedByHost.index, songs.length)
          return [...songs.slice(0, at), removedByHost.item, ...songs.slice(at)]
        })()
    return pendingSongRemoval
      ? withHostRemoved.filter((item) => item.entryId !== pendingSongRemoval.entryId)
      : withHostRemoved
  }, [session?.songs, removedByHost, pendingSongRemoval])
  const activeIndex = shownSongs.length > 0 ? Math.min(rawActiveIndex, shownSongs.length - 1) : 0
  const currentItem = shownSongs[activeIndex]
  const arrangeSongs = useMemo(
    () => (session?.songs ?? []).filter((item) => item.entryId !== pendingSongRemoval?.entryId),
    [session?.songs, pendingSongRemoval],
  )
  const isRemovedItem = (item: SessionSongItem) =>
    removedByHost !== null && item.entryId === removedByHost.item.entryId
  const songForItem = (item: SessionSongItem) =>
    songsData.get(item.entryId || item.url) ??
    (isRemovedItem(item) ? removedByHost?.song : undefined)
  const currentSong = currentItem ? songForItem(currentItem) : null
  const presenterSessionId = session?.id ?? null
  // Matches the entryId the lyrics link publishes (see extractSongLyrics).
  const currentEntryId = currentItem?.entryId || currentSong?.id || null

  useEffect(() => {
    if (!presenterSessionId || following || !currentEntryId) return
    currentSongSender.notify(presenterSessionId, currentEntryId)
  }, [presenterSessionId, following, currentEntryId])

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    songsDataRef.current = songsData
  }, [songsData])

  useEffect(() => {
    viewRef.current = { activeIndex, shown: shownSongs, songs: songsData }
  }, [activeIndex, shownSongs, songsData])

  useEffect(() => {
    onHostUpdateRef.current = (next) => {
      const { activeIndex: at, shown, songs } = viewRef.current
      const current = shown[at]
      const before = sessionRef.current
      const changes = before ? describeHostChanges(before, next) : []
      if (changes.length) setHostChanges((prev) => mergeHostChanges(prev ?? [], changes))
      adoptSession(next)
      void loadSessionSongs(next)
      if (!current) return
      const nextIndex = next.songs.findIndex((item) => item.entryId === current.entryId)
      if (nextIndex >= 0) {
        setRemovedByHost(null)
        if (nextIndex !== at) setSearchParams({ song: nextIndex.toString() }, { replace: true })
      } else {
        setRemovedByHost((prev) =>
          prev?.item.entryId === current.entryId
            ? prev
            : { item: current, song: songs.get(current.entryId || current.url), index: at },
        )
      }
    }
  }, [adoptSession, loadSessionSongs, setSearchParams])

  useEffect(() => {
    const live = sessionRef.current
    if (!following || !live || live.liveEnded) return
    const controller = followLiveSet(live, {
      onUpdate: (next) => onHostUpdateRef.current(next),
      onStatus: setFollowStatus,
      shouldDefer: () => guardOpenRef.current || deferRef.current,
    })
    followRef.current = controller
    return () => {
      controller.stop()
      followRef.current = null
    }
  }, [following, session?.id, guardOpenRef])

  useEffect(() => {
    deferRef.current = setDialogOpen
    if (!setDialogOpen) followRef.current?.flushDeferred()
  }, [setDialogOpen])

  useEffect(() => {
    originalSongsRef.current = originalSongs
  }, [originalSongs])

  const simplifyKey = currentItem ? currentItem.entryId || currentItem.url : null
  const simplifyUrl = currentSong?.sourceUrl ?? null
  const simplifyNeeded = Boolean(
    currentSong?.simplificationPending && currentSong.simplifiedSource !== 'official',
  )

  // Official simplification is optional enrichment. The original chart is
  // already displayed, and only the simplified fields are merged on success.
  // Depends only on stable primitives so edits do not abort and refire the request.
  useEffect(() => {
    if (!simplifyKey || !simplifyUrl || !simplifyNeeded) return
    const findItem = () =>
      sessionRef.current?.songs.find((item) => (item.entryId || item.url) === simplifyKey)
    // Preserve explicit edits to a simplified chart instead of replacing them.
    if (findItem()?.customSimplifiedSections?.length) return

    const key = simplifyKey
    const attempts = simplificationAttempts.current
    if (attempts.has(key)) return
    attempts.add(key)

    const controller = new AbortController()
    let settled = false
    void (async () => {
      try {
        // String() copy: passing the derived value directly makes React Compiler skip this file.
        const response = await simplifyApi(String(simplifyUrl), controller.signal)
        if (controller.signal.aborted || response.status !== 'ok') return

        const item = findItem()
        if (item?.customSimplifiedSections?.length) return

        const sourceSong = originalSongsRef.current.get(key)
        const mergedSource = sourceSong ? mergeOfficialSimplification(sourceSong, response) : null
        if (mergedSource) setOriginalSongs((prev) => new Map(prev).set(key, mergedSource))
        setSongsData((prev) => {
          const latest = prev.get(key)
          if (!latest) return prev
          return new Map(prev).set(key, mergeOfficialSimplification(latest, response))
        })
        if (mergedSource && item) await songCache.saveSong(mergedSource, item.url)
      } catch {
        // Enrichment failures leave the original/generated chart usable.
      } finally {
        settled = true
      }
    })()

    return () => {
      controller.abort()
      // A finished attempt stays recorded so moving away and back does not retry it.
      if (!settled) attempts.delete(key)
    }
  }, [simplifyKey, simplifyUrl, simplifyNeeded])
  const currentKey = currentSong ? currentItem?.targetKey || currentSong.originalKey : null
  const padKeyMode: PadKeyMode = currentItem?.padKeyMode ?? 'match'
  const customPadKey: PadKey =
    padKeyMode === 'custom'
      ? (resolvePadKey(currentItem?.customPadKey) ?? resolvePadKey(currentKey) ?? 'C')
      : (resolvePadKey(currentKey) ?? 'C')
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
      if (Boolean(newPrefs.simplified) !== Boolean(currentItem.simplified)) {
        setPositioningChord(null)
        guard(() => {
          void updateSongItem(currentItem.entryId, (item) => ({
            ...item,
            simplified: newPrefs.simplified,
          }))
        })
      }
    }
  }

  const selectSong = (index: number) => {
    setPositioningChord(null)
    let target = index
    if (removedByHost) {
      const removedAt = Math.min(removedByHost.index, session?.songs.length ?? 0)
      if (index !== removedAt) {
        setRemovedByHost(null)
        if (index > removedAt) target = index - 1
      }
    }
    setSearchParams({ song: target.toString() })
  }

  useSongArrowKeys({
    enabled: !isEditingChords,
    count: shownSongs.length,
    activeIndex,
    onSelect: selectSong,
  })

  const selectSongRef = useRef(selectSong)
  useEffect(() => {
    selectSongRef.current = selectSong
  })
  const dismissHostNote = useCallback(() => setHostChanges(null), [])
  const hostNote = useMemo<HostNote | null>(() => {
    const summary = hostChanges && summarizeHostChanges(hostChanges)
    if (!summary) return null
    const index = summary.songKey
      ? shownSongs.findIndex((item) => (item.entryId || item.url) === summary.songKey)
      : -1
    return {
      text: summary.text,
      onShow: index >= 0 && index !== activeIndex ? () => selectSongRef.current(index) : undefined,
    }
  }, [hostChanges, shownSongs, activeIndex])

  const undoNote = useMemo<ChangeNote | null>(
    () =>
      pendingRemoval
        ? {
            text: pendingRemoval.kind === 'song' ? 'Song removed' : 'Section removed',
            action: { label: 'Undo', run: undoRemoval },
          }
        : null,
    [pendingRemoval, undoRemoval],
  )

  const undoKey = pendingRemoval
    ? pendingRemoval.kind === 'song'
      ? pendingRemoval.entryId
      : `${pendingRemoval.entryId ?? ''}-${pendingRemoval.index}`
    : undefined

  const dismissUndoToast = useCallback(() => undefined, [])
  const deletionPending = pendingRemoval !== null

  const handleSessionUpdated = async (updatedSession: Session, firstNewIndex?: number) => {
    adoptSession(updatedSession)
    await loadSessionSongs(updatedSession)
    if (typeof firstNewIndex === 'number') {
      selectSong(firstNewIndex)
    }
  }

  const handleSelectKey = async (newKey: string) => {
    if (!currentItem || !session) return
    await updateSongItem(currentItem.entryId, (item) => ({ ...item, targetKey: newKey }))
  }

  const handleResetKey = async () => {
    if (!currentItem || !session) return
    await updateSongItem(currentItem.entryId, (item) => ({ ...item, targetKey: undefined }))
  }

  const handleChangePadKeyMode = async (mode: PadKeyMode) => {
    if (!currentItem || !session) return
    if ((currentItem.padKeyMode ?? 'match') === mode) return
    const nextCustomKey =
      mode === 'custom'
        ? (resolvePadKey(currentKey) ?? resolvePadKey(currentItem.customPadKey) ?? 'C')
        : undefined
    await updateSongItem(currentItem.entryId, (item) => ({
      ...item,
      padKeyMode: mode,
      customPadKey: nextCustomKey,
    }))
  }

  const handleSelectCustomPadKey = async (newPadKey: PadKey) => {
    if (!currentItem || !session) return
    await updateSongItem(currentItem.entryId, (item) => ({
      ...item,
      padKeyMode: 'custom' as const,
      customPadKey: newPadKey,
    }))
  }

  const canSimplify = Boolean(
    currentSong?.simplifiedSections && currentSong.simplifiedSections.length > 0,
  )
  const isSimplified = Boolean(prefs.simplified && canSimplify)
  const baseSections = useMemo(() => {
    if (
      isSimplified &&
      currentSong?.simplifiedSections &&
      currentSong.simplifiedSections.length > 0
    ) {
      return currentSong.simplifiedSections
    }
    return currentSong?.sections ?? []
  }, [isSimplified, currentSong])

  const baseFlow = useMemo(
    () =>
      currentSong && currentItem
        ? resolveSessionFlow(currentItem, currentSong, isSimplified, baseSections.length)
        : identityFlow(baseSections.length),
    [baseSections.length, currentItem, currentSong, isSimplified],
  )

  const subtractedSection =
    pendingSectionRemoval &&
    currentItem &&
    pendingSectionRemoval.entryId === currentItem.entryId &&
    pendingSectionRemoval.isSimplified === isSimplified
      ? pendingSectionRemoval
      : null

  const toBaseSectionIndex = (displayedSectionIndex: number) =>
    subtractedSection && displayedSectionIndex >= subtractedSection.index
      ? displayedSectionIndex + 1
      : displayedSectionIndex

  const activeSections = useMemo(
    () =>
      subtractedSection
        ? baseSections.filter((_, index) => index !== subtractedSection.index)
        : baseSections,
    [baseSections, subtractedSection],
  )

  const activeFlow = useMemo(
    () => (subtractedSection ? removeSectionFromFlow(baseFlow, subtractedSection.index) : baseFlow),
    [baseFlow, subtractedSection],
  )

  const withUpdatedSections = (
    item: SessionSongItem,
    sections: Section[],
    flow: number[],
  ): SessionSongItem => withSections(item, sections, flow, isSimplified)

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
      positioningChord.currentPos,
    )
  }, [displayedSong, positioningChord])

  // Neighbour pages are rendered ahead of a swipe, so they need the same
  // simplified/transposed sections their own prefs would show.
  const previousItem = activeIndex > 0 ? shownSongs[activeIndex - 1] : undefined
  const nextItem = activeIndex < shownSongs.length - 1 ? shownSongs[activeIndex + 1] : undefined
  const previousSong = previousItem ? songForItem(previousItem) : undefined
  const nextSong = nextItem ? songForItem(nextItem) : undefined
  const previousUrl = previousItem?.url
  const previousTargetKey = previousItem?.targetKey
  const previousSimplified = previousItem?.simplified
  const nextUrl = nextItem?.url
  const nextTargetKey = nextItem?.targetKey
  const nextSimplified = nextItem?.simplified
  const previousSections = useMemo(
    () =>
      previousSong && previousUrl
        ? getSheetSections(previousSong, {
            targetKey: previousTargetKey,
            simplified: previousSimplified,
          })
        : [],
    [previousSong, previousUrl, previousTargetKey, previousSimplified],
  )
  const nextSections = useMemo(
    () =>
      nextSong && nextUrl
        ? getSheetSections(nextSong, {
            targetKey: nextTargetKey,
            simplified: nextSimplified,
          })
        : [],
    [nextSong, nextUrl, nextTargetKey, nextSimplified],
  )
  const previousPrefs = previousSong ? getSongPrefs(previousSong.id) : null
  const nextPrefs = nextSong ? getSongPrefs(nextSong.id) : null

  const fitEnabled = isFullScreen && (prefs.fitToScreen ?? true)
  const fitLayout: FitLayout = activeSheetLayout ?? {
    columns: prefs.columns,
    fontSizePx: prefs.fontSizePx,
    fitsOnScreen: true,
  }
  const fullScreenScrollRef = useRef<HTMLDivElement | null>(null)
  const setFullScreenScrollRef = useCallback((node: HTMLDivElement | null) => {
    fullScreenScrollRef.current = node
  }, [])
  const fitNotice =
    fitEnabled && !fitLayout.fitsOnScreen
      ? 'Smallest readable text applied. Scroll to see the rest.'
      : null
  const fullScreenWarning =
    fitNotice ??
    (hasLyricOverflow
      ? 'Lyric overflow detected. Try fewer columns, a smaller text size, or turn on Wrap.'
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
      trigger?.focus({ preventScroll: true })
      window.scrollTo(0, fullScreenScrollYRef.current)
    }, 0)
  }, [setChromeHidden])

  const handleEnterFullScreen = (trigger?: HTMLElement | null) => {
    fullScreenTriggerRef.current = trigger ?? (document.activeElement as HTMLElement | null)
    fullScreenScrollYRef.current = window.scrollY
    setIsEditingChords(false)
    setPositioningChord(null)
    setIsPresentationModalOpen(false)
    setIsShareMenuOpen(false)
    setIsEditSetOpen(false)
    setIsArrangingSongs(false)
    setIsFullScreen(true)
    setShowFloatingFullScreen(false)
    setShowFullScreenDisplayControls(false)
    setChromeHidden(true)
  }

  useEffect(() => {
    if (isFullScreen) return

    let frame = 0
    const update = () => {
      frame = 0
      const trigger = document.querySelector<HTMLElement>('[data-fullscreen-trigger]')
      const headerBottom =
        document.querySelector('[data-app-header]')?.getBoundingClientRect().bottom ?? 0
      const rect = trigger?.getBoundingClientRect()
      const hidden = rect !== undefined && rect.height > 0 && rect.bottom <= headerBottom
      setShowFloatingFullScreen(hidden)
    }
    const schedule = () => {
      if (frame) return
      frame = window.requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [isFullScreen, hasSession])

  useEffect(
    () => () => {
      setChromeHidden(false)
    },
    [setChromeHidden],
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

  // The page is locked in full screen, so the sheet's scroll box takes focus to
  // keep the browser's own scrolling keys (arrows, page keys, space) working.
  useEffect(() => {
    if (!isFullScreen) return
    fullScreenScrollRef.current?.focus({ preventScroll: true })
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

  const confirmRemoveSong = () => {
    if (!pendingRemove) return
    const { entryId, title } = pendingRemove
    const removedIndex = shownSongs.findIndex((item) => item.entryId === entryId)
    const remaining = shownSongs.filter((item) => item.entryId !== entryId).length
    if (removedIndex >= 0 && removedIndex < activeIndex) {
      setSearchParams({ song: (activeIndex - 1).toString() })
    } else if (activeIndex >= remaining) {
      setSearchParams({ song: Math.max(0, remaining - 1).toString() })
    }
    setPendingRemove(null)
    startRemoval({ kind: 'song', entryId, title })
  }

  const handleReorderSections = async (fromIndex: number, toIndex: number) => {
    if (!currentSong || !session || fromIndex === toIndex) return

    const baseSections =
      isSimplified && currentSong.simplifiedSections
        ? [...currentSong.simplifiedSections]
        : [...currentSong.sections]

    if (
      fromIndex < 0 ||
      fromIndex >= baseSections.length ||
      toIndex < 0 ||
      toIndex >= baseSections.length
    ) {
      return
    }

    const [movedSection] = baseSections.splice(fromIndex, 1)
    baseSections.splice(toIndex, 0, movedSection)
    const nextFlow = moveSectionInFlow(activeFlow, fromIndex, toIndex)

    const updatedSong: Song =
      isSimplified && currentSong.simplifiedSections
        ? { ...currentSong, simplifiedSections: baseSections, simplifiedFlow: nextFlow }
        : { ...currentSong, sections: baseSections, flow: nextFlow }

    const songKey = currentItem?.entryId || currentSong.sourceUrl
    setSongsData((prev) => new Map(prev).set(songKey, updatedSong))

    // Persist reordered sections to session so it survives page reloads
    await updateSongItem(currentItem?.entryId, (s) =>
      withUpdatedSections(s, baseSections, nextFlow),
    )
  }

  const handleRenameSection = async (sectionIndex: number, newLabel: string) => {
    if (!currentSong || !session) return
    const trimmed = newLabel.trim()
    if (!trimmed) return
    const targetIndex = toBaseSectionIndex(sectionIndex)

    const nextSections = (
      isSimplified && currentSong.simplifiedSections
        ? currentSong.simplifiedSections
        : currentSong.sections
    ).map((sec, idx) => (idx === targetIndex ? { ...sec, label: trimmed } : sec))

    const updatedSong: Song =
      isSimplified && currentSong.simplifiedSections
        ? { ...currentSong, simplifiedSections: nextSections }
        : { ...currentSong, sections: nextSections }

    const songKey = currentItem?.entryId || currentSong.sourceUrl
    setSongsData((prev) => new Map(prev).set(songKey, updatedSong))

    await updateSongItem(currentItem?.entryId, (s) =>
      withUpdatedSections(s, nextSections, baseFlow),
    )
  }

  const handleReorderSongs = async (fromIndex: number, toIndex: number) => {
    if (!session || fromIndex === toIndex) return
    if (
      fromIndex < 0 ||
      fromIndex >= session.songs.length ||
      toIndex < 0 ||
      toIndex >= session.songs.length
    )
      return

    const currentActiveEntryId = shownSongs[activeIndex]?.entryId

    const updatedSession = await sessionStore.reorderSongsInSession(session.id, fromIndex, toIndex)
    if (updatedSession) {
      setSession(updatedSession)
      if (currentActiveEntryId) {
        const newActiveIndex = updatedSession.songs.findIndex(
          (s) => s.entryId === currentActiveEntryId,
        )
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
      const from = draggedSongIdx
      guard(() => void handleReorderSongs(from, targetIdx))
    }
    setDraggedSongIdx(null)
    setDragOverSongIdx(null)
  }

  const handleTabDragEnd = () => {
    setDraggedSongIdx(null)
    setDragOverSongIdx(null)
  }

  const requestDeleteSection = (sectionIndex: number) => {
    const targetSection = activeSections[sectionIndex]
    const baseIndex = targetSection ? baseSections.indexOf(targetSection) : -1
    const index = baseIndex >= 0 ? baseIndex : sectionIndex
    setPendingSectionDelete({
      index,
      label: targetSection?.label || `Section ${sectionIndex + 1}`,
      repeatCount: baseFlow.filter((entry) => entry === index).length,
    })
  }

  const confirmDeleteSection = () => {
    if (!pendingSectionDelete || !currentItem || !currentSong) return
    const payload: SectionRemoval = {
      kind: 'section',
      entryId: currentItem.entryId,
      index: pendingSectionDelete.index,
      label: pendingSectionDelete.label,
      isSimplified,
      sections: baseSections,
      flow: baseFlow,
      song: currentSong,
      songKey: currentItem.entryId || currentItem.url,
    }
    setPendingSectionDelete(null)
    startRemoval(payload)
  }

  const handleSplitLine = async (sectionIndex: number, lineIndex: number, splitAt: number) => {
    if (!currentSong || !session) return
    const targetIndex = toBaseSectionIndex(sectionIndex)

    const sourceSections =
      isSimplified && currentSong.simplifiedSections
        ? currentSong.simplifiedSections
        : currentSong.sections
    const updatedSections = splitSectionLyricLine(sourceSections, targetIndex, lineIndex, splitAt)
    if (!updatedSections) return

    const updatedSong: Song =
      isSimplified && currentSong.simplifiedSections
        ? { ...currentSong, simplifiedSections: updatedSections }
        : { ...currentSong, sections: updatedSections }

    const songKey = currentItem?.entryId || currentSong.sourceUrl
    setSongsData((prev) => new Map(prev).set(songKey, updatedSong))
    await updateSongItem(currentItem?.entryId, (song) =>
      withUpdatedSections(song, updatedSections, baseFlow),
    )
  }

  const handleMergeLineWithPrevious = async (sectionIndex: number, lineIndex: number) => {
    if (!currentSong || !session) return
    const targetIndex = toBaseSectionIndex(sectionIndex)

    const sourceSections =
      isSimplified && currentSong.simplifiedSections
        ? currentSong.simplifiedSections
        : currentSong.sections
    const updatedSections = mergeSectionLyricLineWithPrevious(
      sourceSections,
      targetIndex,
      lineIndex,
    )
    if (!updatedSections) return

    const updatedSong: Song =
      isSimplified && currentSong.simplifiedSections
        ? { ...currentSong, simplifiedSections: updatedSections }
        : { ...currentSong, sections: updatedSections }

    const songKey = currentItem?.entryId || currentSong.sourceUrl
    setSongsData((prev) => new Map(prev).set(songKey, updatedSong))
    await updateSongItem(currentItem?.entryId, (song) =>
      withUpdatedSections(song, updatedSections, baseFlow),
    )
  }

  const handleEditChord = async (
    sectionIndex: number,
    lineIndex: number,
    chordIndex: number,
    newChord: string,
  ) => {
    if (!currentSong || !session) return
    const targetIndex = toBaseSectionIndex(sectionIndex)

    // If currently transposed, map edited chord back to original key for base storage
    let baseChord = newChord
    const currentKey = currentItem?.targetKey || currentSong.originalKey
    if (currentKey && currentSong.originalKey && currentKey !== currentSong.originalKey) {
      const offset = keyOffset(currentSong.originalKey, currentKey)
      const useFlats = keyUsesFlats(currentSong.originalKey)
      baseChord = transposeChord(newChord, -offset, useFlats)
    }

    const nextSections: Section[] = (
      isSimplified && currentSong.simplifiedSections
        ? currentSong.simplifiedSections
        : currentSong.sections
    ).map((sec, sIdx) => {
      if (sIdx !== targetIndex) return sec
      return {
        ...sec,
        lines: sec.lines.map((ln, lIdx) => {
          if (lIdx !== lineIndex) return ln
          if (ln.kind === 'lyric') {
            return {
              ...ln,
              chords: ln.chords.map((c, cIdx) =>
                cIdx === chordIndex ? { ...c, chord: baseChord } : c,
              ),
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
        ? { ...currentSong, simplifiedSections: nextSections }
        : { ...currentSong, sections: nextSections }

    const songKey = currentItem?.entryId || currentSong.sourceUrl
    setSongsData((prev) => new Map(prev).set(songKey, updatedSong))

    await updateSongItem(currentItem?.entryId, (s) =>
      withUpdatedSections(s, nextSections, baseFlow),
    )
  }

  const handleDeleteChord = async (sectionIndex: number, lineIndex: number, chordIndex: number) => {
    if (!currentSong || !session) return
    const targetIndex = toBaseSectionIndex(sectionIndex)

    const nextSections: Section[] = (
      isSimplified && currentSong.simplifiedSections
        ? currentSong.simplifiedSections
        : currentSong.sections
    ).map((sec, sIdx) => {
      if (sIdx !== targetIndex) return sec
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
        ? { ...currentSong, simplifiedSections: nextSections }
        : { ...currentSong, sections: nextSections }

    const songKey = currentItem?.entryId || currentSong.sourceUrl
    setSongsData((prev) => new Map(prev).set(songKey, updatedSong))

    await updateSongItem(currentItem?.entryId, (s) =>
      withUpdatedSections(s, nextSections, baseFlow),
    )
  }

  const handleMoveChord = async (
    sectionIndex: number,
    lineIndex: number,
    chordIndex: number,
    newPos: number,
  ) => {
    if (!currentSong || !session) return
    const targetIndex = toBaseSectionIndex(sectionIndex)

    const source =
      isSimplified && currentSong.simplifiedSections
        ? currentSong.simplifiedSections
        : currentSong.sections

    const nextSections = setChordPos(source, targetIndex, lineIndex, chordIndex, newPos)

    const updatedSong: Song =
      isSimplified && currentSong.simplifiedSections
        ? { ...currentSong, simplifiedSections: nextSections }
        : { ...currentSong, sections: nextSections }

    const songKey = currentItem?.entryId || currentSong.sourceUrl
    setSongsData((prev) => new Map(prev).set(songKey, updatedSong))

    await updateSongItem(currentItem?.entryId, (s) =>
      withUpdatedSections(s, nextSections, baseFlow),
    )
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
    const pos = getChordPos(
      sections,
      toBaseSectionIndex(target.sectionIndex),
      target.lineIndex,
      target.chordIndex,
    )
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
    const line =
      displayedSong.sections[positioningChord.sectionIndex]?.lines[positioningChord.lineIndex]
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
      positioningChord.currentPos,
    )
    setPositioningChord(null)
  }

  const handleRestoreOriginal = async () => {
    setPositioningChord(null)
    if (!currentSong || !session) return
    const confirmed = window.confirm(
      `Restore "${currentSong.title}" to its original chord sheet? Any custom chord edits or deleted sections will be restored.`,
    )
    if (!confirmed) return

    const cached = await songCache.getSong(currentSong.sourceUrl)
    const orig = cached || originalSongs.get(currentItem?.entryId || currentSong.sourceUrl)
    if (orig) {
      const freshCopy: Song = JSON.parse(JSON.stringify(orig))
      setSongsData((prev) =>
        new Map(prev).set(currentItem?.entryId || currentSong.sourceUrl, freshCopy),
      )
      await updateSongItem(currentItem?.entryId, (s) => ({
        ...s,
        customSections: undefined,
        customFlow: undefined,
        customSimplifiedSections: undefined,
        customSimplifiedFlow: undefined,
      }))
    }
  }

  const guardedSelectKey = (key: string) => guard(() => void handleSelectKey(key))
  const guardedResetKey = () => guard(() => void handleResetKey())
  const guardedChangePadKeyMode = (mode: PadKeyMode) =>
    guard(() => void handleChangePadKeyMode(mode))
  const guardedSelectCustomPadKey = (key: PadKey) => guard(() => void handleSelectCustomPadKey(key))

  if (!session && sessionId && notFoundId === sessionId && isSetLinkId(sessionId)) {
    return (
      <SetLinkImportView
        linkId={sessionId}
        onPreview={(preview, copy) => {
          const previewSession: Session = {
            id: preview.linkId,
            createdAt: 0,
            name: preview.name,
            songs: preview.items,
            ...(preview.failures.length > 0 ? { importFailures: preview.failures } : {}),
          }
          setLinkPreview({ preview, copy })
          adoptSession(previewSession)
          void loadSessionSongs(previewSession)
        }}
      />
    )
  }

  if (!session) {
    return (
      <div className="bg-ui-surface border-ui-border rounded-2xl border p-12 text-center text-sm text-neutral-400 shadow-sm">
        Session not found.{' '}
        <button
          onClick={() => navigate('/')}
          className="text-ui-accent-strong cursor-pointer underline"
        >
          Return home
        </button>
      </div>
    )
  }

  const runSyncAction = async (action: 'update' | 'keep' | 'back', run: () => Promise<void>) => {
    setSyncError(null)
    setSyncAction(action)
    try {
      await run()
    } catch {
      setSyncError("Couldn't update the set. Try again.")
    } finally {
      setSyncAction(null)
    }
  }

  // Sync writes the cloud version to the store; show it now, or go home if it was deleted.
  const reloadFromStore = async () => {
    const stored = await sessionStore.getSession(session.id)
    if (!stored) {
      navigate('/')
      return
    }
    adoptSession(stored)
    void loadSessionSongs(stored)
  }

  const handleUpdateSet = () =>
    runSyncAction('update', async () => {
      await applyPendingRemote(session.id)
      await reloadFromStore()
    })

  const handleKeepCopy = () =>
    runSyncAction('keep', async () => {
      const newId = await keepDeletedCopy(session.id)
      const copy = await sessionStore.getSession(newId)
      if (copy) navigate(sessionPath(copy))
    })

  const handleGoBack = () =>
    runSyncAction('back', async () => {
      await dismissDeleted(session.id)
      navigate('/')
    })

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

  const handleOpenShareMenu = () => setIsShareMenuOpen(true)

  const shownFollowStatus = session.liveEnded ?? followStatus
  const followTone: LiveTone =
    shownFollowStatus === 'stopped' || shownFollowStatus === 'expired'
      ? 'ended'
      : shownFollowStatus === 'reconnecting'
        ? 'reconnecting'
        : 'live'
  const followTitle =
    shownFollowStatus === 'stopped'
      ? 'Live set ended by host'
      : shownFollowStatus === 'expired'
        ? 'Live link expired'
        : 'Live set from host'
  const followText =
    followTone === 'ended'
      ? 'Set no longer updating. Create your own copy to edit.'
      : followTone === 'reconnecting'
        ? 'Reconnecting\u2026 The host\u2019s latest changes will show once you\u2019re back online.'
        : 'You see the host\u2019s changes as they make them. Editing makes your own copy.'

  const dismissSetLinkBanner = () => navigate(sessionPath(session), { replace: true })

  const importFailures = session.importFailures ?? []
  const handleDismissImportFailures = async () => {
    if (linkPreview) {
      adoptSession({ ...session, importFailures: undefined })
      return
    }
    const updated = await sessionStore.dismissImportFailures(session.id)
    if (updated) adoptSession(updated)
  }

  const fallbackTitle =
    fromSetLink && fromSetLink.kind !== 'saved' && fromSetLink.kind !== 'updated'
      ? FALLBACK_TITLES[fromSetLink.kind]
      : null
  const savedCopy = linkPreview?.copy ?? null
  const previewChanges =
    linkPreview && savedCopy?.linkSnapshot
      ? describeLinkChanges(diffLinkSnapshot(savedCopy.linkSnapshot, linkPreview.preview.snapshot))
      : null

  const handleUpdateCopy = async () => {
    if (!linkPreview || !savedCopy) return
    setSavingPreview(true)
    try {
      const updated = await sessionStore.replaceSongsFromLink(
        savedCopy.id,
        linkPreview.preview.items,
        linkPreview.preview.snapshot,
        linkPreview.preview.failures,
      )
      if (updated) {
        const nav: SetLinkNavState = { fromSetLink: { kind: 'updated', name: updated.name } }
        navigate(sessionPath(updated), { replace: true, state: nav })
      } else {
        setPreviewError({ text: 'Couldn\u2019t find your saved copy. Use Save as new instead.' })
      }
    } catch (err) {
      console.error('Could not update the saved copy', err)
      setPreviewError({ text: 'Couldn\u2019t update your copy. Try again.' })
    } finally {
      setSavingPreview(false)
      setConfirmingUpdate(false)
    }
  }

  const neighbourTitle = (item: SessionSongItem | undefined) =>
    item ? songForItem(item)?.title || item.title || item.url : ''
  const prevTitle = neighbourTitle(activeIndex > 0 ? shownSongs[activeIndex - 1] : undefined)
  const nextTitle = neighbourTitle(
    activeIndex < shownSongs.length - 1 ? shownSongs[activeIndex + 1] : undefined,
  )

  const sheetPages: ReactNode[] = []
  if (previousItem && previousSong && previousPrefs) {
    sheetPages.push(
      <SheetPage
        key={previousItem.entryId || previousItem.url}
        offset={-1}
        active={false}
        sections={previousSections}
        titleBlock={<FullScreenTitleBlock song={previousSong} />}
        columns={previousPrefs.columns}
        fontSizePx={previousPrefs.fontSizePx}
        fitToScreen={previousPrefs.fitToScreen ?? true}
        wrapLines={previousPrefs.wrapLines ?? false}
        revision={showFullScreenDisplayControls}
        scrollRef={setFullScreenScrollRef}
      />,
    )
  }
  if (currentItem && currentSong) {
    sheetPages.push(
      <SheetPage
        key={currentItem.entryId || currentItem.url}
        offset={0}
        active
        sections={
          // Reuse the exact array the page had as a neighbour unless an edit is in progress.
          positioningChord || subtractedSection
            ? displayedSections
            : getSheetSections(currentSong, currentItem)
        }
        titleBlock={<FullScreenTitleBlock song={currentSong} warning={fullScreenWarning} />}
        columns={prefs.columns}
        fontSizePx={prefs.fontSizePx}
        fitToScreen={prefs.fitToScreen ?? true}
        wrapLines={prefs.wrapLines ?? false}
        revision={showFullScreenDisplayControls}
        onLayoutChange={setActiveSheetLayout}
        scrollRef={setFullScreenScrollRef}
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
        onEditChord={(section, line, chord, value) =>
          guard(() => void handleEditChord(section, line, chord, value))
        }
        onDeleteChord={(section, line, chord) =>
          guard(() => void handleDeleteChord(section, line, chord))
        }
        onStartEditPosition={(target) => guard(() => handleStartEditPosition(target))}
        onSplitLine={(section, line, at) => guard(() => void handleSplitLine(section, line, at))}
        onMergeLineWithPrevious={(section, line) =>
          guard(() => void handleMergeLineWithPrevious(section, line))
        }
        onLyricOverflowChange={setHasLyricOverflow}
      />,
    )
  }
  if (nextItem && nextSong && nextPrefs) {
    sheetPages.push(
      <SheetPage
        key={nextItem.entryId || nextItem.url}
        offset={1}
        active={false}
        sections={nextSections}
        titleBlock={<FullScreenTitleBlock song={nextSong} />}
        columns={nextPrefs.columns}
        fontSizePx={nextPrefs.fontSizePx}
        fitToScreen={nextPrefs.fitToScreen ?? true}
        wrapLines={nextPrefs.wrapLines ?? false}
        revision={showFullScreenDisplayControls}
        scrollRef={setFullScreenScrollRef}
      />,
    )
  }

  return (
    <div
      className={
        isFullScreen
          ? 'flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[var(--ui-canvas)]'
          : 'space-y-3 px-1 sm:px-0'
      }
    >
      {!isFullScreen && linkPreview && (
        <StatusBanner
          tone="info"
          icon={<Link2 size={16} />}
          title="Read-Only Preview"
          actions={
            savedCopy ? (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  loading={savingPreview}
                  onClick={() => setConfirmingUpdate(true)}
                >
                  Update my copy
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={savingPreview}
                  onClick={() => void handleSavePreview()}
                >
                  Save as new
                </Button>
                <Button size="sm" variant="ghost" onClick={() => navigate(sessionPath(savedCopy))}>
                  Open my copy
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="primary"
                loading={savingPreview}
                onClick={() => void handleSavePreview()}
              >
                Save
              </Button>
            )
          }
        >
          <p>
            {savedCopy
              ? 'You saved a copy of this set before.'
              : 'This is a shared set. Save to keep it on your device.'}
          </p>
          {previewChanges && <p className="mt-1 text-xs">{previewChanges}</p>}
        </StatusBanner>
      )}

      {!isFullScreen && fromSetLink && (
        <StatusBanner
          tone="info"
          icon={fallbackTitle ? <CloudOff size={16} /> : <CheckCircle2 size={16} />}
          title={fallbackTitle ?? (fromSetLink.kind === 'updated' ? 'Copy Updated' : 'Set Saved')}
          actions={
            <Button size="sm" variant="ghost" onClick={dismissSetLinkBanner}>
              Dismiss
            </Button>
          }
        >
          {fallbackTitle
            ? 'Showing your saved copy of the shared set.'
            : fromSetLink.kind === 'updated'
              ? 'Your copy now matches the shared set. It won\u2019t update when the sender makes changes.'
              : `Saved to your sets as \u201c${fromSetLink.name}\u201d. It won\u2019t update when the sender makes changes. Chart edits and uploaded sheets aren\u2019t included.`}
        </StatusBanner>
      )}

      {!isFullScreen && syncError && (
        <StatusBanner tone="error" icon={<AlertTriangle size={16} />}>
          {syncError}
        </StatusBanner>
      )}

      {!isFullScreen && syncDeleted && (
        <StatusBanner
          tone="warning"
          icon={<AlertTriangle size={16} />}
          title="This set was deleted on another device."
          actions={
            <>
              <Button
                size="sm"
                variant="primary"
                disabled={syncAction !== null}
                loading={syncAction === 'keep'}
                onClick={() => void handleKeepCopy()}
              >
                Keep a copy
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={syncAction !== null}
                loading={syncAction === 'back'}
                onClick={() => void handleGoBack()}
              >
                Go back
              </Button>
            </>
          }
        >
          <p>Keep a copy saves it as a new set. Go back removes it from this device.</p>
        </StatusBanner>
      )}

      {!isFullScreen && !syncDeleted && syncConflict && (
        <StatusBanner
          tone="warning"
          icon={<AlertTriangle size={16} />}
          title="This set changed on this device and on another device."
          actions={
            <Button size="sm" variant="primary" onClick={() => setConflictOpen(true)}>
              Review
            </Button>
          }
        >
          <p>Choose which version to keep.</p>
        </StatusBanner>
      )}

      {!isFullScreen && !syncDeleted && !syncConflict && syncPending && (
        <StatusBanner
          tone="info"
          icon={<RefreshCw size={16} />}
          title="This set was changed on another device."
          actions={
            <Button
              size="sm"
              variant="primary"
              loading={syncAction === 'update'}
              onClick={() => void handleUpdateSet()}
            >
              Update set
            </Button>
          }
        >
          <p>The latest version is ready to load.</p>
        </StatusBanner>
      )}

      {!isFullScreen && importFailures.length > 0 && (
        <StatusBanner
          tone="warning"
          icon={<AlertTriangle size={16} />}
          title={
            importFailures.length === 1
              ? 'This link couldn’t be added'
              : `These ${importFailures.length} links couldn’t be added`
          }
          actions={
            <Button size="sm" variant="ghost" onClick={handleDismissImportFailures}>
              Dismiss
            </Button>
          }
        >
          <ul className="mt-1 space-y-0.5 text-xs">
            {importFailures.map((failure) => (
              <li key={failure.url}>
                <span className="font-mono break-all">{failure.url}</span> {'—'} {failure.reason}
              </li>
            ))}
          </ul>
        </StatusBanner>
      )}

      {!isFullScreen && session.liveSourceId && (
        <StatusBanner
          tone={null}
          className={liveToneClasses[followTone]}
          icon={<span className={`h-2.5 w-2.5 rounded-full ${liveDotClasses[followTone]}`} />}
          title={followTitle}
          actions={
            <Button
              size="sm"
              variant="secondary"
              className={liveToneButtonClasses[followTone]}
              icon={<CopyPlus size={14} />}
              onClick={makeCopy}
            >
              Create a copy
            </Button>
          }
        >
          <p className="text-[var(--ui-text-muted)]">{followText}</p>
        </StatusBanner>
      )}

      {!isFullScreen && removalError && (
        <StatusBanner
          tone="error"
          actions={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const payload = removalError
                setRemovalError(null)
                startRemoval(payload)
              }}
            >
              Try again
            </Button>
          }
        >
          {`Couldn't remove "${
            removalError.kind === 'song' ? removalError.title : removalError.label
          }". Nothing was removed.`}
        </StatusBanner>
      )}

      {/* Session Title Bar */}
      {!isFullScreen && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                <Button size="sm" variant="primary" onClick={handleSaveRename}>
                  Save
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-bold tracking-[-0.025em] text-[var(--ui-text)]">
                  {session.name}
                </h1>
                {session.liveSourceId && (
                  <LivePill tone={followTone}>
                    <Radio size={11} aria-hidden="true" />
                    {followTone === 'ended' ? 'Live set ended' : 'Live set'}
                  </LivePill>
                )}
                <LiveShareChip sessionId={session.id} />
                <IconButton
                  label="Rename set"
                  variant="ghost"
                  onClick={() => guard(handleStartRename)}
                >
                  <Pencil size={14} />
                </IconButton>
              </div>
            )}
            <p className="mt-0.5 text-xs text-[var(--ui-text-muted)]">
              {songCount(shownSongs.length)} in setlist
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus size={14} />}
              onClick={() => guard(() => setIsEditSetOpen(true))}
            >
              Add song
            </Button>
            {!linkPreview && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Monitor size={14} />}
                  onClick={() => setIsPresentationModalOpen(true)}
                >
                  Start presentation
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Share2 size={14} />}
                  onClick={handleOpenShareMenu}
                >
                  Share set/lyrics
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="secondary"
              icon={<Maximize2 size={14} />}
              onClick={(event) => handleEnterFullScreen(event.currentTarget)}
              title="Fill the window with this chord sheet"
              aria-label="Go full screen"
              data-fullscreen-trigger
            >
              <span className="hidden sm:inline">Go full screen</span>
            </Button>
          </div>
        </div>
      )}

      {/* Scrollable Song Tabs */}
      <div
        className={
          isFullScreen
            ? isPhonePortrait
              ? 'grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-[var(--ui-border)] px-3 py-2'
              : `flex shrink-0 items-center gap-2 border-b border-[var(--ui-border)] px-2${
                  isPhoneLandscape ? 'fullscreen-compact-row' : ''
                }`
            : 'flex items-center gap-2 border-y border-[var(--ui-border)] py-3'
        }
      >
        {!isFullScreen && session.songs.length > 1 && (
          <Button
            size="sm"
            variant="secondary"
            icon={<ListOrdered size={14} />}
            onClick={() => guard(() => setIsArrangingSongs(true))}
            aria-label="Arrange setlist"
            title="Arrange setlist"
            className="h-9 shrink-0"
          >
            <span className="hidden sm:inline">Arrange setlist</span>
          </Button>
        )}
        <div
          ref={tabListRef}
          className={`no-scrollbar relative flex overflow-x-auto ${
            isFullScreen
              ? `min-w-0 flex-1 space-x-1.5 ${isPhonePortrait ? 'col-start-1 row-start-1' : isPhoneLandscape ? 'py-1' : 'py-1.5'}`
              : '-m-[3px] min-w-0 flex-1 items-center gap-2 p-[3px]'
          }`}
          role="tablist"
          aria-label="Songs in setlist"
        >
          {shownSongs.map((item, idx) => {
            const isActive = idx === activeIndex
            const song = songForItem(item)
            const label =
              song?.title || item.title || item.url.replace(/^https?:\/\//, '').slice(0, 18)
            const tabLabel = isRemovedItem(item) ? `${label} (removed)` : label
            const isDragging = draggedSongIdx === idx
            const isOver =
              dragOverSongIdx === idx && draggedSongIdx !== null && draggedSongIdx !== idx
            const canDrag =
              !isFullScreen && shownSongs.length > 1 && !removedByHost && !pendingSongRemoval

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
                    const nextIndex = getNextTabIndex(e.key, idx, shownSongs.length)
                    if (nextIndex === null) return
                    e.preventDefault()
                    selectSong(nextIndex)
                    window.requestAnimationFrame(() =>
                      document
                        .querySelector<HTMLElement>(`[data-song-tab="${nextIndex}"]`)
                        ?.focus(),
                    )
                  }
                }}
                title={canDrag ? 'Drag to reorder songs in setlist' : undefined}
                className={`relative flex min-h-9 items-center space-x-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-3 focus-visible:ring-[var(--ui-focus)] ${
                  canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                } ${isDragging ? 'scale-95 opacity-40' : ''} ${
                  isActive
                    ? 'border-[var(--ui-border-strong)] bg-[var(--ui-surface-raised)] font-bold text-[#255283] shadow-sm dark:text-amber-400'
                    : 'border-transparent bg-[var(--ui-surface-muted)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'
                }`}
              >
                {/* Drop insertion indicator line */}
                {isOver &&
                  (draggedSongIdx! < idx ? (
                    <div className="pointer-events-none absolute top-0.5 -right-1 bottom-0.5 z-20 flex flex-col items-center justify-between">
                      <div className="h-1.5 w-1.5 rounded-full bg-[#3368A0] dark:bg-amber-500" />
                      <div className="w-0.5 flex-1 bg-[#3368A0] shadow-xs dark:bg-amber-500" />
                      <div className="h-1.5 w-1.5 rounded-full bg-[#3368A0] dark:bg-amber-500" />
                    </div>
                  ) : (
                    <div className="pointer-events-none absolute top-0.5 bottom-0.5 -left-1 z-20 flex flex-col items-center justify-between">
                      <div className="h-1.5 w-1.5 rounded-full bg-[#3368A0] dark:bg-amber-500" />
                      <div className="w-0.5 flex-1 bg-[#3368A0] shadow-xs dark:bg-amber-500" />
                      <div className="h-1.5 w-1.5 rounded-full bg-[#3368A0] dark:bg-amber-500" />
                    </div>
                  ))}

                {canDrag && (
                  <span className="mr-1 text-[var(--ui-text-muted)]" title="Drag tab to reorder">
                    <GripVertical size={13} />
                  </span>
                )}

                <span className="max-w-[140px] truncate">{tabLabel}</span>
                {!isFullScreen && shownSongs.length > 1 && !isRemovedItem(item) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      guard(() => setPendingRemove({ entryId: item.entryId || '', title: label }))
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
        {isFullScreen && displayedSong && (
          <div
            className={
              isPhonePortrait
                ? 'col-span-2 row-start-2 flex flex-wrap items-center gap-2'
                : 'flex shrink-0 items-center gap-2'
            }
          >
            <TransposeSelector
              originalKey={displayedSong.originalKey}
              currentKey={currentKey}
              onSelectKey={guardedSelectKey}
              onReset={guardedResetKey}
              compact
            />
            {canSimplify && (
              <Button
                size="sm"
                variant="secondary"
                pressed={Boolean(prefs.simplified)}
                icon={<WandSparkles size={14} />}
                onClick={() => handleUpdatePrefs({ ...prefs, simplified: !prefs.simplified })}
                aria-label={prefs.simplified ? 'Simplified' : 'Simplify'}
                title={
                  prefs.simplified
                    ? currentSong?.simplifiedSource === 'algorithmic'
                      ? 'Simplified chords are active. Extra chord notes may be removed.'
                      : 'Simplified chords are active'
                    : 'Use simpler chords where possible'
                }
              >
                <span className="hidden lg:inline">
                  {prefs.simplified ? 'Simplified' : 'Simplify'}
                </span>
              </Button>
            )}
            <PadControls
              currentKey={currentKey}
              padKeyMode={padKeyMode}
              customPadKey={customPadKey}
              isPadPlaying={padState.isPlaying}
              isPadLoading={padState.isLoading}
              onChangePadKeyMode={guardedChangePadKeyMode}
              onSelectCustomPadKey={guardedSelectCustomPadKey}
              onTogglePad={handleTogglePad}
              variant="fullscreen"
            />
            <Button
              size="sm"
              variant="secondary"
              pressed={showFullScreenDisplayControls}
              icon={<SlidersHorizontal size={14} />}
              onClick={() => setShowFullScreenDisplayControls((visible) => !visible)}
              aria-expanded={showFullScreenDisplayControls}
              aria-controls="fullscreen-display-controls"
              title="Customise song sheet display"
              aria-label="Customise song sheet display"
            >
              <span className="hidden lg:inline">Customise</span>
            </Button>
          </div>
        )}
        {isFullScreen && (
          <Button
            size="sm"
            variant="secondary"
            icon={<Minimize2 size={14} />}
            onClick={handleExitFullScreen}
            title="Exit full screen"
            aria-label="Exit full screen"
            className={`shrink-0${isPhonePortrait ? 'col-start-2 row-start-1' : ''}`}
          >
            <span className="hidden lg:inline">Exit full screen</span>
          </Button>
        )}
      </div>

      {currentItem && isRemovedItem(currentItem) && (
        <StatusBanner tone="warning">
          Removed by the host. This song stays here until you move to another song.
        </StatusBanner>
      )}

      {/* Main Song Content */}
      {currentItem && (
        <div className={isFullScreen ? 'flex min-h-0 flex-1 flex-col' : 'space-y-4'}>
          {displayedSong ? (
            <div className={isFullScreen ? 'flex min-h-0 flex-1 flex-col' : 'space-y-3'}>
              {/* Header and Toolbar tightly grouped */}
              <div
                className={
                  isFullScreen
                    ? showFullScreenDisplayControls
                      ? 'border-ui-border shrink-0 border-b px-3 py-1.5'
                      : 'hidden'
                    : 'border-ui-border space-y-1.5 border-b pb-2'
                }
              >
                {isFullScreen ? (
                  showFullScreenDisplayControls && (
                    <div id="fullscreen-display-controls">
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
                  )
                ) : (
                  <>
                    <SongHeader song={displayedSong} />

                    <DisplayControls
                      prefs={prefs}
                      onChangePrefs={handleUpdatePrefs}
                      canSimplify={canSimplify}
                      simplifiedSource={currentSong?.simplifiedSource}
                      onRestoreOriginal={
                        currentItem?.customSections !== undefined ||
                        currentItem?.customSimplifiedSections !== undefined ||
                        isEditingChords
                          ? () => guard(() => void handleRestoreOriginal())
                          : undefined
                      }
                      isEditingChords={isEditingChords}
                      hasLyricOverflow={hasLyricOverflow}
                      isPadPlaying={padState.isPlaying}
                      isPadLoading={padState.isLoading}
                      originalKey={displayedSong.originalKey}
                      currentKey={currentKey}
                      onSelectKey={guardedSelectKey}
                      onResetKey={guardedResetKey}
                      padKeyMode={padKeyMode}
                      customPadKey={customPadKey}
                      onChangePadKeyMode={guardedChangePadKeyMode}
                      onSelectCustomPadKey={guardedSelectCustomPadKey}
                      onTogglePad={handleTogglePad}
                      onToggleEditChords={() => {
                        const toggle = () =>
                          setIsEditingChords((prev) => {
                            if (prev) {
                              setPositioningChord(null)
                            }
                            return !prev
                          })
                        if (isEditingChords) toggle()
                        else guard(toggle)
                      }}
                    />
                  </>
                )}
              </div>

              {/* Song Sheet Rendered with Columns and Monospace Offsets */}
              {isFullScreen ? (
                <SongSwipe
                  contentKey={currentItem.entryId || currentItem.url}
                  enabled={!isEditingChords}
                  canPrev={activeIndex > 0}
                  canNext={activeIndex < shownSongs.length - 1}
                  prevTitle={prevTitle}
                  nextTitle={nextTitle}
                  onPrev={() => selectSong(Math.max(0, activeIndex - 1))}
                  onNext={() => selectSong(Math.min(shownSongs.length - 1, activeIndex + 1))}
                >
                  {sheetPages}
                </SongSwipe>
              ) : (
                <div className="pt-1">
                  <SongSheet
                    sections={displayedSections}
                    fontSizePx={prefs.fontSizePx}
                    columns={prefs.columns}
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
                    onDeleteSection={(idx) =>
                      guard(() => {
                        setPositioningChord(null)
                        requestDeleteSection(idx)
                      })
                    }
                    onReorderSections={
                      pendingSectionRemoval
                        ? undefined
                        : (from, to) =>
                            guard(() => {
                              setPositioningChord(null)
                              void handleReorderSections(from, to)
                            })
                    }
                    onRenameSection={(index, label) =>
                      guard(() => void handleRenameSection(index, label))
                    }
                    onEditChord={(section, line, chord, value) =>
                      guard(() => void handleEditChord(section, line, chord, value))
                    }
                    onDeleteChord={(section, line, chord) =>
                      guard(() => void handleDeleteChord(section, line, chord))
                    }
                    onStartEditPosition={(target) => guard(() => handleStartEditPosition(target))}
                    onSplitLine={(section, line, at) =>
                      guard(() => void handleSplitLine(section, line, at))
                    }
                    onMergeLineWithPrevious={(section, line) =>
                      guard(() => void handleMergeLineWithPrevious(section, line))
                    }
                    onLyricOverflowChange={setHasLyricOverflow}
                    wrapLines={prefs.wrapLines}
                  />
                </div>
              )}
            </div>
          ) : loadedSessionId === session.id ? (
            <div className={isFullScreen ? 'min-h-0 flex-1 overflow-y-auto p-3' : ''}>
              <StatusBanner
                tone={reloadError ? 'error' : 'warning'}
                icon={<AlertTriangle size={16} />}
                title={
                  online
                    ? 'This song sheet isn’t saved in this browser.'
                    : 'This song sheet isn’t saved on this device.'
                }
                actions={
                  online && currentItem.url.startsWith('https://') ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={reloadingSong}
                      onClick={async () => {
                        setReloadingSong(true)
                        setReloadError(null)
                        try {
                          const res = await scrapeApi([currentItem.url])
                          const first = res.results[0]
                          if (first?.status === 'ok' && first.song) {
                            await songCache.saveSong(first.song, currentItem.url)
                            await loadSessionSongs(session)
                          } else {
                            setReloadError(
                              first?.message || 'Couldn’t reload this song from its source.',
                            )
                          }
                        } catch (err) {
                          setReloadError(
                            err instanceof Error
                              ? err.message
                              : 'Couldn’t reload this song from its source.',
                          )
                        } finally {
                          setReloadingSong(false)
                        }
                      }}
                    >
                      Reload from source
                    </Button>
                  ) : undefined
                }
              >
                {reloadError ??
                  (!online
                    ? 'It opens again when you’re back online.'
                    : currentItem.url.startsWith('https://')
                      ? 'You can try reloading it from its original link.'
                      : 'Uploaded or pasted sheets are stored only on the device where they were added.')}
              </StatusBanner>
            </div>
          ) : (
            <div className={isFullScreen ? 'min-h-0 flex-1 overflow-y-auto p-3' : ''}>
              <div className="animate-pulse py-8 text-center text-xs text-[var(--ui-text-muted)]">
                Loading song sheet...
              </div>
            </div>
          )}
        </div>
      )}

      {!currentItem && loadedSessionId === session.id && (
        <StatusBanner tone="info">No songs in this setlist yet.</StatusBanner>
      )}

      {editGuardDialog}
      <OverlayDialog
        isOpen={confirmingUpdate}
        onClose={() => setConfirmingUpdate(false)}
        title="Update your copy?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmingUpdate(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={savingPreview}
              onClick={() => void handleUpdateCopy()}
            >
              Update
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--ui-text)]">
          Your copy will be replaced with this version of the shared set. Changes you made to your
          copy will be lost.
        </p>
      </OverlayDialog>

      <OverlayDialog
        isOpen={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        title="Remove this song?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingRemove(null)}>
              Cancel
            </Button>
            <Button variant="danger-solid" onClick={() => void confirmRemoveSong()}>
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--ui-text)]">
          {pendingRemove ? `"${pendingRemove.title}" will be removed from this setlist.` : ''}
        </p>
      </OverlayDialog>

      <OverlayDialog
        isOpen={pendingSectionDelete !== null}
        onClose={() => setPendingSectionDelete(null)}
        title="Remove this section?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingSectionDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger-solid" onClick={() => void confirmDeleteSection()}>
              Remove
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-[var(--ui-text)]">
          <p>
            {pendingSectionDelete
              ? `"${pendingSectionDelete.label}" will be removed from this song.`
              : ''}
          </p>
          {pendingSectionDelete && pendingSectionDelete.repeatCount > 1 && (
            <p>
              This removes {pendingSectionDelete.repeatCount} occurrences that share this section.
            </p>
          )}
          <p>You can restore it to the original chord sheet at any time.</p>
        </div>
      </OverlayDialog>

      <SyncConflictDialog
        isOpen={conflictOpen && syncConflict}
        sessionId={session.id}
        clashes={syncState.conflicts.get(session.id)?.clashes ?? []}
        onClose={() => {
          setConflictOpen(false)
          void reloadFromStore()
        }}
      />

      {/* Presentation Modal */}
      {isPresentationModalOpen && session && !isFullScreen && (
        <PresentationModal
          session={session}
          songsData={songsData}
          isOpen={isPresentationModalOpen}
          onClose={() => setIsPresentationModalOpen(false)}
        />
      )}

      {/* Share Modal */}
      {isShareMenuOpen && session && !isFullScreen && (
        <ShareMenuModal
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
          onSessionUpdated={handleSessionUpdated}
        />
      )}

      {/* Arrange Songs Drawer */}
      <ArrangeDrawer
        isOpen={isArrangingSongs && !isFullScreen}
        title="Arrange Setlist"
        subtitle={`Reorder songs in "${session.name}"`}
        items={arrangeSongs.map((item, idx) => {
          const s = songForItem(item)
          return {
            id: item.entryId || `${item.url}-${idx}`,
            title: s?.title || item.title || item.url.replace(/^https?:\/\//, '').slice(0, 24),
            subtitle: s?.artist || item.artist,
            badge: `#${idx + 1}`,
          }
        })}
        onMove={(from, to) => {
          if (!pendingSongRemoval) {
            guard(() => void handleReorderSongs(from, to))
            return
          }
          const fromIndex = session.songs.findIndex(
            (item) => item.entryId === arrangeSongs[from]?.entryId,
          )
          const toIndex = session.songs.findIndex(
            (item) => item.entryId === arrangeSongs[to]?.entryId,
          )
          if (fromIndex < 0 || toIndex < 0) return
          guard(() => void handleReorderSongs(fromIndex, toIndex))
        }}
        onDelete={
          arrangeSongs.length > 1
            ? (idx) => {
                const item = arrangeSongs[idx]
                if (!item) return
                const s = songForItem(item)
                guard(() => {
                  setIsArrangingSongs(false)
                  setPendingRemove({
                    entryId: item.entryId || '',
                    title: s?.title || item.title || item.url.replace(/^https?:\/\//, ''),
                  })
                })
              }
            : undefined
        }
        onClose={() => setIsArrangingSongs(false)}
      />

      {/* Floating tips and shortcuts share the bottom-right corner. */}
      {!isFullScreen && (
        <div className="pointer-events-none fixed right-4 bottom-4 z-40 flex flex-col items-end gap-3 sm:right-6 sm:bottom-6">
          {/* Section Customization Helper Tip (First song & first instance only) */}
          {showSectionEditTip && activeIndex === 0 && Boolean(displayedSong) && (
            <aside
              role="complementary"
              aria-label="Tip: customise sections"
              className="ui-surface ui-surface--elevated pointer-events-auto flex max-w-xs flex-col gap-2.5 p-3.5 sm:max-w-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-ui-accent-strong flex items-center gap-1.5 text-xs font-semibold">
                  <Lightbulb size={14} />
                  <span>Customise sections</span>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
                Tap <strong className="text-neutral-800 dark:text-neutral-100">✎</strong> to rename
                a section, <strong className="text-neutral-800 dark:text-neutral-100">✕</strong> to
                remove a duplicate, and drag{' '}
                <strong className="text-neutral-800 dark:text-neutral-100">⋮⋮</strong> to reorder
                (with a mouse or trackpad).
              </p>
              <div className="flex justify-end pt-0.5">
                <Button size="sm" variant="secondary" onClick={handleDismissSectionEditTip}>
                  Close
                </Button>
              </div>
            </aside>
          )}

          <AnimatePresence>
            {showFloatingFullScreen && (
              <motion.div
                key="floating-full-screen"
                className="pointer-events-auto"
                {...floatingFullScreenMotion}
              >
                <IconButton
                  label="Go full screen"
                  title="Fill the window with this chord sheet"
                  variant="secondary"
                  className="ui-button--floating"
                  onClick={(event) => handleEnterFullScreen(event.currentTarget)}
                  data-floating-fullscreen-trigger
                >
                  <Maximize2 size={18} />
                </IconButton>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
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

      {/* Last, so it sits above the other bottom popovers. */}
      <HostChangeToast note={deletionPending ? null : hostNote} onDismiss={dismissHostNote} />
      <ChangeToast
        note={deletionPending ? null : previewError}
        onDismiss={() => setPreviewError(null)}
        icon={<AlertTriangle size={16} />}
      />
      <ChangeToast
        note={undoNote}
        onDismiss={dismissUndoToast}
        progressMs={UNDO_WINDOW_MS}
        progressKey={undoKey}
        pauseOnHover={false}
        dismissible={false}
      />
    </div>
  )
}
