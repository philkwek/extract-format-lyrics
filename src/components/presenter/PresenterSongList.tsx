import { classes } from '../../lib/classes'
import type { SharedLyricsSong } from '../../types/song'
import { OnScreenTag } from './PresenterTags'

interface PresenterSongListProps {
  songs: SharedLyricsSong[]
  projectedId: string | null
  hostEntryId: string | null
  isEdited?: (entryId: string) => boolean
  onProject: (entryId: string) => void
}

export default function PresenterSongList({
  songs,
  projectedId,
  hostEntryId,
  isEdited,
  onProject,
}: PresenterSongListProps) {
  return (
    <aside className="bg-ui-surface border-ui-border flex min-w-0 flex-col rounded-2xl border p-3">
      <h2 className="text-ui-text-muted px-1 text-[10px] font-semibold tracking-wider uppercase">
        Songs in this set
      </h2>
      <div className="mt-2.5 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        {songs.length === 0 ? (
          <p className="text-ui-text-muted px-1 text-xs">No songs in this set yet.</p>
        ) : (
          songs.map((song) => {
            const projected = song.entryId === projectedId
            const hostHere = song.entryId === hostEntryId
            const edited = Boolean(isEdited?.(song.entryId))
            return (
              <button
                key={song.entryId}
                type="button"
                aria-pressed={projected}
                onClick={() => onProject(song.entryId)}
                className={classes(
                  'flex w-full flex-col gap-1 rounded-xl border px-2.5 py-2 text-left transition',
                  projected
                    ? 'border-ui-accent bg-ui-surface-raised'
                    : 'hover:border-ui-border border-transparent',
                )}
              >
                <span className="w-full min-w-0">
                  <span className="block truncate text-sm font-semibold">{song.title}</span>
                  {song.artist && (
                    <span className="text-ui-text-muted mt-0.5 block truncate text-[11px]">
                      {song.artist}
                    </span>
                  )}
                </span>
                {(projected || hostHere || edited) && (
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    {projected && <OnScreenTag />}
                    {hostHere && (
                      <span className="border-ui-text-muted text-ui-text rounded-full border px-2 py-0.5 text-[10px] font-semibold">
                        Host is here
                      </span>
                    )}
                    {edited && <span className="text-ui-text-muted text-[10px]">Edited</span>}
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}
