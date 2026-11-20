// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PHONE_LANDSCAPE_QUERY,
  PHONE_PORTRAIT_QUERY,
  useFullScreenLayout,
  useMediaQuery,
} from '../../src/lib/useMediaQuery'

type Listener = () => void

/** A fake matchMedia whose answers can be changed to simulate rotation or resizing. */
function installMatchMedia(initial: Record<string, boolean>) {
  const matches = { ...initial }
  const listeners = new Map<string, Set<Listener>>()
  window.matchMedia = vi.fn((query: string) => ({
    get matches() {
      return matches[query] ?? false
    },
    addEventListener: (_: string, listener: Listener) => {
      if (!listeners.has(query)) listeners.set(query, new Set())
      listeners.get(query)!.add(listener)
    },
    removeEventListener: (_: string, listener: Listener) => listeners.get(query)?.delete(listener),
  })) as unknown as typeof window.matchMedia
  return (query: string, value: boolean) => {
    matches[query] = value
    listeners.get(query)?.forEach((listener) => listener())
  }
}

const originalMatchMedia = window.matchMedia

afterEach(() => {
  cleanup()
  window.matchMedia = originalMatchMedia
})

describe('useMediaQuery', () => {
  it('returns the current match and follows changes', () => {
    const set = installMatchMedia({ '(max-width: 100px)': true })
    const { result } = renderHook(() => useMediaQuery('(max-width: 100px)'))
    expect(result.current).toBe(true)

    act(() => set('(max-width: 100px)', false))
    expect(result.current).toBe(false)
  })

  it('is false when matchMedia is missing', () => {
    // @ts-expect-error simulate an environment without matchMedia
    window.matchMedia = undefined
    const { result } = renderHook(() => useMediaQuery('(max-width: 100px)'))
    expect(result.current).toBe(false)
  })
})

describe('useFullScreenLayout', () => {
  it('picks phone portrait, phone landscape or regular', () => {
    const set = installMatchMedia({ [PHONE_PORTRAIT_QUERY]: true })
    const { result } = renderHook(() => useFullScreenLayout())
    expect(result.current).toBe('phone-portrait')

    act(() => {
      set(PHONE_PORTRAIT_QUERY, false)
      set(PHONE_LANDSCAPE_QUERY, true)
    })
    expect(result.current).toBe('phone-landscape')

    act(() => set(PHONE_LANDSCAPE_QUERY, false))
    expect(result.current).toBe('regular')
  })
})
