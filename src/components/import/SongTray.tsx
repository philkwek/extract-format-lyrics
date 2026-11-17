import { useEffect, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronUp, X } from 'lucide-react'
import type { SearchCandidate } from '../../lib/api'
import { TRAY_MAX_SONGS } from '../../lib/useSongTray'
import { Button, IconButton, StatusBanner } from '../ui'

interface SongTrayProps {
  items: SearchCandidate[]
  failedUrls: Set<string>
  isCreating: boolean
  error: string | null
  onMove: (from: number, to: number) => void
  onRemove: (url: string) => void
  onCreate: () => void
}

const PHONE_QUERY = '(max-width: 639px)'

const canMatchMedia = () => typeof window.matchMedia === 'function'

function useIsPhone() {
  const [isPhone, setIsPhone] = useState(
    () => canMatchMedia() && window.matchMedia(PHONE_QUERY).matches,
  )
  useEffect(() => {
    if (!canMatchMedia()) return
    const query = window.matchMedia(PHONE_QUERY)
    const update = () => setIsPhone(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return isPhone
}

export default function SongTray({
  items,
  failedUrls,
  isCreating,
  error,
  onMove,
  onRemove,
  onCreate,
}: SongTrayProps) {
  const isPhone = useIsPhone()
  const [expanded, setExpanded] = useState(false)
  if (items.length === 0) return null

  const pinned = isPhone
  const showList = !isPhone || expanded
  const countLabel = `${items.length} of ${TRAY_MAX_SONGS} songs`

  return (
    <>
      <section
        aria-label="Songs for your new set"
        className={`ui-surface space-y-3 p-3 sm:p-4 ${
          pinned
            ? 'fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-30 shadow-lg'
            : ''
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          {isPhone ? (
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
            <h3 className="text-sm font-semibold text-ui-text">Your set · {countLabel}</h3>
          )}
          <Button variant="primary" size="sm" loading={isCreating} onClick={onCreate}>
            Create set
          </Button>
        </div>

        {error && (
          <StatusBanner tone="error">
            {failedUrls.size > 0
              ? 'Some songs could not be loaded. Remove them and try again.'
              : error}
          </StatusBanner>
        )}

        {items.length >= TRAY_MAX_SONGS && (
          <p className="text-xs text-ui-text-muted" role="status">
            A set can hold up to {TRAY_MAX_SONGS} songs here.
          </p>
        )}

        {showList && (
          <ol
            className={
              isPhone
                ? 'max-h-[50vh] space-y-2 overflow-y-auto overscroll-contain'
                : 'flex flex-wrap gap-2'
            }
          >
            {items.map((item, index) => {
              const failed = failedUrls.has(item.url)
              return (
                <li
                  key={item.url}
                  className={`flex items-center gap-2 rounded-xl border bg-ui-surface-muted p-2 ${
                    failed ? 'border-amber-500' : 'border-ui-border'
                  } ${isPhone ? '' : 'max-w-xs'}`}
                >
                  <span className="w-5 shrink-0 text-center text-xs font-bold text-ui-text-muted">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ui-text">{item.title}</p>
                    <p className="truncate text-xs text-ui-text-muted">
                      {failed ? 'Could not load this song' : item.artist}
                    </p>
                  </div>
                  <IconButton
                    label={`Move ${item.title} ${isPhone ? 'up' : 'left'}`}
                    variant="ghost"
                    disabled={index === 0}
                    onClick={() => onMove(index, index - 1)}
                  >
                    {isPhone ? <ArrowUp size={16} /> : <ArrowLeft size={16} />}
                  </IconButton>
                  <IconButton
                    label={`Move ${item.title} ${isPhone ? 'down' : 'right'}`}
                    variant="ghost"
                    disabled={index === items.length - 1}
                    onClick={() => onMove(index, index + 1)}
                  >
                    {isPhone ? <ArrowDown size={16} /> : <ArrowRight size={16} />}
                  </IconButton>
                  <IconButton
                    label={`Remove ${item.title}`}
                    variant="ghost"
                    onClick={() => onRemove(item.url)}
                  >
                    <X size={16} />
                  </IconButton>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </>
  )
}
