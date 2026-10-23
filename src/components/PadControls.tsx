import { AudioLines } from 'lucide-react'
import { PAD_KEYS, resolvePadKey, type PadKey } from '../lib/ambientPadPlayer'
import type { PadKeyMode } from '../lib/sessionStore'
import { Button, SegmentedControl } from './ui'

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
  variant = 'default',
}: PadControlsProps) {
  const resolvedCustomKey: PadKey = customPadKey ?? resolvePadKey(currentKey) ?? 'C'
  const effectivePadKey = padKeyMode === 'custom' ? resolvedCustomKey : currentKey
  const canPlayPad = Boolean(resolvePadKey(effectivePadKey))
  const isFullScreen = variant === 'fullscreen'

  if (!onTogglePad || (!onChangePadKeyMode && !canPlayPad)) return null

  return (
    <div
      className={
        isFullScreen
          ? 'flex flex-wrap items-center gap-2'
          : 'col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1'
      }
    >
      {onChangePadKeyMode && (
        <div className="flex flex-wrap items-center gap-2">
          {!isFullScreen && (
            <span className="text-[11px] font-semibold text-[var(--ui-text-muted)]">
              Pads Key:
            </span>
          )}
          <SegmentedControl
            label="Pads Key"
            value={padKeyMode}
            onChange={onChangePadKeyMode}
            className="ui-segmented--compact"
            options={[
              { value: 'match', label: 'Match Song' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
          {padKeyMode === 'custom' && onSelectCustomPadKey && (
            <select
              aria-label="Custom pad key"
              value={resolvedCustomKey}
              onChange={(e) => onSelectCustomPadKey(e.target.value as PadKey)}
              className="bg-white dark:bg-[#1a1a1a] border border-[#C8DFDB] dark:border-[#282828] text-neutral-900 dark:text-[#e5e5e5] rounded px-2.5 py-1 text-xs focus:outline-none focus:border-[#3368A0] dark:focus:border-amber-500 font-mono shadow-xs"
            >
              {PAD_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {effectivePadKey && canPlayPad && (
        <Button
          size="sm"
          variant={isPadPlaying ? 'primary' : 'secondary'}
          icon={<AudioLines size={14} />}
          onClick={onTogglePad}
          disabled={isPadLoading}
          aria-pressed={Boolean(isPadPlaying)}
          aria-label={
            isFullScreen
              ? isPadPlaying
                ? `Stop ambient pad (${effectivePadKey})`
                : `Play ambient pad in ${effectivePadKey}`
              : undefined
          }
          title={
            isPadPlaying
              ? `Stop ambient pad (${effectivePadKey})`
              : `Play ambient pad in ${effectivePadKey}`
          }
        >
          {isPadPlaying
            ? `Playing Pad (${effectivePadKey})`
            : isFullScreen
              ? 'Play Pad'
              : 'Play Ambient Pad'}
        </Button>
      )}
    </div>
  )
}
