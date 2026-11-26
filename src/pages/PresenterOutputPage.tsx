import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Maximize, Minimize } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { classes } from '../lib/classes'
import { createOutputChannel, type OutputState } from '../lib/presenterChannel'
import { useFullscreen } from '../lib/useFullscreen'
import { useViewportHeight } from '../lib/useViewportHeight'
import { useWakeLock } from '../lib/useWakeLock'
import PresenterCanvas from '../components/presenter/PresenterCanvas'
import { Button } from '../components/ui'

const HIDE_DELAY_MS = 500
const CORNER_BUTTON_STYLE = { height: 56, padding: '0 20px', fontSize: 18, borderRadius: 14 }

export default function PresenterOutputPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [state, setState] = useState<OutputState | null>(null)
  const [controlsVisible, setControlsVisible] = useState(false)
  const [controlsHovered, setControlsHovered] = useState(false)
  const [activity, setActivity] = useState(0)
  const heightPx = useViewportHeight()
  const { isFullscreen, toggleFullscreen } = useFullscreen()
  const reduceMotion = Boolean(useReducedMotion())
  const previousDark = useRef<boolean | null>(null)

  useWakeLock(true)

  useEffect(() => {
    const channel = createOutputChannel(id, setState)
    return () => channel.close()
  }, [id])

  useEffect(() => {
    if (!state) return
    if (previousDark.current === null) {
      previousDark.current = document.documentElement.classList.contains('dark')
    }
    document.documentElement.classList.toggle('dark', state.display.theme === 'dark')
  }, [state])

  useEffect(() => {
    return () => {
      if (previousDark.current !== null) {
        document.documentElement.classList.toggle('dark', previousDark.current)
      }
    }
  }, [])

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Presenter output'
    return () => {
      document.title = previousTitle
    }
  }, [])

  const show = useCallback(() => {
    setControlsVisible(true)
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
    if (!controlsVisible || controlsHovered) return
    const timer = window.setTimeout(() => setControlsVisible(false), HIDE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [controlsVisible, controlsHovered, activity])

  return (
    <div className="h-screen w-screen overflow-hidden bg-black">
      {state ? (
        <PresenterCanvas
          song={state.song}
          display={state.display}
          view={state.view}
          sectionIndex={state.sectionIndex}
          blackout={state.blackout}
          heightPx={heightPx}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <p className="text-sm text-neutral-400">Waiting for the presenter console…</p>
        </div>
      )}

      <div
        className={classes(
          'fixed right-8 bottom-8 z-50',
          controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0',
          reduceMotion ? '' : 'transition-opacity duration-200',
        )}
        onMouseEnter={() => setControlsHovered(true)}
        onMouseLeave={() => setControlsHovered(false)}
      >
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
