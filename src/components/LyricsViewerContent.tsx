import { useState, useEffect, useRef } from 'react'
import { RotateCcw } from 'lucide-react'
import type { SharedLyricsSong } from '../types/song'
import { cleanLyricLine } from '../lib/exportLyrics'
import { Button, Surface } from './ui'
import ThemeToggle from './ThemeToggle'

export interface LyricsViewerContentProps {
  songs: SharedLyricsSong[]
  setName?: string
  selectedEntryId?: string | null
  onSelectSong?: (entryId: string) => void
  onRefresh?: () => void
  showRefresh?: boolean
  isRefreshing?: boolean
  isModal?: boolean
}

export default function LyricsViewerContent({
  songs,
  setName,
  selectedEntryId: controlledEntryId,
  onSelectSong,
  onRefresh,
  showRefresh = false,
  isRefreshing = false,
  isModal = false,
}: LyricsViewerContentProps) {
  const [internalEntryId, setInternalEntryId] = useState<string | null>(null)

  const activeEntryId =
    controlledEntryId !== undefined
      ? controlledEntryId
      : internalEntryId && songs.some((s) => s.entryId === internalEntryId)
      ? internalEntryId
      : songs[0]?.entryId ?? null

  const activeTabRef = useRef<HTMLButtonElement | null>(null)
  const tabListRef = useRef<HTMLDivElement | null>(null)
  const contentContainerRef = useRef<HTMLDivElement | null>(null)

  // Keep selected tab in view within horizontal tab list
  useEffect(() => {
    if (activeTabRef.current && tabListRef.current) {
      const tab = activeTabRef.current
      const container = tabListRef.current
      const tabLeft = tab.offsetLeft
      const tabRight = tabLeft + tab.offsetWidth
      const containerLeft = container.scrollLeft
      const containerRight = containerLeft + container.clientWidth
      if (tabLeft < containerLeft) {
        container.scrollTo({ left: Math.max(0, tabLeft - 8), behavior: 'smooth' })
      } else if (tabRight > containerRight) {
        container.scrollTo({ left: tabRight - container.clientWidth + 8, behavior: 'smooth' })
      }
    }
  }, [activeEntryId])

  const handleSelect = (entryId: string) => {
    if (entryId !== activeEntryId) {
      if (onSelectSong) {
        onSelectSong(entryId)
      } else {
        setInternalEntryId(entryId)
      }
      if (contentContainerRef.current) {
        contentContainerRef.current.scrollTop = 0
        const scrollParent = contentContainerRef.current.closest('.ui-dialog__content')
        if (scrollParent) {
          scrollParent.scrollTop = 0
        }
      }
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
  }

  const handleKeyDownTab = (
    e: React.KeyboardEvent,
    index: number,
    songsList: SharedLyricsSong[]
  ) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      const nextIdx = (index + 1) % songsList.length
      const nextSong = songsList[nextIdx]
      if (nextSong) handleSelect(nextSong.entryId)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const prevIdx = (index - 1 + songsList.length) % songsList.length
      const prevSong = songsList[prevIdx]
      if (prevSong) handleSelect(prevSong.entryId)
    }
  }

  const activeSong = songs.find((s) => s.entryId === activeEntryId) || songs[0]

  return (
    <div className={isModal ? 'w-full min-w-0' : 'mx-auto max-w-3xl w-full min-w-0 space-y-6'}>
      {/* Set Header */}
      {setName && (
        <div className="flex items-center justify-between border-b border-[var(--ui-border)] pb-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-[-0.025em] text-[var(--ui-text)] break-words">
              {setName}
            </h1>
            <p className="mt-0.5 text-xs text-[var(--ui-text-muted)]">
              {songs.length} song{songs.length === 1 ? '' : 's'} in setlist
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {showRefresh && onRefresh && (
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcw size={14} className={isRefreshing ? 'animate-spin' : ''} />}
                onClick={onRefresh}
                title="Refresh lyrics"
              >
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            )}
            {!isModal && <ThemeToggle variant="ghost" size={15} />}
          </div>
        </div>
      )}

      {/* Sticky, Horizontally Scrollable Song Tabs */}
      {songs.length > 0 && (
        <div
          ref={tabListRef}
          className={`no-scrollbar z-20 flex w-full max-w-full min-w-0 space-x-1.5 overflow-x-auto border-b border-[var(--ui-border)] py-2.5 ${
            isModal
              ? 'sticky top-0 bg-[var(--ui-surface-raised)] px-4 sm:px-6'
              : 'sticky top-0 bg-[var(--ui-canvas)]/95 backdrop-blur-md'
          }`}
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
                onClick={() => handleSelect(song.entryId)}
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
      <div
        ref={contentContainerRef}
        className={isModal ? 'mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-6' : 'space-y-6'}
      >
        {!activeSong ? (
          <Surface elevated className="p-8 text-center text-sm text-[var(--ui-text-muted)]">
            No songs available in this set.
          </Surface>
        ) : activeSong.sections.length === 0 ? (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight text-[var(--ui-text)] break-words whitespace-normal">
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
            <h2 className="text-2xl font-bold tracking-tight text-[var(--ui-text)] break-words whitespace-normal">
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
                      {section.lines.map((line, lIdx) => {
                        const displayLine = cleanLyricLine(line)
                        return (
                          <p
                            key={lIdx}
                            className="whitespace-pre-wrap break-words text-base leading-relaxed text-[var(--ui-text)]"
                          >
                            {displayLine || '\u00A0'}
                          </p>
                        )
                      })}
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
