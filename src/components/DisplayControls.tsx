import type { SongDisplayPrefs } from '../lib/songPrefs'

interface DisplayControlsProps {
  prefs: SongDisplayPrefs
  onChangePrefs: (newPrefs: SongDisplayPrefs) => void
  fitsNotice?: string | null
  canSimplify?: boolean
  onRestoreOriginal?: () => void
  isEditingChords?: boolean
  onToggleEditChords?: () => void
}

export default function DisplayControls({
  prefs,
  onChangePrefs,
  fitsNotice,
  canSimplify,
  onRestoreOriginal,
  isEditingChords,
  onToggleEditChords,
}: DisplayControlsProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 text-xs pt-0 pb-4">
      {/* View Display Controls: Columns & Font size */}
      <div className="flex flex-wrap items-center justify-between sm:justify-start gap-3 sm:gap-4">
        {/* Column controls */}
        <div className="flex items-center gap-2">
          <span className="text-neutral-600 dark:text-[#999999] font-medium">Columns:</span>
          <div className="flex bg-neutral-100 dark:bg-[#101010] p-0.5 rounded-lg border border-neutral-200 dark:border-[#282828]">
            {([1, 2, 3, 'fit'] as const).map((col) => (
              <button
                key={col}
                onClick={() => onChangePrefs({ ...prefs, columns: col })}
                className={`px-2.5 py-1 rounded font-medium transition-colors cursor-pointer capitalize ${
                  prefs.columns === col
                    ? 'bg-[#3368A0] text-white font-semibold dark:bg-amber-500 dark:text-black'
                    : 'text-neutral-600 dark:text-[#999999] hover:text-black dark:hover:text-[#e5e5e5]'
                }`}
              >
                {col === 'fit' ? 'Fit Screen' : `${col} Col`}
              </button>
            ))}
          </div>
        </div>

        {/* Font size controls */}
        <div className="flex items-center gap-2">
          <span className="text-neutral-600 dark:text-[#999999] font-medium">Font:</span>
          <div className="flex items-center gap-1 bg-neutral-100 dark:bg-[#101010] px-2 py-0.5 rounded-lg border border-neutral-200 dark:border-[#282828]">
            <button
              onClick={() =>
                onChangePrefs({ ...prefs, fontSizePx: Math.max(10, prefs.fontSizePx - 1) })
              }
              disabled={prefs.columns === 'fit'}
              className="px-1.5 py-0.5 text-neutral-600 dark:text-[#999999] hover:text-black dark:hover:text-[#e5e5e5] disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
            >
              A-
            </button>
            <span className="text-neutral-800 dark:text-[#e5e5e5] font-mono w-6 text-center">{prefs.fontSizePx}</span>
            <button
              onClick={() =>
                onChangePrefs({ ...prefs, fontSizePx: Math.min(22, prefs.fontSizePx + 1) })
              }
              disabled={prefs.columns === 'fit'}
              className="px-1.5 py-0.5 text-neutral-600 dark:text-[#999999] hover:text-black dark:hover:text-[#e5e5e5] disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
            >
              A+
            </button>
          </div>
        </div>
      </div>

      {/* Action Buttons: Arranged neatly in a 2-column grid on mobile, flex row on desktop */}
      <div className="grid grid-cols-2 sm:flex sm:items-center sm:flex-wrap gap-2 w-full sm:w-auto pt-2.5 sm:pt-0 border-t sm:border-t-0 border-neutral-100 dark:border-[#222222]">
        {/* Simplify toggle (when available from source) */}
        {canSimplify && (
          <button
            type="button"
            onClick={() => onChangePrefs({ ...prefs, simplified: !prefs.simplified })}
            className={`w-full sm:w-auto px-2.5 sm:px-3 py-2 sm:py-1 rounded font-medium transition-colors cursor-pointer border flex items-center justify-center gap-1.5 ${
              prefs.simplified
                ? 'bg-[#3368A0] text-white border-[#3368A0] font-bold dark:bg-amber-500 dark:text-black dark:border-amber-500'
                : 'bg-neutral-100 dark:bg-[#101010] text-neutral-700 dark:text-[#d4d4d4] border-neutral-300 dark:border-[#282828] hover:text-black dark:hover:text-[#e5e5e5]'
            }`}
          >
            <span>{prefs.simplified ? 'Simplified Chords ✓' : 'Simplify Chords'}</span>
          </button>
        )}

        {/* Edit Chords Toggle Button */}
        {onToggleEditChords && (
          <button
            type="button"
            onClick={onToggleEditChords}
            className={`w-full sm:w-auto px-2.5 sm:px-3 py-2 sm:py-1 rounded font-medium transition-colors cursor-pointer border flex items-center justify-center gap-1.5 ${
              isEditingChords
                ? 'bg-[#3368A0] text-white border-[#3368A0] font-bold shadow-xs dark:bg-amber-500 dark:text-black dark:border-amber-500'
                : 'bg-neutral-100 dark:bg-[#101010] text-neutral-700 dark:text-[#d4d4d4] border-neutral-300 dark:border-[#282828] hover:text-black dark:hover:text-[#e5e5e5]'
            }`}
            title={isEditingChords ? 'Exit chord editing mode' : 'Click to enable editing or deleting chords'}
          >
            <span>✎</span>
            <span>{isEditingChords ? 'Done Editing' : 'Edit Chords'}</span>
          </button>
        )}

        {/* Restore to original button (persists always) */}
        {onRestoreOriginal && (
          <button
            type="button"
            onClick={onRestoreOriginal}
            className={`w-full sm:w-auto px-2.5 sm:px-3 py-2 sm:py-1 rounded font-medium transition-colors cursor-pointer border border-[#3368A0]/40 bg-neutral-100 dark:bg-[#101010] text-[#255283] dark:text-amber-400 hover:bg-[#C8DFDB]/30 dark:hover:bg-[#252525] flex items-center justify-center gap-1.5 ${
              canSimplify ? '' : 'col-span-2 sm:col-auto'
            }`}
            title="Restore original chords and sections"
          >
            <span>↺</span>
            <span>Restore Original Sheet</span>
          </button>
        )}
      </div>

      {/* Notice if fit mode couldn't completely avoid scrolling */}
      {fitsNotice && (
        <div className="w-full text-xs text-[#1c436b] dark:text-amber-400/90 italic bg-[#C8DFDB]/40 dark:bg-amber-950/20 px-2 py-1 rounded border border-[#66A3BF]/40 dark:border-amber-900/40">
          {fitsNotice}
        </div>
      )}
    </div>
  )
}
