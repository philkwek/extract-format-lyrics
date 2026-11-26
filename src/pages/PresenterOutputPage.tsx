import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useReducedMotion } from 'motion/react'
import { classes } from '../lib/classes'
import { createOutputChannel, type OutputState } from '../lib/presenterChannel'
import { useAutoHide } from '../lib/useAutoHide'
import { usePresenterTheme } from '../lib/usePresenterTheme'
import { useViewportHeight } from '../lib/useViewportHeight'
import { useWakeLock } from '../lib/useWakeLock'
import PresenterCanvas from '../components/presenter/PresenterCanvas'
import PresenterFullscreenButton from '../components/presenter/PresenterFullscreenButton'

export default function PresenterOutputPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [state, setState] = useState<OutputState | null>(null)
  const { visible: controlsVisible, hoverProps } = useAutoHide()
  const heightPx = useViewportHeight()
  const reduceMotion = Boolean(useReducedMotion())

  useWakeLock(true)

  useEffect(() => {
    const channel = createOutputChannel(id, setState, undefined, () => window.close())
    return () => channel.close()
  }, [id])

  usePresenterTheme(state?.display.theme)

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Presenter Screen'
    return () => {
      document.title = previousTitle
    }
  }, [])

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
          reduceMotion ? '' : 'transition-opacity duration-400',
        )}
        {...hoverProps}
      >
        <PresenterFullscreenButton />
      </div>
    </div>
  )
}
