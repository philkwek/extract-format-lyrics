import type { ReactNode } from 'react'
import { Minus, Plus } from 'lucide-react'
import {
  clampTextScale,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  TEXT_SCALE_STEP,
  type PresenterDisplay,
} from '../../lib/presenterSettings'
import { IconButton, SegmentedControl } from '../ui'

interface ControlsProps {
  display: PresenterDisplay
  onPatchDisplay: (patch: Partial<PresenterDisplay>) => void
}

export function TextSizeStepper({
  display,
  onPatchDisplay,
  valueClassName,
}: ControlsProps & { valueClassName: string }) {
  const step = (delta: number) =>
    onPatchDisplay({ textScale: clampTextScale(display.textScale + delta) })
  return (
    <div className="flex items-center justify-end gap-1.5">
      <IconButton
        label="Make text smaller"
        variant="secondary"
        disabled={display.textScale <= TEXT_SCALE_MIN}
        onClick={() => step(-TEXT_SCALE_STEP)}
      >
        <Minus size={16} />
      </IconButton>
      <span className={`w-11 text-center font-mono tabular-nums ${valueClassName}`}>
        {display.textScale}%
      </span>
      <IconButton
        label="Make text larger"
        variant="secondary"
        disabled={display.textScale >= TEXT_SCALE_MAX}
        onClick={() => step(TEXT_SCALE_STEP)}
      >
        <Plus size={16} />
      </IconButton>
    </div>
  )
}

interface DisplaySegmentsProps extends ControlsProps {
  /** The alignment currently in effect, which depends on the lyrics view. */
  align: 'left' | 'center'
  /** Lays out one labelled control; the console and the corner panel space them differently. */
  row: (label: string, control: ReactNode) => ReactNode
  segmentClassName: string
}

export function DisplaySegments({
  display,
  onPatchDisplay,
  align,
  row,
  segmentClassName,
}: DisplaySegmentsProps) {
  return (
    <>
      {row(
        'Lyrics alignment',
        <SegmentedControl
          label="Lyrics alignment"
          value={align}
          onChange={(next) => onPatchDisplay({ align: next })}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Centre' },
          ]}
          className={segmentClassName}
        />,
      )}
      {row(
        'Case',
        <SegmentedControl
          label="Case"
          value={display.caps ? 'caps' : 'normal'}
          onChange={(value) => onPatchDisplay({ caps: value === 'caps' })}
          options={[
            { value: 'normal', label: 'Normal case' },
            { value: 'caps', label: 'All caps' },
          ]}
          className={segmentClassName}
        />,
      )}
      {row(
        'Theme',
        <SegmentedControl
          label="Theme"
          value={display.theme}
          onChange={(theme) => onPatchDisplay({ theme })}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
          className={segmentClassName}
        />,
      )}
    </>
  )
}
