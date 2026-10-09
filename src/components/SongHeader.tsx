import type { Song } from '../types/song'
import TransposeSelector from './TransposeSelector'

interface SongHeaderProps {
  song: Song
  currentKey: string | null
  offsetDisplay?: string
  onResetKey?: () => void
  onSelectKey?: (newKey: string) => void
}

export default function SongHeader({
  song,
  currentKey,
  offsetDisplay,
  onResetKey,
  onSelectKey,
}: SongHeaderProps) {
  const isTransposed = song.originalKey && currentKey && currentKey !== song.originalKey

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-neutral-900 dark:text-[#e5e5e5]">{song.title}</h2>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-neutral-600 dark:text-[#999999]">
          <span>{song.artist}</span>
          <span>•</span>
          <a
            href={song.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[#3368A0] dark:hover:text-amber-400 transition-colors underline decoration-neutral-400 dark:decoration-neutral-700 underline-offset-2"
          >
            {song.sourceSite} ↗
          </a>
          {song.capo && (
            <>
              <span>•</span>
              <span className="text-neutral-700 dark:text-[#d4d4d4]">Capo {song.capo}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
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
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#C8DFDB]/40 dark:bg-amber-950/30 border border-[#66A3BF]/40 dark:border-amber-800/40 text-xs text-[#1c436b] dark:text-amber-300">
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
        <div className="inline-flex items-center px-2.5 py-1 rounded bg-white dark:bg-[#1a1a1a] border border-[#C8DFDB] dark:border-[#282828] text-xs">
          <span className="text-neutral-600 dark:text-[#999999] mr-1.5">Original Key:</span>
          <span className="font-bold text-[#255283] dark:text-amber-400">{song.originalKey || 'Unknown'}</span>
        </div>
      </div>
    </div>
  )
}
