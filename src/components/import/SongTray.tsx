import { useEffect, useRef, useState } from 'react'
import { Reorder, useDragControls, useReducedMotion } from 'motion/react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, GripVertical, X } from 'lucide-react'
import type { SearchCandidate } from '../../lib/api'
import { reducedMotionTransition } from '../../lib/uiMotion'
import { TRAY_MAX_SONGS } from '../../lib/useSongTray'
import { Button, IconButton, StatusBanner } from '../ui'

interface SongTrayProps {
  items: SearchCandidate[]
  failedUrls: Set<string>
  isCreating: boolean
  error: string | null
  onMove: (from: number, to: number) => void
  onReorder: (items: SearchCandidate[]) => void
  onRemove: (url: string) => void
  onCreate: () => void
}

// Show how many songs are left only this close to the limit; most sets never get here.
const LIMIT_HINT_WITHIN = 5

// Below Tailwind's lg breakpoint the tray is a bar at the bottom; from lg up it is a side panel.
const NARROW_QUERY = '(max-width: 1023px)'

const canMatchMedia = () => typeof window.matchMedia === 'function'

function useIsNarrow() {
  const [isNarrow, setIsNarrow] = useState(
    () => canMatchMedia() && window.matchMedia(NARROW_QUERY).matches,
  )
  useEffect(() => {
    if (!canMatchMedia()) return
    const query = window.matchMedia(NARROW_QUERY)
    const update = () => setIsNarrow(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return isNarrow
}

const rowSpring = { type: 'spring' as const, stiffness: 520, damping: 38, mass: 0.65 }

interface TrayRowProps {
  item: SearchCandidate
  index: number
  count: number
  failed: boolean
  moved: boolean
  onMove: (from: number, to: number) => void
  onRemove: (url: string) => void
}

function TrayRow({ item, index, count, failed, moved, onMove, onRemove }: TrayRowProps) {
  const controls = useDragControls()
  const reduceMotion = useReducedMotion()
  return (
    <Reorder.Item
      as="li"
      value={item}
      dragListener={false}
      dragControls={controls}
      layout="position"
      transition={reduceMotion ? reducedMotionTransition : { layout: rowSpring }}
      animate={moved && !reduceMotion ? { scale: [1, 1.03, 1] } : { scale: 1 }}
      whileDrag={reduceMotion ? undefined : { scale: 1.03, boxShadow: 'var(--ui-shadow-lg)' }}
      className={`relative flex items-center gap-1 rounded-xl border bg-ui-surface p-2 shadow-[var(--ui-shadow-sm)] ${
        failed ? 'border-amber-500' : moved ? 'border-ui-accent' : 'border-ui-border'
      }`}
      style={{ zIndex: moved ? 1 : undefined }}
    >
      <span
        aria-hidden="true"
        onPointerDown={(event) => controls.start(event)}
        className="flex h-7 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-ui-text-muted active:cursor-grabbing"
      >
        <GripVertical size={14} />
      </span>
      <span className="w-4 shrink-0 text-center text-xs font-bold text-ui-text-muted">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1 px-1">
        <p className="truncate text-sm font-semibold text-ui-text">{item.title}</p>
        <p className="truncate text-xs text-ui-text-muted">
          {failed ? 'Could not load this song' : item.artist}
        </p>
      </div>
      <IconButton
        label={`Move ${item.title} up`}
        variant="ghost"
        className="song-tray-icon"
        disabled={index === 0}
        onClick={() => onMove(index, index - 1)}
      >
        <ArrowUp size={14} />
      </IconButton>
      <IconButton
        label={`Move ${item.title} down`}
        variant="ghost"
        className="song-tray-icon"
        disabled={index === count - 1}
        onClick={() => onMove(index, index + 1)}
      >
        <ArrowDown size={14} />
      </IconButton>
      <IconButton
        label={`Remove ${item.title}`}
        variant="danger"
        className="song-tray-icon"
        onClick={() => onRemove(item.url)}
      >
        <X size={14} />
      </IconButton>
    </Reorder.Item>
  )
}

export default function SongTray({
  items,
  failedUrls,
  isCreating,
  error,
  onMove,
  onReorder,
  onRemove,
  onCreate,
}: SongTrayProps) {
  const isNarrow = useIsNarrow()
  const [expanded, setExpanded] = useState(false)
  const [movedUrl, setMovedUrl] = useState<string | null>(null)
  const barRef = useRef<HTMLElement>(null)
  const hasSongs = items.length > 0

  // Marks the song that a button just moved, so the eye can follow it as the rows swap.
  useEffect(() => {
    if (!movedUrl) return
    const timeout = window.setTimeout(() => setMovedUrl(null), 600)
    return () => window.clearTimeout(timeout)
  }, [movedUrl])

  // While the bar is pinned, tell toasts how tall it is so they sit above it, not over it.
  useEffect(() => {
    const bar = barRef.current
    if (!isNarrow || !hasSongs || !bar || typeof ResizeObserver === 'undefined') return
    const root = document.documentElement
    // The bar sits 12px up and the toast 16px up, so +4px leaves an 8px gap above the bar.
    const update = () => root.style.setProperty('--song-tray-lift', `${bar.offsetHeight + 4}px`)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(bar)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--song-tray-lift')
    }
  }, [isNarrow, hasSongs])

  if (items.length === 0) return null

  const handleMove = (from: number, to: number) => {
    setMovedUrl(items[from]?.url ?? null)
    onMove(from, to)
  }

  const pinned = isNarrow
  const showList = !isNarrow || expanded
  const countLabel = `${items.length} song${items.length === 1 ? '' : 's'} added`
  const spaceLeft = TRAY_MAX_SONGS - items.length
  const isFull = spaceLeft <= 0
  const fullNote = `Sets made here hold up to ${TRAY_MAX_SONGS} songs. Remove one to add another.`
  const limitNote = isFull
    ? fullNote
    : spaceLeft <= LIMIT_HINT_WITHIN
      ? `You can add ${spaceLeft} more.`
      : null

  return (
    <>
      <section
        ref={barRef}
        aria-label="Songs for your new set"
        className={`ui-surface space-y-3 p-3 sm:p-4 ${
          pinned
            ? 'fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-30 shadow-lg'
            : 'song-tray-enter lg:sticky lg:top-20'
        }`}
      >
        {/* Always rendered so screen readers hear it change; only the full state is announced. It comes
            first so its (invisible) spacing never sits under the last visible row. */}
        <p className="sr-only" role="status">
          {isFull ? fullNote : ''}
        </p>
        <div className="flex items-center justify-between gap-3">
          {isNarrow ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((open) => !open)}
              className="flex items-center gap-1.5 text-sm font-semibold text-ui-text"
            >
              {countLabel}
              {expanded ? (
                <ChevronDown size={16} aria-hidden="true" />
              ) : (
                <ChevronUp size={16} aria-hidden="true" />
              )}
            </button>
          ) : (
            <h3 className="text-sm font-semibold text-ui-text">{countLabel}</h3>
          )}
          {isNarrow && (
            <Button variant="primary" size="sm" loading={isCreating} onClick={onCreate}>
              Create set
            </Button>
          )}
        </div>

        {error && (
          <StatusBanner tone="error">
            {failedUrls.size > 0
              ? 'Some songs could not be loaded. Remove them and try again.'
              : error}
          </StatusBanner>
        )}

        {limitNote && (
          <p className="text-xs text-ui-text-muted" aria-hidden={isFull || undefined}>
            {limitNote}
          </p>
        )}

        {showList && (
          <Reorder.Group
            axis="y"
            values={items}
            onReorder={onReorder}
            layoutScroll
            // Padding cancelled by negative margins gives a lifted row room to grow without being clipped.
            // The bottom margin keeps the usual 12px gap above the Create set button (8px padding + 4px).
            className={`-mx-3 -mt-2 flex flex-col gap-2 overflow-y-auto overscroll-contain px-3 py-2 ${
              isNarrow ? '-mb-2 max-h-[50vh]' : 'mb-1 max-h-[calc(100vh-18rem)]'
            }`}
          >
            {items.map((item, index) => (
              <TrayRow
                key={item.url}
                item={item}
                index={index}
                count={items.length}
                failed={failedUrls.has(item.url)}
                moved={movedUrl === item.url}
                onMove={handleMove}
                onRemove={onRemove}
              />
            ))}
          </Reorder.Group>
        )}

        {!isNarrow && (
          <Button variant="primary" className="w-full" loading={isCreating} onClick={onCreate}>
            Create set
          </Button>
        )}
      </section>
    </>
  )
}
