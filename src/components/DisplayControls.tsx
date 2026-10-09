import type { SongDisplayPrefs } from '../lib/songPrefs'

interface DisplayControlsProps {
  prefs: SongDisplayPrefs
  onChangePrefs: (newPrefs: SongDisplayPrefs) => void
  fitsNotice?: string | null
  canSimplify?: boolean
}

export default function DisplayControls({
  prefs,
  onChangePrefs,
  fitsNotice,
  canSimplify,
}: DisplayControlsProps) {
  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-4 text-xs shadow-xs">
      {/* Column controls */}
      <div className="flex items-center gap-2">
        <span className="text-neutral-600 dark:text-neutral-400 font-medium">Columns:</span>
        <div className="flex bg-neutral-100 dark:bg-neutral-950 p-0.5 rounded-lg border border-neutral-200 dark:border-neutral-800">
          {([1, 2, 3, 'fit'] as const).map((col) => (
            <button
              key={col}
              onClick={() => onChangePrefs({ ...prefs, columns: col })}
              className={`px-2.5 py-1 rounded font-medium transition-colors cursor-pointer capitalize ${
                prefs.columns === col
                  ? 'bg-amber-500 text-black font-semibold'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white'
              }`}
            >
              {col === 'fit' ? 'Fit Screen' : `${col} Col`}
            </button>
          ))}
        </div>
      </div>

      {/* Font size controls */}
      <div className="flex items-center gap-2">
        <span className="text-neutral-600 dark:text-neutral-400 font-medium">Font:</span>
        <div className="flex items-center gap-1 bg-neutral-100 dark:bg-neutral-950 px-2 py-0.5 rounded-lg border border-neutral-200 dark:border-neutral-800">
          <button
            onClick={() =>
              onChangePrefs({ ...prefs, fontSizePx: Math.max(10, prefs.fontSizePx - 1) })
            }
            disabled={prefs.columns === 'fit'}
            className="px-1.5 py-0.5 text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
          >
            A-
          </button>
          <span className="text-neutral-800 dark:text-neutral-200 font-mono w-6 text-center">{prefs.fontSizePx}</span>
          <button
            onClick={() =>
              onChangePrefs({ ...prefs, fontSizePx: Math.min(22, prefs.fontSizePx + 1) })
            }
            disabled={prefs.columns === 'fit'}
            className="px-1.5 py-0.5 text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
          >
            A+
          </button>
        </div>
      </div>

      {/* Simplify toggle (when available from source) */}
      {canSimplify && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onChangePrefs({ ...prefs, simplified: !prefs.simplified })}
            className={`px-3 py-1 rounded font-medium transition-colors cursor-pointer border ${
              prefs.simplified
                ? 'bg-amber-500 text-black border-amber-500 font-bold'
                : 'bg-neutral-100 dark:bg-neutral-950 text-neutral-700 dark:text-neutral-300 border-neutral-300 dark:border-neutral-700 hover:text-black dark:hover:text-white'
            }`}
          >
            {prefs.simplified ? 'Simplified Chords ✓' : 'Simplify Chords'}
          </button>
        </div>
      )}

      {/* Theme toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChangePrefs({ ...prefs, darkMode: !prefs.darkMode })}
          className="px-2.5 py-1 rounded font-medium transition-colors cursor-pointer border border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-950 text-neutral-700 dark:text-neutral-300 hover:text-black dark:hover:text-white flex items-center gap-1.5"
          title="Toggle light / dark mode"
        >
          <span>{prefs.darkMode ? '🌙' : '☀️'}</span>
          <span>{prefs.darkMode ? 'Dark' : 'Light'}</span>
        </button>
      </div>

      {/* Notice if fit mode couldn't completely avoid scrolling */}
      {fitsNotice && (
        <div className="w-full text-xs text-amber-800 dark:text-amber-400/90 italic bg-amber-50 dark:bg-amber-950/20 px-2 py-1 rounded border border-amber-200 dark:border-amber-900/40">
          {fitsNotice}
        </div>
      )}
    </div>
  )
}
