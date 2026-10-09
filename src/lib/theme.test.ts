import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getInitialTheme, applyTheme, saveTheme } from './theme'

describe('theme', () => {
  let mockStorage: Record<string, string>
  let classListSet: Set<string>
  let mockDocument: {
    documentElement: {
      classList: {
        contains: (c: string) => boolean
        add: (c: string) => void
        remove: (c: string) => void
      }
      style: { colorScheme: string }
    }
  }

  beforeEach(() => {
    mockStorage = {}
    classListSet = new Set<string>()

    globalThis.localStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, val: string) => {
        mockStorage[key] = val
      },
      removeItem: (key: string) => {
        delete mockStorage[key]
      },
      clear: () => {
        mockStorage = {}
      },
      key: () => null,
      length: 0,
    }

    mockDocument = {
      documentElement: {
        classList: {
          contains: (c: string) => classListSet.has(c),
          add: (c: string) => classListSet.add(c),
          remove: (c: string) => classListSet.delete(c),
        },
        style: { colorScheme: '' },
      },
    }

    // @ts-expect-error mocking document for node env
    globalThis.document = mockDocument

    const listeners = new Map<string, Set<(e: Event) => void>>()
    globalThis.window = {
      matchMedia: vi.fn(),
      addEventListener: (type: string, cb: unknown) => {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type)!.add(cb as (e: Event) => void)
      },
      removeEventListener: (type: string, cb: unknown) => {
        listeners.get(type)?.delete(cb as (e: Event) => void)
      },
      dispatchEvent: (e: Event) => {
        listeners.get(e.type)?.forEach((cb) => cb(e))
        return true
      },
    } as unknown as Window & typeof globalThis
  })

  it('getInitialTheme defaults to prefers-color-scheme when localStorage is empty', () => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    expect(getInitialTheme()).toBe(true)
  })

  it('getInitialTheme respects stored light theme', () => {
    localStorage.setItem('app_theme', 'light')
    expect(getInitialTheme()).toBe(false)
  })

  it('getInitialTheme respects stored dark theme', () => {
    localStorage.setItem('app_theme', 'dark')
    expect(getInitialTheme()).toBe(true)
  })

  it('applyTheme updates documentElement class and colorScheme', () => {
    applyTheme(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('light')

    applyTheme(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('saveTheme stores value, applies theme, and dispatches event', () => {
    const listener = vi.fn()
    window.addEventListener('app_theme_changed', listener)

    saveTheme(false)
    expect(localStorage.getItem('app_theme')).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(listener).toHaveBeenCalled()

    window.removeEventListener('app_theme_changed', listener)
  })
})
