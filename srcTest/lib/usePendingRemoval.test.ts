// @vitest-environment jsdom
import { StrictMode, createElement, type ReactNode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNDO_WINDOW_MS, usePendingRemoval } from '../../src/lib/usePendingRemoval'

describe('usePendingRemoval', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  const payload = { id: 'a' }

  it('commits at 5000 ms', async () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() => usePendingRemoval({ onCommit }))

    act(() => result.current.start(payload))
    expect(result.current.pending).toEqual(payload)

    await act(async () => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS - 100)
    })
    expect(onCommit).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    expect(onCommit).toHaveBeenCalledWith(payload)
    expect(result.current.pending).toBeNull()
  })

  it('undo cancels the write', async () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() => usePendingRemoval({ onCommit }))

    act(() => result.current.start(payload))
    act(() => result.current.undo())
    expect(result.current.pending).toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS * 2)
    })
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits the previous removal when a second one starts', async () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() => usePendingRemoval({ onCommit }))
    const second = { id: 'b' }

    act(() => result.current.start(payload))
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await act(async () => {
      result.current.start(second)
    })
    expect(onCommit).toHaveBeenCalledWith(payload)
    expect(result.current.pending).toEqual(second)

    await act(async () => {
      vi.advanceTimersByTime(4000)
    })
    expect(onCommit).not.toHaveBeenCalledWith(second)

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(onCommit).toHaveBeenCalledWith(second)
  })

  it('reports a failed commit so the item can come back', async () => {
    const onCommit = vi.fn().mockRejectedValue(new Error('offline'))
    const onError = vi.fn()
    const { result } = renderHook(() => usePendingRemoval({ onCommit, onError }))

    act(() => result.current.start(payload))
    await act(async () => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS)
    })

    expect(onError).toHaveBeenCalledWith(payload)
    expect(result.current.pending).toBeNull()
  })

  it('unmount commits', async () => {
    const onCommit = vi.fn()
    const { result, unmount } = renderHook(() => usePendingRemoval({ onCommit }))

    act(() => result.current.start(payload))
    unmount()
    expect(onCommit).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(0)
    })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(payload)
  })

  it('StrictMode remount does not commit', async () => {
    const onCommit = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(StrictMode, null, children)
    const { result } = renderHook(() => usePendingRemoval({ onCommit }), { wrapper })

    act(() => result.current.start(payload))
    await act(async () => {
      vi.advanceTimersByTime(0)
    })

    expect(onCommit).not.toHaveBeenCalled()
    expect(result.current.pending).toEqual(payload)
  })
})
