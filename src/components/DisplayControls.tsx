import { AlertTriangle, Columns3, Pencil, RotateCcw, Type, WandSparkles } from 'lucide-react'
import type { SongDisplayPrefs } from '../lib/songPrefs'
import { Button, StatusBanner } from './ui'

interface DisplayControlsProps {
  prefs: SongDisplayPrefs
  onChangePrefs: (newPrefs: SongDisplayPrefs) => void
  fitsNotice?: string | null
  canSimplify?: boolean
  onRestoreOriginal?: () => void
  isEditingChords?: boolean
  onToggleEditChords?: () => void
  hasLyricOverflow?: boolean
}

export default function DisplayControls({
  prefs,
  onChangePrefs,
  fitsNotice,
  canSimplify,
  onRestoreOriginal,
  isEditingChords,
  onToggleEditChords,
  hasLyricOverflow,
}: DisplayControlsProps) {
  return (
    <div className="space-y-2 pb-2 text-xs">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--ui-text-muted)]"><Columns3 size={13} /> Columns</span>
            <div className="ui-segmented ui-segmented--compact">
              {([1, 2, 3, 'fit'] as const).map((column) => (
                <button
                  key={column}
                  type="button"
                  aria-pressed={prefs.columns === column}
                  onClick={() => onChangePrefs({ ...prefs, columns: column })}
                  className={`ui-segmented__item ${prefs.columns === column ? 'ui-segmented__item--active' : ''}`}
                >
                  {column === 'fit' ? 'Fit' : column}
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
                disabled={prefs.columns === 'fit'}
                className="min-h-7 rounded-lg px-2 font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-surface-raised)] disabled:opacity-30"
              >A−</button>
              <span className="w-7 text-center font-mono text-[11px] font-bold text-[var(--ui-text)]">{prefs.fontSizePx}</span>
              <button
                type="button"
                aria-label="Increase song font size"
                onClick={() => onChangePrefs({ ...prefs, fontSizePx: Math.min(22, prefs.fontSizePx + 1) })}
                disabled={prefs.columns === 'fit'}
                className="min-h-7 rounded-lg px-2 font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-surface-raised)] disabled:opacity-30"
              >A+</button>
            </div>
          </div>
        </div>

        <div className="grid w-full grid-cols-2 gap-2 border-t border-[var(--ui-border)] pt-2.5 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:border-0 sm:pt-0">
          {canSimplify && (
            <Button
              size="sm"
              variant={prefs.simplified ? 'primary' : 'secondary'}
              icon={<WandSparkles size={14} />}
              onClick={() => onChangePrefs({ ...prefs, simplified: !prefs.simplified })}
            >
              {prefs.simplified ? 'Simplified' : 'Simplify'}
            </Button>
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

      {fitsNotice && <StatusBanner tone="info">{fitsNotice}</StatusBanner>}

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
