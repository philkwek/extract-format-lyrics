import { useCallback, useEffect, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { classes } from '../../lib/classes'
import { useAutoHide } from '../../lib/useAutoHide'
import { resolveAlign, type PresenterDisplay } from '../../lib/presenterSettings'
import type { PresenterFeedStatus } from '../../lib/usePresenterFeed'
import { Button, LivePill } from '../ui'
import { liveDotClasses, type LiveTone } from '../ui/liveTone'
import { DisplaySegments, TextSizeStepper } from './PresenterDisplayControls'
import { CORNER_BUTTON_STYLE } from './cornerButtonStyle'
import PresenterFullscreenButton from './PresenterFullscreenButton'

interface PresenterCornerProps {
  status: PresenterFeedStatus
  display: PresenterDisplay
  onPatchDisplay: (patch: Partial<PresenterDisplay>) => void
  blackout: boolean
  onToggleBlackout: () => void
  onSwitchToManual: () => void
}

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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const controlsRef = useRef<HTMLDivElement>(null)
  const keyboardFocusRef = useRef(false)
  const { visible, show, bump, hoverProps } = useAutoHide({
    hold: settingsOpen,
    canHide: () =>
      !(keyboardFocusRef.current && controlsRef.current?.contains(document.activeElement)),
  })

  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
    keyboardFocusRef.current = false
    if (
      controlsRef.current?.contains(document.activeElement) &&
      document.activeElement instanceof HTMLElement
    ) {
      document.activeElement.blur()
    }
  }, [])

  useEffect(() => {
    const onPointerDown = () => {
      keyboardFocusRef.current = false
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') keyboardFocusRef.current = true
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    if (!settingsOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (!controlsRef.current?.contains(event.target as Node)) closeSettings()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSettings()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [settingsOpen, closeSettings])

  const pill = statusPill(status)
  const align = resolveAlign(display, 'whole')

  return (
    <div
      ref={controlsRef}
      className={classes(
        'fixed right-8 bottom-8 z-50 flex flex-col items-end gap-2',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
        reduceMotion ? '' : 'transition-opacity duration-400',
      )}
      onFocus={show}
      onBlur={(event) => {
        if (!controlsRef.current?.contains(event.relatedTarget as Node | null)) {
          keyboardFocusRef.current = false
          bump()
        }
      }}
      {...hoverProps}
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
              <TextSizeStepper
                display={display}
                onPatchDisplay={onPatchDisplay}
                valueClassName="text-sm"
              />
            </div>

            <DisplaySegments
              display={display}
              onPatchDisplay={onPatchDisplay}
              align={align}
              segmentClassName="ui-segmented--full ui-segmented--accent"
              row={(label, control) => (
                <div key={label} className="space-y-1.5">
                  <span className="text-ui-text-muted text-xs">{label}</span>
                  {control}
                </div>
              )}
            />

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
            if (settingsOpen) {
              closeSettings()
            } else {
              setSettingsOpen(true)
              show()
            }
          }}
        >
          Settings
        </Button>
        <PresenterFullscreenButton />
      </div>
    </div>
  )
}
