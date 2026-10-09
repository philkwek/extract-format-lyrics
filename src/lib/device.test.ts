import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isMobileOrTablet } from './device'

describe('isMobileOrTablet', () => {
  const originalWindow = globalThis.window
  const originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  const setNavigator = (nav: Partial<Navigator>) => {
    Object.defineProperty(globalThis, 'navigator', {
      value: nav,
      configurable: true,
      writable: true,
    })
  }

  beforeEach(() => {
    globalThis.window = {
      matchMedia: vi.fn().mockReturnValue({ matches: false }),
    } as unknown as Window & typeof globalThis
  })

  afterEach(() => {
    globalThis.window = originalWindow
    if (originalNavigatorDesc) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDesc)
    }
  })

  it('returns false when window is undefined (SSR / non-browser)', () => {
    // @ts-expect-error simulating non-browser environment
    delete globalThis.window
    expect(isMobileOrTablet()).toBe(false)
  })

  it('detects modern iPad with MacIntel platform and maxTouchPoints > 1', () => {
    setNavigator({
      platform: 'MacIntel',
      maxTouchPoints: 5,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    })

    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(pointer: coarse)',
    }))

    expect(isMobileOrTablet()).toBe(true)
  })

  it('detects iPhone via user agent', () => {
    setNavigator({
      platform: 'iPhone',
      maxTouchPoints: 5,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    })

    expect(isMobileOrTablet()).toBe(true)
  })

  it('detects Android phone / tablet via user agent', () => {
    setNavigator({
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    })

    expect(isMobileOrTablet()).toBe(true)
  })

  it('detects touchscreen device with coarse pointer and touch points', () => {
    setNavigator({
      platform: 'Other',
      maxTouchPoints: 10,
      userAgent: 'CustomBrowser',
    })

    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(pointer: coarse)',
    }))

    expect(isMobileOrTablet()).toBe(true)
  })

  it('returns false for desktop Mac with physical keyboard/mouse', () => {
    setNavigator({
      platform: 'MacIntel',
      maxTouchPoints: 0,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })

    window.matchMedia = vi.fn().mockReturnValue({ matches: false })

    expect(isMobileOrTablet()).toBe(false)
  })

  it('returns false for desktop Windows PC', () => {
    setNavigator({
      platform: 'Win32',
      maxTouchPoints: 0,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })

    window.matchMedia = vi.fn().mockReturnValue({ matches: false })

    expect(isMobileOrTablet()).toBe(false)
  })
})
