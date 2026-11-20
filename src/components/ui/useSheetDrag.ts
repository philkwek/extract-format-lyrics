import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useDragControls, useReducedMotion, type PanInfo } from 'motion/react'
import { momentumSpring, reducedMotionTransition } from '../../lib/uiMotion'

const mobileQuery = '(max-width: 639px)'

export function useSheetDrag(onClose: () => void) {
  const reduceMotion = useReducedMotion()
  const dragControls = useDragControls()
  const [isMobile, setIsMobile] = useState(() => window.matchMedia?.(mobileQuery)?.matches ?? false)

  useEffect(() => {
    const query = window.matchMedia?.(mobileQuery)
    if (!query) return
    const update = (event: MediaQueryListEvent) => setIsMobile(event.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  const canDrag = isMobile && !reduceMotion

  // Null on desktop so each caller keeps its own dialog motion.
  const panelMotion = isMobile
    ? {
        initial: reduceMotion ? { opacity: 0 } : { opacity: 0, y: '100%' },
        animate: reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 },
        exit: reduceMotion ? { opacity: 0 } : { opacity: 0, y: '100%' },
        transition: reduceMotion ? reducedMotionTransition : momentumSpring,
      }
    : null

  const dragProps = {
    drag: canDrag ? ('y' as const) : false,
    dragListener: false,
    dragControls,
    dragConstraints: { top: 0, bottom: 0 },
    dragElastic: { top: 0, bottom: 0.34 },
    onDragEnd: (_event: unknown, info: PanInfo) => {
      if (info.offset.y > 110 || info.velocity.y > 700) onClose()
    },
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (canDrag) dragControls.start(event)
  }

  return { isMobile, panelMotion, dragProps, onPointerDown }
}
