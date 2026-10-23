import { useEffect, useRef, useState } from 'react'
import { AudioLines, ChevronDown } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { PAD_KEYS, resolvePadKey, type PadKey } from '../lib/ambientPadPlayer'
import type { PadKeyMode } from '../lib/sessionStore'
import { getPopoverMotion } from '../lib/uiMotion'
import { SegmentedControl } from './ui'

interface PadControlsProps {
  currentKey?: string | null
  padKeyMode?: PadKeyMode
  customPadKey?: PadKey | null
  isPadPlaying?: boolean
  isPadLoading?: boolean
  onChangePadKeyMode?: (mode: PadKeyMode) => void
  onSelectCustomPadKey?: (key: PadKey) => void
  onTogglePad?: () => void
  variant?: 'default' | 'fullscreen'
}

export default function PadControls({
  currentKey,
  padKeyMode = 'match',
  customPadKey,
  isPadPlaying,
  isPadLoading,
  onChangePadKeyMode,
  onSelectCustomPadKey,
  onTogglePad,
}: PadControlsProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion()
  const popoverMotion = getPopoverMotion(Boolean(reduceMotion))

  const resolvedCustomKey: PadKey = customPadKey ?? resolvePadKey(currentKey) ?? 'C'
  const effectivePadKey = padKeyMode === 'custom' ? resolvedCustomKey : currentKey
  const canPlayPad = Boolean(resolvePadKey(effectivePadKey))

  useEffect(() => {
    if (!isMenuOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isMenuOpen])

  if (!onTogglePad || (!onChangePadKeyMode && !canPlayPad)) return null

  const keyDisplay = effectivePadKey ?? '—'
  const buttonLabel = isPadPlaying ? `Playing Pad (${keyDisplay})` : `Pad (${keyDisplay})`
  const ariaLabel = isPadPlaying ? `Playing Pad (${keyDisplay})` : 'Play Ambient Pad'

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      <div
        className={`inline-flex h-8 items-center overflow-hidden rounded-[0.7rem] border transition ${
          isPadPlaying
            ? 'border-transparent bg-[var(--ui-accent)] text-white dark:text-[#16120a] shadow-xs'
            : 'border-[var(--ui-border)] bg-[var(--ui-surface-raised)] text-[var(--ui-text)] shadow-2xs hover:border-[var(--ui-border-strong)]'
        }`}
      >
        {effectivePadKey && canPlayPad && (
          <button
            type="button"
            onClick={onTogglePad}
            disabled={isPadLoading}
            aria-pressed={Boolean(isPadPlaying)}
            aria-label={ariaLabel}
            title={
              isPadPlaying
                ? `Stop ambient pad (${effectivePadKey})`
                : `Play ambient pad in ${effectivePadKey}`
            }
            className={`inline-flex h-full cursor-pointer items-center gap-1.5 px-2.5 text-[0.78rem] font-[650] leading-none transition-[background-color,transform] duration-100 ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 select-none ${
              isPadPlaying
                ? 'hover:bg-[var(--ui-accent-strong)]'
                : 'hover:bg-[color-mix(in_srgb,var(--ui-accent)_8%,var(--ui-surface-raised))]'
            }`}
          >
            {isPadLoading ? (
              <span className="ui-spinner" aria-hidden="true" />
            ) : (
              <AudioLines size={14} />
            )}
            <span>{buttonLabel}</span>
          </button>
        )}

        {onChangePadKeyMode && (
          <button
            type="button"
            onClick={() => setIsMenuOpen((prev) => !prev)}
            aria-label="Pad key settings"
            aria-expanded={isMenuOpen}
            title="Pad key settings"
            className={`inline-flex h-full cursor-pointer items-center justify-center border-l px-1.5 transition-[background-color,color,transform] duration-100 ease-out active:scale-[0.95] select-none ${
              isPadPlaying
                ? 'border-white/20 dark:border-black/20 hover:bg-[var(--ui-accent-strong)]'
                : 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[color-mix(in_srgb,var(--ui-accent)_8%,var(--ui-surface-raised))] hover:text-[var(--ui-text)]'
            }`}
          >
            <ChevronDown
              size={13}
              className={`transition-transform duration-200 ease-out ${isMenuOpen ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>

      <AnimatePresence>
        {isMenuOpen && onChangePadKeyMode && (
          <motion.div
            role="dialog"
            aria-label="Pad key settings"
            initial={popoverMotion.initial}
            animate={popoverMotion.animate}
            exit={popoverMotion.exit}
            transition={popoverMotion.transition}
            className="ui-popover absolute right-0 top-full z-30 mt-1.5 flex w-[11.25rem] flex-col gap-1.5 p-2"
          >
            <SegmentedControl
              label="Pads Key"
              value={padKeyMode}
              onChange={onChangePadKeyMode}
              className="ui-segmented--compact ui-segmented--full"
              options={[
                { value: 'match', label: 'Match Song' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
            {padKeyMode === 'custom' && onSelectCustomPadKey && (
              <div className="flex items-center justify-between gap-2 px-0.5 pt-0.5">
                <span className="text-[11px] font-medium text-[var(--ui-text-muted)]">Key</span>
                <select
                  aria-label="Custom pad key"
                  value={resolvedCustomKey}
                  onChange={(e) => onSelectCustomPadKey(e.target.value as PadKey)}
                  className="h-7 cursor-pointer rounded-[0.55rem] border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] px-2 font-mono text-xs font-bold text-[var(--ui-text)] transition hover:border-[var(--ui-border-strong)] focus:border-[var(--ui-accent)] focus:outline-none"
                >
                  {PAD_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
