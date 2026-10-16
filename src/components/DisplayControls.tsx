import { AlertTriangle, AudioLines, Columns3, Pencil, RotateCcw, Type, WandSparkles } from 'lucide-react'
import type { SongDisplayPrefs } from '../lib/songPrefs'
import { Button, StatusBanner } from './ui'

interface DisplayControlsProps {
  prefs: SongDisplayPrefs
  onChangePrefs: (newPrefs: SongDisplayPrefs) => void
  canSimplify?: boolean
  simplifiedSource?: 'official' | 'algorithmic'
  onRestoreOriginal?: () => void
  isEditingChords?: boolean
  onToggleEditChords?: () => void
  hasLyricOverflow?: boolean
  isPadPlaying?: boolean
  isPadLoading?: boolean
  currentKey?: string | null
  onTogglePad?: () => void
}

export default function DisplayControls({
  prefs,
  onChangePrefs,
  canSimplify,
  simplifiedSource,
  onRestoreOriginal,
  isEditingChords,
  onToggleEditChords,
  hasLyricOverflow,
  isPadPlaying,
  isPadLoading,
  currentKey,
  onTogglePad,
}: DisplayControlsProps) {
  return (
    <div className="space-y-2 pb-2 text-xs">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--ui-text-muted)]"><Columns3 size={13} /> Columns</span>
            <div className="ui-segmented ui-segmented--compact">
              {([1, 2, 3] as const).map((column) => (
                <button
                  key={column}
                  type="button"
                  aria-pressed={prefs.columns === column}
                  onClick={() => onChangePrefs({ ...prefs, columns: column })}
                  className={`ui-segmented__item ${prefs.columns === column ? 'ui-segmented__item--active' : ''}`}
                >
                  {column}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--ui-text-muted)]"><Type size={13} /> Size</span>
            <div className="flex items-center rounded-[0.7rem] border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] p-[3px]">
              <button
                type="button"
                aria-label="Decrease song font size"
                onClick={() => onChangePrefs({ ...prefs, fontSizePx: Math.max(10, prefs.fontSizePx - 1) })}
                className="min-h-7 rounded-lg px-2 font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-surface-raised)] disabled:opacity-30"
              >A−</button>
              <span className="w-7 text-center font-mono text-[11px] font-bold text-[var(--ui-text)]">{prefs.fontSizePx}</span>
              <button
                type="button"
                aria-label="Increase song font size"
                onClick={() => onChangePrefs({ ...prefs, fontSizePx: Math.min(22, prefs.fontSizePx + 1) })}
                className="min-h-7 rounded-lg px-2 font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-surface-raised)] disabled:opacity-30"
              >A+</button>
            </div>
          </div>
        </div>

        <div className="grid w-full grid-cols-2 gap-2 border-t border-[var(--ui-border)] pt-2.5 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:border-0 sm:pt-0">
          {onTogglePad && currentKey && (
            <Button
              size="sm"
              variant={isPadPlaying ? 'primary' : 'secondary'}
              icon={<AudioLines size={14} />}
              onClick={onTogglePad}
              disabled={isPadLoading}
              aria-pressed={Boolean(isPadPlaying)}
              title={
                isPadPlaying
                  ? `Stop ambient pad (${currentKey})`
                  : `Play ambient pad in ${currentKey}`
              }
            >
              {isPadPlaying ? `Playing Pad (${currentKey})` : 'Play Ambient Pad'}
            </Button>
          )}
          {canSimplify && (
            <div className="flex w-full items-center gap-1.5 sm:w-auto">
              <Button
                size="sm"
                variant={prefs.simplified ? 'primary' : 'secondary'}
                icon={<WandSparkles size={14} />}
                onClick={() => onChangePrefs({ ...prefs, simplified: !prefs.simplified })}
                className="flex-1 sm:flex-initial sm:w-auto"
              >
                {prefs.simplified ? 'Simplified' : 'Simplify'}
              </Button>
              {prefs.simplified && simplifiedSource === 'algorithmic' && (
                <span
                  title="Extra chord notes removed. Some chords may sound different."
                  aria-label="Extra chord notes removed. Some chords may sound different."
                  className="inline-flex shrink-0 items-center rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ui-text-muted)] select-none"
                >
                  Auto
                </span>
              )}
            </div>
          )}
          {onToggleEditChords && (
            <Button
              size="sm"
              variant={isEditingChords ? 'primary' : 'secondary'}
              icon={<Pencil size={14} />}
              onClick={onToggleEditChords}
              title={isEditingChords ? 'Exit chord editing mode' : 'Edit, move, or delete chords'}
            >
              {isEditingChords ? 'Done editing' : 'Edit chords'}
            </Button>
          )}
          {onRestoreOriginal && (
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw size={14} />}
              onClick={onRestoreOriginal}
              className={canSimplify ? '' : 'col-span-2'}
              title="Restore original chords and sections"
            >
              Restore
            </Button>
          )}
        </div>
      </div>

      {hasLyricOverflow && (
        <StatusBanner tone="warning" icon={<AlertTriangle size={15} />}>
          <strong>Lyric overflow detected.</strong>{' '}
          {isEditingChords
            ? 'Use Split line to choose a line phrase break.'
            : 'Enter Edit Chords to choose a line phrase break.'}
        </StatusBanner>
      )}
    </div>
  )
}
