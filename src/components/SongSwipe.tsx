import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { reducedMotionTransition, uiSpring } from '../lib/uiMotion'
import { IconButton } from './ui'

export type SwipeDecision = 'prev' | 'next' | 'cancel'

/** Commit a swipe past a third of the sheet, or a quick flick in the same direction. */
// eslint-disable-next-line react-refresh/only-export-components
export function decideSwipe(
  offsetX: number,
  velocityX: number,
  width: number,
  canPrev: boolean,
  canNext: boolean,
): SwipeDecision {
  if (width <= 0) return 'cancel'
  const distance = width / 3
  if (offsetX < 0 && canNext && (Math.abs(offsetX) > distance || velocityX < -500)) return 'next'
  if (offsetX > 0 && canPrev && (offsetX > distance || velocityX > 500)) return 'prev'
  return 'cancel'
}

interface SongSwipeProps {
  /** Changes when the shown song changes; the new page is already at offset 0. */
  contentKey: string | number
  enabled: boolean
  canPrev: boolean
  canNext: boolean
  prevTitle: string
  nextTitle: string
  onPrev: () => void
  onNext: () => void
  /** The track: pages absolutely positioned at -100%, 0 and +100%. */
  children: ReactNode
}

interface SwipeGesture {
  pointerId: number
  startX: number
  startY: number
  baseX: number
  horizontal: boolean
  samples: Array<{ x: number; time: number }>
}

const HINT_KEY = 'sets_swipe_hint_count'
const HINT_LIMIT = 3
const HINT_VISIBLE_MS = 2500
const DIRECTION_LOCK_PX = 10
const EDGE_RESISTANCE = 0.3
const SAMPLE_LIMIT = 6

// Time-based springs drop inherited velocity, so the release handoff uses physics springs.
// Critically damped with a loose rest test: the incoming page is already at offset 0, so
// the commit can happen at the end of the slide without waiting for a sub-pixel settle.
const slideSpring = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 41,
  mass: 1,
  restDelta: 2,
  restSpeed: 40,
}
const settleSpring = { type: 'spring' as const, stiffness: 380, damping: 39, mass: 1 }

function isHorizontalScroller(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false
  if (element.scrollWidth <= element.clientWidth) return false
  const overflowX = window.getComputedStyle(element).overflowX
  return overflowX === 'auto' || overflowX === 'scroll'
}

function startsInHorizontalScroller(target: EventTarget | null, boundary: HTMLElement): boolean {
  let node = target instanceof Element ? target : null
  while (node) {
    if (isHorizontalScroller(node)) return true
    if (node === boundary) return false
    node = node.parentElement
  }
  return false
}

function releaseVelocity(samples: SwipeGesture['samples']): number {
  if (samples.length < 2) return 0
  const last = samples[samples.length - 1]
  const first = samples[Math.max(0, samples.length - 5)]
  const elapsed = last.time - first.time
  if (elapsed <= 0) return 0
  return ((last.x - first.x) / elapsed) * 1000
}

/** Adds resistance when there is no song in the swipe direction. */
function resisted(offset: number, canPrev: boolean, canNext: boolean): number {
  if (offset > 0 && !canPrev) return offset * EDGE_RESISTANCE
  if (offset < 0 && !canNext) return offset * EDGE_RESISTANCE
  return offset
}

