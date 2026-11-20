// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { PanInfo } from 'motion/react'
import { useSheetDrag } from '../../../src/components/ui/useSheetDrag'

const motion = vi.hoisted(() => ({ reduceMotion: false, start: vi.fn() }))

vi.mock('motion/react', () => ({
  useDragControls: () => ({ start: motion.start }),
  useReducedMotion: () => motion.reduceMotion,
}))

const mobileQuery = '(max-width: 639px)'
let mobileMatches = false
let changeListeners: Array<(event: MediaQueryListEvent) => void> = []

function setMobile(matches: boolean) {
  mobileMatches = matches
  for (const listener of changeListeners) listener({ matches } as MediaQueryListEvent)
}

function dragEnd(info: Partial<PanInfo>) {
  return { offset: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, ...info } as PanInfo
}

beforeEach(() => {
  mobileMatches = false
  changeListeners = []
  motion.reduceMotion = false
  motion.start.mockClear()
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === mobileQuery ? mobileMatches : false,
      media: query,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        if (query === mobileQuery) changeListeners.push(listener)
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        changeListeners = changeListeners.filter((current) => current !== listener)
      },
    })),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useSheetDrag', () => {
  it('docks and enables dragging on a phone', () => {
    mobileMatches = true
    const { result } = renderHook(() => useSheetDrag(vi.fn()))

    expect(result.current.isMobile).toBe(true)
    expect(result.current.panelMotion).toMatchObject({
      initial: { opacity: 0, y: '100%' },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: '100%' },
    })
    expect(result.current.dragProps.drag).toBe('y')
    expect(result.current.dragProps.dragListener).toBe(false)
  })

  it('leaves desktop motion to the caller', () => {
    const { result } = renderHook(() => useSheetDrag(vi.fn()))

    expect(result.current.isMobile).toBe(false)
    expect(result.current.panelMotion).toBeNull()
    expect(result.current.dragProps.drag).toBe(false)
  })

  it('follows live viewport changes', () => {
    const { result } = renderHook(() => useSheetDrag(vi.fn()))

    act(() => setMobile(true))

    expect(result.current.isMobile).toBe(true)
    expect(result.current.panelMotion).not.toBeNull()
    expect(result.current.dragProps.drag).toBe('y')
  })

  it('closes when dragged far enough down', () => {
    mobileMatches = true
    const onClose = vi.fn()
    const { result } = renderHook(() => useSheetDrag(onClose))

    act(() => result.current.dragProps.onDragEnd({}, dragEnd({ offset: { x: 0, y: 120 } })))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on a fast downward flick', () => {
    mobileMatches = true
    const onClose = vi.fn()
    const { result } = renderHook(() => useSheetDrag(onClose))

    act(() => result.current.dragProps.onDragEnd({}, dragEnd({ velocity: { x: 0, y: 800 } })))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('stays open for a small, slow drag', () => {
    mobileMatches = true
    const onClose = vi.fn()
    const { result } = renderHook(() => useSheetDrag(onClose))

    act(() =>
      result.current.dragProps.onDragEnd(
        {},
        dragEnd({ offset: { x: 0, y: 80 }, velocity: { x: 0, y: 200 } }),
      ),
    )

    expect(onClose).not.toHaveBeenCalled()
  })

  it('skips dragging with reduced motion', () => {
    mobileMatches = true
    motion.reduceMotion = true
    const { result } = renderHook(() => useSheetDrag(vi.fn()))

    expect(result.current.dragProps.drag).toBe(false)
    expect(result.current.panelMotion).toMatchObject({
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
    })
    expect(result.current.panelMotion).not.toHaveProperty('initial.y')

    act(() => result.current.onPointerDown({} as ReactPointerEvent<HTMLElement>))

    expect(motion.start).not.toHaveBeenCalled()
  })

  it('starts a drag from the handle or header', () => {
    mobileMatches = true
    const { result } = renderHook(() => useSheetDrag(vi.fn()))

    act(() => result.current.onPointerDown({} as ReactPointerEvent<HTMLElement>))

    expect(motion.start).toHaveBeenCalledOnce()
  })
})
