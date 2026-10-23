import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  THEME_CHANGED_EVENT,
  applyTheme,
  getInitialThemeMode,
  nextThemeMode,
  resolveThemeIsDark,
  saveThemeMode,
  watchSystemTheme,
  type ThemeChangedDetail,
} from '../../src/lib/theme'

interface MockMediaQueryList extends MediaQueryList {
  trigger: (matches: boolean) => void
}

function createMediaQueryList(initialMatches: boolean): MockMediaQueryList {
  let matches = initialMatches
  const listeners = new Set<() => void>()
  const query = {
    get matches() {
      return matches
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
    trigger: (value: boolean) => {
      matches = value
      listeners.forEach((listener) => listener())
    },
  }
  return query as unknown as MockMediaQueryList
}

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
  let mediaQuery: MockMediaQueryList

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

    mediaQuery = createMediaQueryList(false)

    const listeners = new Map<string, Set<(e: Event) => void>>()
    globalThis.window = {
      matchMedia: vi.fn(() => mediaQuery),
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

  it('defaults to matching the device when no preference is stored', () => {
    expect(getInitialThemeMode()).toBe('system')
  })

  it('reads and validates a stored theme mode', () => {
    localStorage.setItem('app_theme', 'light')
    expect(getInitialThemeMode()).toBe('light')

    localStorage.setItem('app_theme', 'dark')
    expect(getInitialThemeMode()).toBe('dark')

    localStorage.setItem('app_theme', 'system')
    expect(getInitialThemeMode()).toBe('system')

    localStorage.setItem('app_theme', 'sepia')
    expect(getInitialThemeMode()).toBe('system')
  })

  it('resolves explicit modes directly and follows the device for system', () => {
    expect(resolveThemeIsDark('light')).toBe(false)
    expect(resolveThemeIsDark('dark')).toBe(true)

    mediaQuery.trigger(true)
    expect(resolveThemeIsDark('system')).toBe(true)

    mediaQuery.trigger(false)
    expect(resolveThemeIsDark('system')).toBe(false)
  })

  it('cycles light, dark, and system modes', () => {
    expect(nextThemeMode('light')).toBe('dark')
    expect(nextThemeMode('dark')).toBe('system')
    expect(nextThemeMode('system')).toBe('light')
  })

  it('applyTheme updates documentElement class and colorScheme', () => {
    applyTheme(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('light')

    applyTheme(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('saveThemeMode stores the mode, applies it, and dispatches the resolved theme', () => {
    const listener = vi.fn()
    window.addEventListener(THEME_CHANGED_EVENT, listener)

    mediaQuery.trigger(true)
    saveThemeMode('system')

    expect(localStorage.getItem('app_theme')).toBe('system')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    const event = listener.mock.calls[0][0] as CustomEvent<ThemeChangedDetail>
    expect(event.detail).toEqual({ mode: 'system', isDark: true })

    window.removeEventListener(THEME_CHANGED_EVENT, listener)
  })

  it('watchSystemTheme reports device changes until unsubscribed', () => {
    const onChange = vi.fn()
    const unsubscribe = watchSystemTheme(onChange)

    mediaQuery.trigger(true)
    expect(onChange).toHaveBeenLastCalledWith(true)

    mediaQuery.trigger(false)
    expect(onChange).toHaveBeenLastCalledWith(false)

    unsubscribe()
    mediaQuery.trigger(true)
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})
