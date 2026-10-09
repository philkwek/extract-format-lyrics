import { parseKey } from '../lib/transpose'
import { keyOptions, keyOffset, formatOffset, matchKeyOption } from '../lib/keys'

interface TransposeSelectorProps {
  originalKey: string | null
  currentKey: string | null
  onSelectKey: (newKey: string) => void
  onReset: () => void
}

export default function TransposeSelector({
  originalKey,
  currentKey,
  onSelectKey,
  onReset,
}: TransposeSelectorProps) {
  if (!originalKey) {
    return (
      <div className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
        <span>Key unknown</span>
      </div>
    )
  }

  const parsedOrig = parseKey(originalKey)
  const isMinor = parsedOrig?.minor ?? false
  const options = keyOptions(isMinor)
  const matchedOriginal = matchKeyOption(originalKey) || originalKey
  const activeKey = currentKey || matchedOriginal

  const offset = keyOffset(matchedOriginal, activeKey)
  const offsetLabel = formatOffset(offset)

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-neutral-600 dark:text-neutral-400 font-medium">Transpose:</span>
      <select
        value={activeKey}
        onChange={(e) => onSelectKey(e.target.value)}
        className="bg-white dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-700 text-neutral-900 dark:text-neutral-100 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-amber-500 font-mono shadow-xs"
      >
        {options.map((opt) => {
          const optOffset = keyOffset(matchedOriginal, opt)
          const optOffsetLabel = formatOffset(optOffset)
          return (
            <option key={opt} value={opt}>
              {opt} {optOffset !== 0 ? `(${optOffsetLabel})` : '(Original)'}
            </option>
          )
        })}
      </select>

      {offset !== 0 && (
        <div className="flex items-center gap-2">
          <span className="text-amber-700 dark:text-amber-400 font-medium">
            (original {matchedOriginal}, {offsetLabel})
          </span>
          <button
            onClick={onReset}
            className="text-xs text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white underline cursor-pointer"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  )
}
