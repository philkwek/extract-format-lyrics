import type { ReactNode } from 'react'
import { AppWindow } from 'lucide-react'
import { resolveAlign, type PresenterDisplay } from '../../lib/presenterSettings'
import type { SharedLyricsSong } from '../../types/song'
import { Button, SegmentedControl } from '../ui'
import { DisplaySegments, TextSizeStepper } from './PresenterDisplayControls'
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
      <span className="text-ui-text-muted text-xs">{label}</span>
      <div className="shrink-0">{children}</div>
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
    <aside className="bg-ui-surface border-ui-border flex min-w-0 flex-col overflow-y-auto rounded-2xl border p-4">
      <h2 className="text-ui-text-muted text-[10px] font-semibold tracking-wider uppercase">
        On screen
      </h2>
      <div className="mt-2">
        <PresenterPreview
          song={song}
          display={display}
          sectionIndex={sectionIndex}
          blackout={blackout}
        />
      </div>

      <h2 className="text-ui-text-muted mt-4 text-[10px] font-semibold tracking-wider uppercase">
        Display
      </h2>
      <div className="mt-2.5 space-y-2.5">
        <DisplayRow label="Text size">
          <TextSizeStepper
            display={display}
            onPatchDisplay={onPatchDisplay}
            valueClassName="text-xs"
          />
        </DisplayRow>

        <DisplayRow label="Lyrics view">
          <SegmentedControl
            label="Lyrics view"
            value={display.lyricsView}
            onChange={(lyricsView) => onPatchDisplay({ lyricsView })}
            options={[
              { value: 'whole', label: 'Whole song' },
              { value: 'sections', label: 'Sections' },
            ]}
            className="ui-segmented--accent"
          />
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
              className="ui-segmented--accent"
            />
          </DisplayRow>
        )}

        <DisplaySegments
          display={display}
          onPatchDisplay={onPatchDisplay}
          align={align}
          segmentClassName="ui-segmented--accent"
          row={(label, control) => (
            <DisplayRow key={label} label={label}>
              {control}
            </DisplayRow>
          )}
        />
      </div>

      <div className="flex-1" />

      <p className="text-ui-text-muted mt-4 text-xs">
        {outputOpen ? 'Output window: open' : 'Output window: not open yet'}
      </p>
      <div className="mt-2.5 grid grid-cols-1 gap-2 2xl:grid-cols-2">
        <Button variant="secondary" onClick={onToggleBlackout}>
          {blackout ? 'Show lyrics' : 'Fade to black'}
        </Button>
        <Button variant="primary" icon={<AppWindow size={16} />} onClick={onOpenOutput}>
          Open presenter window
        </Button>
      </div>
    </aside>
  )
}
