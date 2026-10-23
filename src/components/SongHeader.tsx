import type { Song } from '../types/song'
import { ExternalLink } from 'lucide-react'
import TransposeSelector from './TransposeSelector'

interface SongHeaderProps {
  song: Song
  currentKey: string | null
  offsetDisplay?: string
  onResetKey?: () => void
  onSelectKey?: (newKey: string) => void
  variant?: 'default' | 'fullscreen'
}

export default function SongHeader({
  song,
  currentKey,
  offsetDisplay,
  onResetKey,
  onSelectKey,
  variant = 'default',
}: SongHeaderProps) {
  const isTransposed = song.originalKey && currentKey && currentKey !== song.originalKey
  const isFullScreen = variant === 'fullscreen'

  return (
    <div
      className={
        isFullScreen
          ? 'min-w-[14rem] flex-1'
          : 'flex flex-col justify-between gap-3 pb-1 sm:flex-row sm:items-center'
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
              : 'mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--ui-text-muted)]'
          }
        >
          <span className={isFullScreen ? 'max-w-[44ch] truncate' : undefined}>{song.artist}</span>
          {!isFullScreen && (
            <>
              <span aria-hidden="true">•</span>
              <a
                href={song.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium transition-colors hover:text-[#3368A0] dark:hover:text-amber-400"
              >
                {song.sourceSite} <ExternalLink size={11} />
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

      {!isFullScreen && (
        <div className="flex flex-wrap items-center gap-2">
          {/* Transpose Key Selector */}
          {onSelectKey ? (
            <TransposeSelector
              originalKey={song.originalKey}
              currentKey={currentKey}
              onSelectKey={onSelectKey}
              onReset={onResetKey || (() => {})}
            />
          ) : (
            isTransposed && (
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] px-2.5 py-1 text-xs text-[#1c436b] dark:text-amber-300">
                <span>Key: {currentKey}</span>
                {offsetDisplay && <span className="text-neutral-500 dark:text-[#999999]">({offsetDisplay})</span>}
                {onResetKey && (
                  <button
                    onClick={onResetKey}
                    className="ml-1 text-xs text-neutral-600 hover:text-black dark:text-[#999999] dark:hover:text-[#e5e5e5] underline cursor-pointer"
                  >
                    Reset
                  </button>
                )}
              </div>
            )
          )}

          {/* Original Key Badge */}
          <div className="inline-flex items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] px-2.5 py-1 text-xs">
            <span className="mr-1.5 text-[var(--ui-text-muted)]">Original key</span>
            <span className="font-bold text-[#255283] dark:text-amber-400">{song.originalKey || 'Unknown'}</span>
          </div>
        </div>
      )}
    </div>
  )
}
