import type { Song } from '../types/song'

interface FullScreenTitleBlockProps {
  song: Song
  /** Shown when the layout could not fit; always visible. */
  warning?: string | null
  /** The fit caption, e.g. "Fits the screen · 3 columns · text size 14". */
  caption?: string | null
  /** Keep one line free for the caption so its height never changes the layout. */
  reserveCaption?: boolean
}

/** The song's title, artist and details: the first block at the top of the song. */
export default function FullScreenTitleBlock({
  song,
  warning,
  caption,
  reserveCaption = false,
}: FullScreenTitleBlockProps) {
  const details = [song.artist, song.capo ? `Capo ${song.capo}` : null].filter(Boolean)

  return (
    <div className="min-w-0 select-text">
      <h2 className="line-clamp-2 text-lg font-bold leading-7 tracking-[-0.025em] text-ui-text">
        {song.title}
      </h2>
      {details.length > 0 && (
        <p className="truncate text-[11px] text-[var(--ui-text-muted)]">{details.join(' · ')}</p>
      )}
      {warning ? (
        <p role="status" className="mt-0.5 text-[10px] leading-[14px] text-[var(--ui-text-muted)]">
          {warning}
        </p>
      ) : (
        reserveCaption && (
          <p
            role="status"
            className="mt-0.5 min-h-[14px] truncate text-[10px] leading-[14px] text-[var(--ui-text-muted)]"
          >
            {caption ?? ' '}
          </p>
        )
      )}
    </div>
  )
}
