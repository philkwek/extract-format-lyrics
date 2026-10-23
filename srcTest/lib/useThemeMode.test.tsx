// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveThemeMode } from '../../src/lib/theme'
import { useThemeMode } from '../../src/lib/useThemeMode'

function installMatchMedia(initialDark: boolean) {
  let isDark = initialDark
  const listeners = new Set<() => void>()
  const query = {
    get matches() {
      return isDark
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener)
    },
    addListener: (listener: () => void) => {
      listeners.add(listener)
    },
    removeListener: (listener: () => void) => {
      listeners.delete(listener)
    },
    dispatchEvent: () => true,
  } as unknown as MediaQueryList

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => query),
  })

  return {
    setDark(value: boolean) {
      isDark = value
      listeners.forEach((listener) => listener())
    },
  }
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  document.documentElement.style.colorScheme = ''
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('useThemeMode', () => {
  it('defaults to system mode and follows device changes', () => {
    const media = installMatchMedia(true)
    const { result } = renderHook(() => useThemeMode())

    expect(result.current.mode).toBe('system')
    expect(result.current.isDark).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    act(() => media.setDark(false))

    expect(result.current.isDark).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('cycles through light, dark, and system modes and persists the selection', () => {
    installMatchMedia(false)
    const { result } = renderHook(() => useThemeMode())

    act(() => result.current.cycleMode())
    expect(result.current.mode).toBe('light')
    expect(localStorage.getItem('app_theme')).toBe('light')
    expect(result.current.isDark).toBe(false)

    act(() => result.current.cycleMode())
    expect(result.current.mode).toBe('dark')
    expect(localStorage.getItem('app_theme')).toBe('dark')
    expect(result.current.isDark).toBe(true)

    act(() => result.current.cycleMode())
    expect(result.current.mode).toBe('system')
    expect(localStorage.getItem('app_theme')).toBe('system')
    expect(result.current.isDark).toBe(false)
  })

  it('ignores device changes after selecting an explicit mode', () => {
    const media = installMatchMedia(false)
    const { result } = renderHook(() => useThemeMode())

    act(() => result.current.setMode('dark'))
    expect(result.current.isDark).toBe(true)

    act(() => media.setDark(false))
    expect(result.current.isDark).toBe(true)
    expect(result.current.mode).toBe('dark')
  })

  it('updates when another theme consumer saves a mode', () => {
    installMatchMedia(false)
    const { result } = renderHook(() => useThemeMode())

    act(() => saveThemeMode('dark'))

    expect(result.current.mode).toBe('dark')
    expect(result.current.isDark).toBe(true)
  })
})
