import type { Song } from '../types/song'
import { sourceLabel } from '../lib/searchResults'
import { ExternalLink } from 'lucide-react'

interface SongHeaderProps {
  song: Song
  currentKey?: string | null
  offsetDisplay?: string
  onResetKey?: () => void
  onSelectKey?: (newKey: string) => void
  variant?: 'default' | 'fullscreen'
}

export default function SongHeader({
  song,
  variant = 'default',
}: SongHeaderProps) {
  const isFullScreen = variant === 'fullscreen'

  return (
    <div
      className={
        isFullScreen
          ? 'min-w-[14rem] flex-1'
          : 'flex flex-col justify-between gap-2 pb-0.5 sm:flex-row sm:items-center'
      }
    >
      <div className="min-w-0">
        <div>
          <h2
            title={isFullScreen ? song.title : undefined}
            className={
              isFullScreen
                ? 'truncate text-lg font-bold tracking-[-0.025em] text-neutral-900 dark:text-[#ededeb]'
                : 'break-words text-xl font-bold tracking-[-0.025em] text-neutral-900 dark:text-[#ededeb] sm:text-2xl'
            }
          >
            {song.title}
          </h2>
        </div>
        <div
          className={
            isFullScreen
              ? 'mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ui-text-muted)]'
              : 'mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--ui-text-muted)]'
          }
        >
          <span className={isFullScreen ? 'max-w-[44ch] truncate' : undefined}>{song.artist}</span>
          {!isFullScreen && song.originalKey && (
            <>
              <span aria-hidden="true">•</span>
              <span>
                Original key{' '}
                <strong className="font-semibold text-[var(--ui-text)]">{song.originalKey}</strong>
              </span>
            </>
          )}
          {!isFullScreen && (
            <>
              <span aria-hidden="true">•</span>
              <a
                href={song.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium transition-colors hover:text-[#3368A0] dark:hover:text-amber-400"
              >
                {sourceLabel(song.sourceSite)} <ExternalLink size={11} />
              </a>
            </>
          )}
          {song.capo && (
            <>
              <span aria-hidden="true">•</span>
              <span className="text-neutral-700 dark:text-[#d4d4d4]">Capo {song.capo}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
