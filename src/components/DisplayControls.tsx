import type { SongDisplayPrefs } from '../lib/songPrefs'

interface DisplayControlsProps {
  prefs: SongDisplayPrefs
  onChangePrefs: (newPrefs: SongDisplayPrefs) => void
  fitsNotice?: string | null
}

export default function DisplayControls({
  prefs,
  onChangePrefs,
  fitsNotice,
}: DisplayControlsProps) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-4 text-xs">
      {/* Column controls */}
      <div className="flex items-center gap-2">
        <span className="text-neutral-400 font-medium">Columns:</span>
        <div className="flex bg-neutral-950 p-0.5 rounded-lg border border-neutral-800">
          {([1, 2, 3, 'fit'] as const).map((col) => (
            <button
              key={col}
              onClick={() => onChangePrefs({ ...prefs, columns: col })}
              className={`px-2.5 py-1 rounded font-medium transition-colors cursor-pointer capitalize ${
                prefs.columns === col
                  ? 'bg-amber-500 text-black'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              {col === 'fit' ? 'Fit Screen' : `${col} Col`}
            </button>
          ))}
        </div>
      </div>

      {/* Font size controls */}
      <div className="flex items-center gap-2">
        <span className="text-neutral-400 font-medium">Font:</span>
        <div className="flex items-center gap-1 bg-neutral-950 px-2 py-0.5 rounded-lg border border-neutral-800">
          <button
            onClick={() =>
              onChangePrefs({ ...prefs, fontSizePx: Math.max(10, prefs.fontSizePx - 1) })
            }
            disabled={prefs.columns === 'fit'}
            className="px-1.5 py-0.5 text-neutral-400 hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
          >
            A-
          </button>
          <span className="text-neutral-200 font-mono w-6 text-center">{prefs.fontSizePx}</span>
          <button
            onClick={() =>
              onChangePrefs({ ...prefs, fontSizePx: Math.min(22, prefs.fontSizePx + 1) })
            }
            disabled={prefs.columns === 'fit'}
            className="px-1.5 py-0.5 text-neutral-400 hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
          >
            A+
          </button>
        </div>
      </div>

      {/* Notice if fit mode couldn't completely avoid scrolling */}
      {fitsNotice && (
        <div className="w-full text-xs text-amber-400/90 italic bg-amber-950/20 px-2 py-1 rounded border border-amber-900/40">
          {fitsNotice}
        </div>
      )}
    </div>
  )
}
