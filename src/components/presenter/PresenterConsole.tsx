import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { trackEvent } from '../../lib/analytics'
import {
  createConsoleChannel,
  type ConsoleChannel,
  type OutputState,
} from '../../lib/presenterChannel'
import { stepPresenter } from '../../lib/presenterNavigation'
import { applyPresenterEdits, usePresenterEdits } from '../../lib/presenterEdits'
import { usePresenterDisplay } from '../../lib/presenterSettings'
import type { PresenterFeedState } from '../../lib/usePresenterFeed'
import { Button, StatusBanner } from '../ui'
import PresenterDisplayPanel from './PresenterDisplayPanel'
import PresenterSections from './PresenterSections'
import PresenterSongEditor from './PresenterSongEditor'
import PresenterSongList from './PresenterSongList'

interface PresenterConsoleProps {
  id: string
  feed: PresenterFeedState
  onSwitchToAuto: () => void
}

export default function PresenterConsole({ id, feed, onSwitchToAuto }: PresenterConsoleProps) {
  const [display, patchDisplay] = usePresenterDisplay()
  const [projectedId, setProjectedId] = useState<string | null>(null)
  const [sectionIndex, setSectionIndex] = useState(0)
  const [blackout, setBlackout] = useState(false)
  const [outputOpen, setOutputOpen] = useState(false)
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const channelRef = useRef<ConsoleChannel | null>(null)

  const { edits, saveEdit, resetEdit, isEdited } = usePresenterEdits(id)
  const effectiveLyrics = useMemo(
    () => (feed.lyrics ? applyPresenterEdits(feed.lyrics, edits) : null),
    [feed.lyrics, edits],
  )
  const songs = useMemo(() => effectiveLyrics?.songs ?? [], [effectiveLyrics])
  const selectedSong = projectedId
    ? songs.find((song) => song.entryId === projectedId)
    : undefined
  const hostSong = songs.find((song) => song.entryId === feed.currentEntryId)
  const fallbackSong = projectedId === null ? (hostSong ?? songs[0]) : songs[0]
  const projectedSong = selectedSong ?? fallbackSong ?? null
  const missingSelection = projectedId !== null && !selectedSong
  const sectionCount = projectedSong?.sections.length ?? 0
  const baseSectionIndex = missingSelection ? 0 : sectionIndex
  const effectiveSectionIndex =
    sectionCount === 0 ? 0 : Math.min(Math.max(baseSectionIndex, 0), sectionCount - 1)

  const editingHostSong = editingEntryId
    ? feed.lyrics?.songs.find((song) => song.entryId === editingEntryId)
    : undefined
  const editingCurrentSong = editingEntryId
    ? songs.find((song) => song.entryId === editingEntryId)
    : undefined
  const isEditing = Boolean(editingHostSong && editingCurrentSong)

  const outputState = useMemo<OutputState>(
    () => ({
      setName: effectiveLyrics?.name ?? '',
      song: projectedSong,
      view: display.lyricsView,
      sectionIndex: effectiveSectionIndex,
      display,
      blackout,
    }),
    [effectiveLyrics?.name, projectedSong, display, effectiveSectionIndex, blackout],
  )
  const stateRef = useRef(outputState)

  useEffect(() => {
    stateRef.current = outputState
    channelRef.current?.publish(outputState)
  }, [outputState])

  useEffect(() => {
    const channel = createConsoleChannel(id, () => stateRef.current)
    channelRef.current = channel
    channel.publish(stateRef.current)
    const off = channel.onOutputChange(setOutputOpen)
    return () => {
      off()
      channel.close()
      channelRef.current = null
    }
  }, [id])

  const move = useCallback(
    (direction: 1 | -1) => {
      if (!projectedSong) return
      const next = stepPresenter(
        songs,
        { entryId: projectedSong.entryId, sectionIndex: effectiveSectionIndex },
        display.lyricsView,
        direction,
      )
      setProjectedId(next.entryId)
      setSectionIndex(next.sectionIndex)
    },
    [songs, projectedSong, effectiveSectionIndex, display.lyricsView],
  )

  useEffect(() => {
    if (isEditing) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      const target = event.target as HTMLElement | null
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      ) {
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setBlackout((value) => !value)
        return
      }
      let direction: 1 | -1 | null = null
      if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'PageDown') {
        direction = 1
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        direction = -1
      }
      if (direction === null) return
      event.preventDefault()
      move(direction)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [move, isEditing])

  const projectSong = useCallback((entryId: string) => {
    setProjectedId(entryId)
    setSectionIndex(0)
  }, [])

  const projectSection = useCallback((entryId: string, index: number) => {
    setProjectedId(entryId)
    setSectionIndex(index)
  }, [])

  const openOutput = useCallback(() => {
    window.open(
      `/present/${id}/output`,
      `presenter-output-${id}`,
      'popup,width=1280,height=720',
    )
    trackEvent('presenter_output_opened', {})
  }, [id])

  const banner =
    feed.status === 'stopped' || feed.status === 'missing'
      ? 'The host stopped sharing these lyrics.'
      : feed.status === 'lost'
        ? 'Lost connection. Showing the last lyrics received.'
        : null

  return (
    <div className="bg-ui-canvas text-ui-text flex h-screen w-screen flex-col">
      <header className="border-ui-border flex h-[72px] shrink-0 items-center justify-between border-b px-6">
        <p className="text-base font-bold">
          {effectiveLyrics?.name ? `Presenter · ${effectiveLyrics.name}` : 'Presenter'}
        </p>
        <Button variant="secondary" onClick={onSwitchToAuto}>
          Switch to auto follow host
        </Button>
      </header>

      {banner && (
        <div className="px-6 pt-4">
          <StatusBanner tone="warning">{banner}</StatusBanner>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[2fr_5fr_3fr] gap-6 p-6">
        <PresenterSongList
          songs={songs}
          projectedId={projectedSong?.entryId ?? null}
          hostEntryId={feed.currentEntryId}
          isEdited={isEdited}
          onProject={projectSong}
        />
        {editingHostSong && editingCurrentSong ? (
          <PresenterSongEditor
            key={editingHostSong.entryId}
            hostSong={editingHostSong}
            currentSong={editingCurrentSong}
            hasSavedEdit={isEdited(editingHostSong.entryId)}
            onCancel={() => setEditingEntryId(null)}
            onSave={(sections) => {
              saveEdit(editingHostSong.entryId, sections, editingHostSong.sections)
              setEditingEntryId(null)
            }}
            onReset={() => {
              resetEdit(editingHostSong.entryId)
              setEditingEntryId(null)
            }}
          />
        ) : (
          <PresenterSections
            song={projectedSong}
            view={display.lyricsView}
            sectionIndex={effectiveSectionIndex}
            onProjectSong={projectSong}
            onProjectSection={projectSection}
            onEdit={() => projectedSong && setEditingEntryId(projectedSong.entryId)}
          />
        )}
        <PresenterDisplayPanel
          song={projectedSong}
          sectionIndex={effectiveSectionIndex}
          display={display}
          onPatchDisplay={patchDisplay}
          blackout={blackout}
          onToggleBlackout={() => setBlackout((value) => !value)}
          outputOpen={outputOpen}
          onOpenOutput={openOutput}
        />
      </div>
    </div>
  )
}
