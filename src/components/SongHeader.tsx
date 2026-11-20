import type { Song } from '../types/song'
import { sourceLabel } from '../lib/searchResults'
import { ExternalLink } from 'lucide-react'

interface SongHeaderProps {
  song: Song
}

export default function SongHeader({ song }: SongHeaderProps) {
  return (
    <div className="flex flex-col justify-between gap-2 pb-0.5 sm:flex-row sm:items-center">
      <div className="min-w-0">
        <div>
          <h2 className="break-words text-xl font-bold tracking-[-0.025em] text-ui-text sm:text-2xl">
            {song.title}
          </h2>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--ui-text-muted)]">
          <span>{song.artist}</span>
          {song.originalKey && (
            <>
              <span aria-hidden="true">•</span>
              <span>
                Original key{' '}
                <strong className="font-semibold text-[var(--ui-text)]">{song.originalKey}</strong>
              </span>
            </>
          )}
          <span aria-hidden="true">•</span>
          <a
            href={song.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium transition-colors hover:text-ui-accent-strong"
          >
            {sourceLabel(song.sourceSite)} <ExternalLink size={11} />
          </a>
          {song.capo && (
            <>
              <span aria-hidden="true">•</span>
              <span className="text-ui-text">Capo {song.capo}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
