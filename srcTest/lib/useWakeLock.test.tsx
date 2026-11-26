// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWakeLock } from '../../src/lib/useWakeLock'

interface FakeSentinel {
  released: boolean
  release: ReturnType<typeof vi.fn>
}

function createSentinel(): FakeSentinel {
  const sentinel: FakeSentinel = {
    released: false,
    release: vi.fn(async () => {
      sentinel.released = true
    }),
  }
  return sentinel
}

function installWakeLock(request: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
}

let visibilityState: DocumentVisibilityState = 'visible'

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  visibilityState = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibilityState,
  })
})

afterEach(() => {
  cleanup()
  delete (navigator as { wakeLock?: unknown }).wakeLock
  delete (document as { visibilityState?: unknown }).visibilityState
})

describe('useWakeLock', () => {
  it('requests the screen lock when enabled', async () => {
    const sentinel = createSentinel()
    const request = vi.fn(async () => sentinel)
    installWakeLock(request)

    renderHook(() => useWakeLock(true))
    await flush()

    expect(request).toHaveBeenCalledWith('screen')
    expect(sentinel.release).not.toHaveBeenCalled()
  })

  it('does not request the lock when disabled', async () => {
    const request = vi.fn(async () => createSentinel())
    installWakeLock(request)

    renderHook(() => useWakeLock(false))
    await flush()

    expect(request).not.toHaveBeenCalled()
  })

  it('releases the lock on unmount', async () => {
    const sentinel = createSentinel()
    installWakeLock(vi.fn(async () => sentinel))

    const { unmount } = renderHook(() => useWakeLock(true))
    await flush()
    unmount()

    expect(sentinel.release).toHaveBeenCalledTimes(1)
  })

  it('releases the lock when enabled flips to false', async () => {
    const sentinel = createSentinel()
    installWakeLock(vi.fn(async () => sentinel))

    const { rerender } = renderHook(({ enabled }) => useWakeLock(enabled), {
      initialProps: { enabled: true },
    })
    await flush()

    rerender({ enabled: false })

    expect(sentinel.release).toHaveBeenCalledTimes(1)
  })

  it('asks again when the tab becomes visible after the lock was released', async () => {
    const first = createSentinel()
    const second = createSentinel()
    const request = vi.fn(async () => first)
    request.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    installWakeLock(request)

    const { unmount } = renderHook(() => useWakeLock(true))
    await flush()
    expect(request).toHaveBeenCalledTimes(1)

    first.released = true
    visibilityState = 'hidden'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(request).toHaveBeenCalledTimes(1)

    visibilityState = 'visible'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await flush()
    expect(request).toHaveBeenCalledTimes(2)

    unmount()
    expect(second.release).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the browser has no wake lock support', async () => {
    const { unmount } = renderHook(() => useWakeLock(true))
    await flush()

    expect(() => unmount()).not.toThrow()
  })

  it('swallows a refused request', async () => {
    const request = vi.fn(async () => {
      throw new Error('NotAllowedError')
    })
    installWakeLock(request)

    const { unmount } = renderHook(() => useWakeLock(true))
    await flush()

    expect(request).toHaveBeenCalledTimes(1)
    expect(() => unmount()).not.toThrow()
  })

  it('releases a lock that arrives after unmount', async () => {
    let resolveRequest: (sentinel: WakeLockSentinel) => void = () => {}
    const request = vi.fn(
      () =>
        new Promise<WakeLockSentinel>((resolve) => {
          resolveRequest = resolve
        }),
    )
    installWakeLock(request)

    const { unmount } = renderHook(() => useWakeLock(true))
    expect(request).toHaveBeenCalledTimes(1)

    unmount()
    const sentinel = createSentinel()
    resolveRequest(sentinel as unknown as WakeLockSentinel)
    await flush()

    expect(sentinel.release).toHaveBeenCalledTimes(1)
  })
})
