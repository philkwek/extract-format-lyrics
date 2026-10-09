import type { Song } from '../types/song'

interface SongHeaderProps {
  song: Song
  currentKey: string | null
  offsetDisplay?: string
  onResetKey?: () => void
}

export default function SongHeader({
  song,
  currentKey,
  offsetDisplay,
  onResetKey,
}: SongHeaderProps) {
  const isTransposed = song.originalKey && currentKey && currentKey !== song.originalKey

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-neutral-800">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-neutral-100">{song.title}</h2>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-neutral-400">
          <span>{song.artist}</span>
          <span>•</span>
          <a
            href={song.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-amber-400 transition-colors underline decoration-neutral-700 underline-offset-2"
          >
            {song.sourceSite} ↗
          </a>
          {song.capo && (
            <>
              <span>•</span>
              <span className="text-neutral-300">Capo {song.capo}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {/* Original Key Badge */}
        <div className="inline-flex items-center px-2.5 py-1 rounded bg-neutral-800 border border-neutral-700/60 text-xs">
          <span className="text-neutral-400 mr-1.5">Original Key:</span>
          <span className="font-bold text-amber-400">{song.originalKey || 'Unknown'}</span>
        </div>

        {/* Current Transposed Key Indicator */}
        {isTransposed && (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-950/40 border border-amber-800/60 text-xs text-amber-300">
            <span>Key: {currentKey}</span>
            {offsetDisplay && <span className="text-neutral-400">({offsetDisplay})</span>}
            {onResetKey && (
              <button
                onClick={onResetKey}
                className="ml-1 text-xs text-neutral-400 hover:text-white underline cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