export default function SongSwipe({
  contentKey,
  enabled,
  canPrev,
  canNext,
  prevTitle,
  nextTitle,
  onPrev,
  onNext,
  children,
}: SongSwipeProps) {
  const reduceMotion = Boolean(useReducedMotion())
  const rootRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<SwipeGesture | null>(null)
  const widthRef = useRef(0)
  const generationRef = useRef(0)
  const latestRef = useRef({ canPrev, canNext, onPrev, onNext })
  const x = useMotionValue(0)
  const opacity = useMotionValue(1)
  const [dragging, setDragging] = useState(false)
  const [showHint, setShowHint] = useState(false)

  useEffect(() => {
    latestRef.current = { canPrev, canNext, onPrev, onNext }
  })

  // Stop a half-finished slide when the page leaves full screen.
  useEffect(() => {
    if (enabled) return
    gestureRef.current = null
    x.stop()
    opacity.stop()
    x.set(0)
    opacity.set(1)
    const reset = window.setTimeout(() => {
      setDragging(false)
      setShowHint(false)
    }, 0)
    return () => window.clearTimeout(reset)
  }, [enabled, opacity, x])

  useEffect(() => {
    if (!enabled) return
    let count = 0
    try {
      count = Number(localStorage.getItem(HINT_KEY) ?? '0') || 0
    } catch {
      // Ignore storage failures; the hint is optional.
    }
    try {
      localStorage.setItem(HINT_KEY, String(count + 1))
    } catch {
      // Ignore storage failures; the hint is optional.
    }
    if (count >= HINT_LIMIT || !latestRef.current.canNext) return
    setShowHint(true)
    const timer = window.setTimeout(() => setShowHint(false), HINT_VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [enabled])

  useEffect(
    () => () => {
      x.stop()
      opacity.stop()
    },
    [opacity, x],
  )

  // The offsets shifted in this same commit, so putting the track back at 0
  // swaps the incoming page into place before the browser paints.
  useLayoutEffect(() => {
    generationRef.current += 1
    x.stop()
    x.set(0)
    gestureRef.current = null
    if (opacity.get() < 1) {
      opacity.stop()
      animate(opacity, 1, reduceMotion ? reducedMotionTransition : uiSpring)
    }
  }, [contentKey, opacity, reduceMotion, x])

  const settle = (velocity: number) => {
    generationRef.current += 1
    x.stop()
    opacity.stop()
    if (x.get() !== 0) animate(x, 0, { ...settleSpring, velocity })
    if (opacity.get() < 1) animate(opacity, 1, uiSpring)
  }

  const crossFade = (direction: Exclude<SwipeDecision, 'cancel'>) => {
    generationRef.current += 1
    const generation = generationRef.current
    opacity.stop()
    animate(opacity, 0, reducedMotionTransition).then(() => {
      if (generationRef.current !== generation) return
      if (direction === 'next') latestRef.current.onNext()
      else latestRef.current.onPrev()
      animate(opacity, 1, reducedMotionTransition)
    })
  }

  const slide = (direction: Exclude<SwipeDecision, 'cancel'>, width: number, velocity: number) => {
    generationRef.current += 1
    const generation = generationRef.current
    x.stop()
    opacity.stop()
    const outX = direction === 'next' ? -width : width
    animate(x, outX, { ...slideSpring, velocity }).then(() => {
      if (generationRef.current !== generation) return
      // The neighbour is already laid out and fills the viewport at this offset.
      if (direction === 'next') latestRef.current.onNext()
      else latestRef.current.onPrev()
    })
  }

  const runDecision = (direction: SwipeDecision, width: number, velocity: number) => {
    if (direction === 'cancel') {
      if (!reduceMotion) settle(velocity)
      return
    }
    if (reduceMotion) crossFade(direction)
    else slide(direction, width, velocity)
  }

  const goTo = (direction: Exclude<SwipeDecision, 'cancel'>) => {
    if (direction === 'prev' && !latestRef.current.canPrev) return
    if (direction === 'next' && !latestRef.current.canNext) return
    const width = widthRef.current || rootRef.current?.clientWidth || window.innerWidth || 1
    runDecision(direction, width, 0)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || event.pointerType !== 'touch' || event.isPrimary === false) return
    if (gestureRef.current) return
    if (startsInHorizontalScroller(event.target, event.currentTarget)) return
    widthRef.current = rootRef.current?.clientWidth ?? 0
    // A new touch takes over whatever is on screen, so the track never jumps.
    generationRef.current += 1
    if (!reduceMotion) {
      x.stop()
      opacity.stop()
    }
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: x.get(),
      horizontal: false,
      samples: [{ x: event.clientX, time: event.timeStamp || performance.now() }],
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const dx = event.clientX - gesture.startX
    const dy = event.clientY - gesture.startY

    if (!gesture.horizontal) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DIRECTION_LOCK_PX) return
      if (Math.abs(dy) >= Math.abs(dx)) {
        gestureRef.current = null
        if (!reduceMotion) settle(0)
        return
      }
      gesture.horizontal = true
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Older browsers without pointer capture still get the pointer events.
      }
      setDragging(true)
    }

    if (!reduceMotion) {
      const target = gesture.baseX + dx
      const next =
        gesture.baseX +
        resisted(target, latestRef.current.canPrev, latestRef.current.canNext) -
        resisted(gesture.baseX, latestRef.current.canPrev, latestRef.current.canNext)
      x.set(next)
    }
    gesture.samples.push({ x: event.clientX, time: event.timeStamp || performance.now() })
    if (gesture.samples.length > SAMPLE_LIMIT) gesture.samples.shift()
  }

  const finishGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture) {
      // A commit may have cleared the gesture mid-drag; the finger can still lift.
      setDragging(false)
      return
    }
    if (gesture.pointerId !== event.pointerId) return
    gestureRef.current = null
    setDragging(false)
    if (!gesture.horizontal) {
      if (!reduceMotion) settle(0)
      return
    }
    gesture.samples.push({ x: event.clientX, time: event.timeStamp || performance.now() })
    if (gesture.samples.length > SAMPLE_LIMIT) gesture.samples.shift()
    const velocity = releaseVelocity(gesture.samples)
    const width = widthRef.current || rootRef.current?.clientWidth || window.innerWidth || 1
    const offset = reduceMotion ? event.clientX - gesture.startX : x.get()
    const direction = decideSwipe(
      offset,
      velocity,
      width,
      latestRef.current.canPrev,
      latestRef.current.canNext,
    )
    runDecision(direction, width, velocity)
  }

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture) {
      setDragging(false)
      return
    }
    if (gesture.pointerId !== event.pointerId) return
    gestureRef.current = null
    setDragging(false)
    if (!reduceMotion) settle(0)
  }

  // Keep the same wrapper when switched off so the sheet inside never remounts.
  if (!enabled) {
    return (
      <div ref={rootRef} className="contents">
        <motion.div className="contents">{children}</motion.div>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className="relative flex min-h-0 flex-1 touch-pan-y flex-col overflow-hidden"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishGesture}
      onPointerCancel={handlePointerCancel}
    >
      <motion.div
        data-song-track
        className="relative min-h-0 flex-1 will-change-transform"
        style={{ x, opacity }}
      >
        {children}
      </motion.div>

      <AnimatePresence>
        {showHint && canNext && !dragging && (
          <motion.div
            key="swipe-hint"
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 6 }}
            transition={reduceMotion ? reducedMotionTransition : uiSpring}
            style={{ y: '-50%' }}
            className="pointer-events-none fixed right-14 top-1/2 z-20 max-w-[11rem] truncate rounded-full border border-ui-border bg-ui-surface-raised px-2.5 py-1 text-[11px] font-semibold text-ui-text shadow-sm"
          >
            {nextTitle}
          </motion.div>
        )}
      </AnimatePresence>

      {canPrev && (
        <div className="fixed left-1 top-1/2 z-20 -mt-[1.375rem]">
          <IconButton
            label={`Previous song: ${prevTitle}`}
            variant="ghost"
            style={{ width: 44, height: 44 }}
            className="text-ui-text-muted opacity-60 hover:opacity-100 focus-visible:opacity-100"
            onClick={() => goTo('prev')}
          >
            <ChevronLeft size={22} aria-hidden="true" />
          </IconButton>
        </div>
      )}

      {canNext && (
        <div className="fixed right-1 top-1/2 z-20 -mt-[1.375rem]">
          <IconButton
            label={`Next song: ${nextTitle}`}
            variant="ghost"
            style={{ width: 44, height: 44 }}
            className="text-ui-text-muted opacity-60 hover:opacity-100 focus-visible:opacity-100"
            onClick={() => goTo('next')}
          >
            <ChevronRight size={22} aria-hidden="true" />
          </IconButton>
        </div>
      )}
    </div>
  )
}
