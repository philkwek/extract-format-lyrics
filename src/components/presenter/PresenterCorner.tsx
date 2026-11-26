import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize, Minimize, Minus, Plus, SlidersHorizontal } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { classes } from '../../lib/classes'
import { useFullscreen } from '../../lib/useFullscreen'
import {
  clampTextScale,
  resolveAlign,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  TEXT_SCALE_STEP,
  type PresenterDisplay,
} from '../../lib/presenterSettings'
import type { PresenterFeedStatus } from '../../lib/usePresenterFeed'
import { Button, IconButton, LivePill, SegmentedControl } from '../ui'
import { liveDotClasses, type LiveTone } from '../ui/liveTone'

interface PresenterCornerProps {
  status: PresenterFeedStatus
  display: PresenterDisplay
  onPatchDisplay: (patch: Partial<PresenterDisplay>) => void
  blackout: boolean
  onToggleBlackout: () => void
  onSwitchToManual: () => void
}

const HIDE_DELAY_MS = 3000
/** Sized for a laptop driving a projector across the room, as in the design. */
const CORNER_BUTTON_STYLE = { height: 56, padding: '0 20px', fontSize: 18, borderRadius: 14 }

function statusPill(status: PresenterFeedStatus): { tone: LiveTone; label: string } | null {
  if (status === 'live') return { tone: 'live', label: 'Live: Following host' }
  if (status === 'lost') return { tone: 'reconnecting', label: 'Not live: Lost connection' }
  if (status === 'stopped') return { tone: 'ended', label: 'Not live: Sharing stopped' }
  return null
}

export default function PresenterCorner({
  status,
  display,
  onPatchDisplay,
  blackout,
  onToggleBlackout,
  onSwitchToManual,
}: PresenterCornerProps) {
  const reduceMotion = Boolean(useReducedMotion())
  const [visible, setVisible] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activity, setActivity] = useState(0)
  const { isFullscreen, toggleFullscreen } = useFullscreen()
  const controlsRef = useRef<HTMLDivElement>(null)

  const show = useCallback(() => {
    setVisible(true)
    setActivity((count) => count + 1)
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', show)
    window.addEventListener('pointerdown', show)
    return () => {
      window.removeEventListener('mousemove', show)
      window.removeEventListener('pointerdown', show)
    }
  }, [show])

  useEffect(() => {
    if (!visible || settingsOpen) return
    const timer = window.setTimeout(() => {
      if (controlsRef.current?.contains(document.activeElement)) return
      setVisible(false)
    }, HIDE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [visible, settingsOpen, activity])

  useEffect(() => {
    if (!settingsOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (!controlsRef.current?.contains(event.target as Node)) setSettingsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [settingsOpen])

  const pill = statusPill(status)
  const align = resolveAlign(display, 'whole')

  return (
    <div
      ref={controlsRef}
      className={classes(
        'fixed right-8 bottom-8 z-50 flex flex-col items-end gap-2',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
        reduceMotion ? '' : 'transition-opacity duration-200',
      )}
      onFocus={show}
      onPointerDown={show}
    >
      {settingsOpen && (
        <div
          role="dialog"
          aria-label="Display settings"
          className="border-ui-border bg-ui-surface-raised absolute right-0 bottom-full mb-3 w-[380px] rounded-2xl border p-4 shadow-[var(--ui-shadow-lg)]"
        >
          <div className="text-ui-text space-y-4">
            <h2 className="text-base font-bold">Display settings</h2>

            <div className="flex items-center justify-between gap-3">
              <span className="text-ui-text-muted text-sm">Text size</span>
              <div className="flex items-center gap-1.5">
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
            </div>

            <div className="space-y-1.5">
              <span className="text-ui-text-muted text-xs">Lyrics alignment</span>
              <SegmentedControl
                label="Lyrics alignment"
                value={align}
                onChange={(value) => onPatchDisplay({ align: value })}
                options={[
                  { value: 'left', label: 'Left' },
                  { value: 'center', label: 'Centre' },
                ]}
                className="ui-segmented--full ui-segmented--accent"
              />
            </div>

            <div className="space-y-1.5">
              <span className="text-ui-text-muted text-xs">Case</span>
              <SegmentedControl
                label="Case"
                value={display.caps ? 'caps' : 'normal'}
                onChange={(value) => onPatchDisplay({ caps: value === 'caps' })}
                options={[
                  { value: 'normal', label: 'Normal case' },
                  { value: 'caps', label: 'All caps' },
                ]}
                className="ui-segmented--full ui-segmented--accent"
              />
            </div>

            <div className="space-y-1.5">
              <span className="text-ui-text-muted text-xs">Theme</span>
              <SegmentedControl
                label="Theme"
                value={display.theme}
                onChange={(theme) => onPatchDisplay({ theme })}
                options={[
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' },
                ]}
                className="ui-segmented--full ui-segmented--accent"
              />
            </div>

            <Button variant="secondary" className="w-full" onClick={onToggleBlackout}>
              {blackout ? 'Show lyrics' : 'Fade to black'}
            </Button>
            <Button
              variant="secondary"
              className="border-ui-border w-full"
              onClick={onSwitchToManual}
            >
              Switch to manual control
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        {pill && (
          <LivePill
            tone={pill.tone}
            className="h-10 gap-2 px-4 text-base"
            style={{ fontSize: '1rem' }}
          >
            <span
              aria-hidden="true"
              className={classes('h-2.5 w-2.5 rounded-full', liveDotClasses[pill.tone])}
            />
            {pill.label}
          </LivePill>
        )}
        <Button
          variant="secondary"
          icon={<SlidersHorizontal size={18} />}
          style={CORNER_BUTTON_STYLE}
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          onClick={() => {
            setSettingsOpen((open) => !open)
            show()
          }}
        >
          Settings
        </Button>
        <Button
          variant="secondary"
          icon={isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          style={CORNER_BUTTON_STYLE}
          onClick={toggleFullscreen}
        >
          {isFullscreen ? 'Exit full screen' : 'Go full screen'}
        </Button>
      </div>
    </div>
  )
}
