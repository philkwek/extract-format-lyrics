import type { ReactNode } from 'react'
import { AppWindow, Minus, Plus } from 'lucide-react'
import {
  clampTextScale,
  resolveAlign,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  TEXT_SCALE_STEP,
  type PresenterDisplay,
} from '../../lib/presenterSettings'
import type { SharedLyricsSong } from '../../types/song'
import { Button, IconButton, SegmentedControl } from '../ui'
import PresenterPreview from './PresenterPreview'

interface PresenterDisplayPanelProps {
  song: SharedLyricsSong | null
  sectionIndex: number
  display: PresenterDisplay
  onPatchDisplay: (patch: Partial<PresenterDisplay>) => void
  blackout: boolean
  onToggleBlackout: () => void
  outputOpen: boolean
  onOpenOutput: () => void
}

function DisplayRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
      <span className="text-ui-text-muted text-sm">{label}</span>
      <div className="w-full max-w-[230px] min-w-[170px] flex-1">{children}</div>
    </div>
  )
}

export default function PresenterDisplayPanel({
  song,
  sectionIndex,
  display,
  onPatchDisplay,
  blackout,
  onToggleBlackout,
  outputOpen,
  onOpenOutput,
}: PresenterDisplayPanelProps) {
  const sectionsView = display.lyricsView === 'sections'
  const align = resolveAlign(display, display.lyricsView)

  return (
    <aside className="bg-ui-surface border-ui-border flex min-w-0 flex-col overflow-y-auto rounded-2xl border p-6">
      <h2 className="text-ui-text-muted text-[11px] font-semibold tracking-wider uppercase">
        On screen
      </h2>
      <div className="mt-3">
        <PresenterPreview
          song={song}
          display={display}
          sectionIndex={sectionIndex}
          blackout={blackout}
        />
      </div>

      <h2 className="text-ui-text-muted mt-6 text-[11px] font-semibold tracking-wider uppercase">
        Display
      </h2>
      <div className="mt-3 space-y-3">
        <DisplayRow label="Lyrics view">
          <SegmentedControl
            label="Lyrics view"
            value={display.lyricsView}
            onChange={(lyricsView) => onPatchDisplay({ lyricsView })}
            options={[
              { value: 'whole', label: 'Whole song' },
              { value: 'sections', label: 'Sections' },
            ]}
            className="ui-segmented--full"
          />
        </DisplayRow>

        <DisplayRow label="Text size">
          <div className="flex items-center justify-end gap-1.5">
            <IconButton
              label="Make text smaller"
              variant="secondary"
              disabled={display.textScale <= TEXT_SCALE_MIN}
              onClick={() =>
                onPatchDisplay({
                  textScale: clampTextScale(display.textScale - TEXT_SCALE_STEP),
                })
              }
            >
              <Minus size={16} />
            </IconButton>
            <span className="w-11 text-center font-mono text-sm tabular-nums">
              {display.textScale}%
            </span>
            <IconButton
              label="Make text larger"
              variant="secondary"
              disabled={display.textScale >= TEXT_SCALE_MAX}
              onClick={() =>
                onPatchDisplay({
                  textScale: clampTextScale(display.textScale + TEXT_SCALE_STEP),
                })
              }
            >
              <Plus size={16} />
            </IconButton>
          </div>
        </DisplayRow>

        {sectionsView && (
          <DisplayRow label="Section positioning">
            <SegmentedControl
              label="Section positioning"
              value={display.sectionPosition}
              onChange={(sectionPosition) => onPatchDisplay({ sectionPosition })}
              options={[
                { value: 'top', label: 'Top' },
                { value: 'center', label: 'Centre' },
              ]}
              className="ui-segmented--full"
            />
          </DisplayRow>
        )}

        <DisplayRow label="Lyrics alignment">
          <SegmentedControl
            label="Lyrics alignment"
            value={align}
            onChange={(next) => onPatchDisplay({ align: next })}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Centre' },
            ]}
            className="ui-segmented--full"
          />
        </DisplayRow>

        <DisplayRow label="Case">
          <SegmentedControl
            label="Case"
            value={display.caps ? 'caps' : 'normal'}
            onChange={(value) => onPatchDisplay({ caps: value === 'caps' })}
            options={[
              { value: 'normal', label: 'Normal case' },
              { value: 'caps', label: 'All caps' },
            ]}
            className="ui-segmented--full"
          />
        </DisplayRow>

        <DisplayRow label="Theme">
          <SegmentedControl
            label="Theme"
            value={display.theme}
            onChange={(theme) => onPatchDisplay({ theme })}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
            className="ui-segmented--full"
          />
        </DisplayRow>
      </div>

      <div className="flex-1" />

      <p className="text-ui-text-muted mt-6 text-sm">
        {outputOpen ? 'Output window: open' : 'Output window: not open yet'}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 2xl:grid-cols-2">
        <Button variant="secondary" onClick={onToggleBlackout}>
          {blackout ? 'Show lyrics' : 'Fade to black'}
        </Button>
        <Button variant="primary" icon={<AppWindow size={16} />} onClick={onOpenOutput}>
          Open output window
        </Button>
      </div>
    </aside>
  )
}
