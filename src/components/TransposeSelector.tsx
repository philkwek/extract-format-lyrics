import { RotateCcw } from 'lucide-react'
import { parseKey } from '../lib/transpose'
import { keyOptions, keyOffset, formatOffset, matchKeyOption } from '../lib/keys'

interface TransposeSelectorProps {
  originalKey: string | null
  currentKey: string | null
  onSelectKey: (newKey: string) => void
  onReset: () => void
  compact?: boolean
}

export default function TransposeSelector({
  originalKey,
  currentKey,
  onSelectKey,
  onReset,
  compact = false,
}: TransposeSelectorProps) {
  if (!originalKey) {
    if (compact) return null
    return (
      <div className="inline-flex h-8 items-center rounded-[0.7rem] border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] px-2.5 text-xs text-[var(--ui-text-muted)]">
        <span>Key unknown</span>
      </div>
    )
  }

  const parsedOrig = parseKey(originalKey)
  const isMinor = parsedOrig?.minor ?? false
  const options = keyOptions(isMinor)
  const matchedOriginal = matchKeyOption(originalKey) || originalKey
  const activeKey = currentKey || matchedOriginal

  const isModified = activeKey !== matchedOriginal

  return (
    <div className="inline-flex h-8 items-center rounded-[0.7rem] border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] px-2.5 text-xs shadow-2xs transition hover:border-[var(--ui-border-strong)]">
      <span className="mr-1.5 text-[11px] font-semibold text-[var(--ui-text-muted)] select-none">
        Key
      </span>
      <select
        aria-label="Transpose song"
        value={activeKey}
        onChange={(e) => onSelectKey(e.target.value)}
        className="cursor-pointer bg-transparent py-1 font-mono text-xs font-bold text-[var(--ui-text)] focus:outline-none"
      >
        {options.map((opt) => {
          const optOffset = keyOffset(matchedOriginal, opt)
          const optOffsetLabel = formatOffset(optOffset)
          const isOriginalOption = opt === matchedOriginal
          return (
            <option
              key={opt}
              value={opt}
              className="bg-[var(--ui-surface-raised)] text-[var(--ui-text)]"
            >
              {opt} {isOriginalOption ? '(Orig)' : `(${optOffsetLabel})`}
            </option>
          )
        })}
      </select>

      {isModified && (
        <button
          type="button"
          onClick={onReset}
          title={`Reset to original key (${matchedOriginal})`}
          aria-label={`Reset to original key (${matchedOriginal})`}
          className="ml-1 -mr-1 inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-md text-[var(--ui-text-muted)] transition-[color,background-color,transform] duration-100 ease-out hover:bg-[var(--ui-surface-muted)] hover:text-[var(--ui-text)] active:scale-[0.92]"
        >
          <RotateCcw size={12} />
        </button>
      )}
    </div>
  )
}
