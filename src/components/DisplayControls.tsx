import {
  AlertTriangle,
  Columns3,
  Pencil,
  RotateCcw,
  Scan,
  Type,
  WandSparkles,
} from 'lucide-react'
import { resolvePadKey, type PadKey } from '../lib/ambientPadPlayer'
import type { PadKeyMode } from '../lib/sessionStore'
import type { SheetColumns } from '../lib/songLayout'
import type { SongDisplayPrefs } from '../lib/songPrefs'
import PadControls from './PadControls'
import { Button, StatusBanner } from './ui'

export interface FitControlLayout {
  columns: SheetColumns
  fontSizePx: number
  fitsOnScreen: boolean
}

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
  padKeyMode?: PadKeyMode
  customPadKey?: PadKey | null
  onChangePadKeyMode?: (mode: PadKeyMode) => void
  onSelectCustomPadKey?: (key: PadKey) => void
  onTogglePad?: () => void
  variant?: 'default' | 'fullscreen'
  showPads?: boolean
  showStatus?: boolean
  fitActive?: boolean
  fitLayout?: FitControlLayout | null
  onToggleFit?: () => void
  fitNotice?: string | null
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
  padKeyMode = 'match',
  customPadKey,
  onChangePadKeyMode,
  onSelectCustomPadKey,
  onTogglePad,
  variant = 'default',
  showPads = true,
  showStatus = true,
  fitActive = false,
  fitLayout,
  onToggleFit,
  fitNotice,
}: DisplayControlsProps) {
  const resolvedCustomKey: PadKey = customPadKey ?? resolvePadKey(currentKey) ?? 'C'
  const effectivePadKey = padKeyMode === 'custom' ? resolvedCustomKey : currentKey
  const canPlayPad = Boolean(resolvePadKey(effectivePadKey))
  const isFullScreen = variant === 'fullscreen'
  const displayFontSizePx = fitActive && fitLayout ? fitLayout.fontSizePx : prefs.fontSizePx
  const showRightGroup =
    (showPads && onTogglePad && Boolean(onChangePadKeyMode || canPlayPad)) ||
    (!isFullScreen && Boolean(canSimplify || onToggleEditChords || onRestoreOriginal))

  const handleColumnChange = (column: SheetColumns) => {
    onChangePrefs({
      ...prefs,
      columns: column,
      fitToScreen: fitActive ? false : prefs.fitToScreen,
    })
  }

  const handleFontSizeChange = (delta: number) => {
    const nextSize = Math.max(10, Math.min(22, displayFontSizePx + delta))
    if (nextSize === displayFontSizePx) return
    onChangePrefs({
      ...prefs,
      fontSizePx: nextSize,
      fitToScreen: fitActive ? false : prefs.fitToScreen,
    })
  }

  const fitCaption =
    fitActive && fitLayout
      ? `Auto layout · ${fitLayout.columns} column${fitLayout.columns === 1 ? '' : 's'} · ${fitLayout.fontSizePx}px`
      : null
  const overflowMessage = hasLyricOverflow
    ? 'Lyric overflow detected. Try fewer columns or a smaller text size.'
    : null
  const statusMessage = fitNotice ?? overflowMessage ?? fitCaption

  return (
    <div className={`${isFullScreen ? 'space-y-1.5 pb-0' : 'space-y-2 pb-2'} text-xs`}>
      <div
        className={
          isFullScreen
            ? 'flex flex-wrap items-center justify-start gap-x-4 gap-y-2'
            : 'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4'
        }
      >
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--ui-text-muted)]">
              <Columns3 size={13} /> Columns
            </span>
            <div className="ui-segmented ui-segmented--compact">
              {([1, 2, 3, 4] as const).map((column) => (
                <button
                  key={column}
                  type="button"
                  aria-pressed={!fitActive && prefs.columns === column}
                  onClick={() => handleColumnChange(column)}
                  className={`ui-segmented__item ${
                    !fitActive && prefs.columns === column ? 'ui-segmented__item--active' : ''
                  }`}
                >
                  {column}
                </button>
              ))}
            </div>
            {isFullScreen && onToggleFit && (
              <Button
                size="sm"
                variant={fitActive ? 'primary' : 'secondary'}
                icon={<Scan size={14} />}
                onClick={onToggleFit}
                aria-pressed={fitActive}
                title={fitActive ? 'Turn off fit to screen' : 'Fit the whole song on screen'}
              >
                Fit
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--ui-text-muted)]">
              <Type size={13} /> Size
            </span>
            <div className="flex items-center rounded-[0.7rem] border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] p-[3px]">
              <button
                type="button"
                aria-label="Decrease song font size"
                onClick={() => handleFontSizeChange(-1)}
                className="min-h-7 rounded-lg px-2 font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-surface-raised)] disabled:opacity-30"
              >A−</button>
              <span className="w-7 text-center font-mono text-[11px] font-bold text-[var(--ui-text)]">
                {displayFontSizePx}
              </span>
              <button
                type="button"
                aria-label="Increase song font size"
                onClick={() => handleFontSizeChange(1)}
                className="min-h-7 rounded-lg px-2 font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-surface-raised)] disabled:opacity-30"
              >A+</button>
            </div>
          </div>
        </div>

        {showRightGroup && (
          <div
            className={
              isFullScreen
                ? 'flex flex-wrap items-center gap-2'
                : 'grid w-full justify-end grid-cols-2 gap-2 border-t border-[var(--ui-border)] pt-2.5 sm:flex sm:flex-grow sm:w-auto sm:flex-wrap sm:items-center sm:border-0 sm:pt-0'
            }
          >
            {showPads && (
              <PadControls
                currentKey={currentKey}
                padKeyMode={padKeyMode}
                customPadKey={customPadKey}
                isPadPlaying={isPadPlaying}
                isPadLoading={isPadLoading}
                onChangePadKeyMode={onChangePadKeyMode}
                onSelectCustomPadKey={onSelectCustomPadKey}
                onTogglePad={onTogglePad}
                variant={isFullScreen ? 'fullscreen' : 'default'}
              />
            )}
            {!isFullScreen && canSimplify && (
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
          {!isFullScreen && onToggleEditChords && (
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
          {!isFullScreen && onRestoreOriginal && (
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
        )}
      </div>

      {isFullScreen ? (
        showStatus ? (
          <div
            role="status"
            className="min-h-[14px] text-[10px] leading-[14px] text-[var(--ui-text-muted)]"
          >
            {statusMessage ?? '\u00A0'}
          </div>
        ) : null
      ) : (
        hasLyricOverflow && (
          <StatusBanner tone="warning" icon={<AlertTriangle size={15} />}>
            <strong>Lyric overflow detected.</strong>{' '}
            {isEditingChords
              ? 'Use Split line to choose a line phrase break.'
              : 'Enter Edit Chords to choose a line phrase break.'}
          </StatusBanner>
        )
      )}
    </div>
  )
}
