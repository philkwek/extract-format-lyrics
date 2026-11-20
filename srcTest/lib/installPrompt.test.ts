// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  createInstallPromptStore,
  isStandalone,
  platformOf,
  type BeforeInstallPromptEvent,
} from '../../src/lib/installPrompt'

interface FakeWindowOptions {
  userAgent?: string
  platform?: string
  touch?: number
  standalone?: boolean
}

function fakeWindow({
  userAgent = 'Mozilla/5.0 (Macintosh) Chrome/120',
  platform = 'MacIntel',
  touch = 0,
  standalone = false,
}: FakeWindowOptions = {}) {
  const target = new EventTarget()
  const win = {
    navigator: { userAgent, platform, maxTouchPoints: touch },
    matchMedia: (query: string) =>
      ({ matches: standalone && query.includes('standalone') }) as MediaQueryList,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  }
  return { win: win as unknown as Window, target }
}

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  }
}

function installEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt') as BeforeInstallPromptEvent
  Object.assign(event, {
    prompt: vi.fn(async () => undefined),
    userChoice: Promise.resolve({ outcome }),
  })
  return event
}

describe('platformOf', () => {
  it('treats every iOS browser as iOS, since they all run WebKit', () => {
    expect(platformOf('Mozilla/5.0 (iPhone) CriOS/120', 'iPhone', 5)).toBe('ios')
    expect(platformOf('Mozilla/5.0 (Macintosh)', 'MacIntel', 5)).toBe('ios')
  })

  it('knows which desktop engines can start an install', () => {
    expect(platformOf('Mozilla/5.0 (Windows) Chrome/120', 'Win32', 0)).toBe('chromium')
    expect(platformOf('Mozilla/5.0 (Windows) Edg/120', 'Win32', 0)).toBe('chromium')
    expect(platformOf('Mozilla/5.0 (X11) Firefox/120', 'Linux', 0)).toBe('other')
    expect(platformOf('Mozilla/5.0 (Macintosh) Safari/605', 'MacIntel', 0)).toBe('other')
  })
})

describe('isStandalone', () => {
  it('counts display-mode standalone and the iOS navigator flag', () => {
    expect(isStandalone(fakeWindow({ standalone: true }).win)).toBe(true)
    expect(isStandalone(fakeWindow().win)).toBe(false)
    const ios = fakeWindow().win
    Object.defineProperty(ios.navigator, 'standalone', { value: true })
    expect(isStandalone(ios)).toBe(true)
  })
})

describe('install notice store', () => {
  it('appears only once Chromium hands over a prompt', () => {
    const { win, target } = fakeWindow()
    const store = createInstallPromptStore({ window: win, storage: memoryStorage() })
    store.start()

    expect(store.getSnapshot().visible).toBe(false)

    target.dispatchEvent(installEvent())
    expect(store.getSnapshot()).toMatchObject({ visible: true, canPrompt: true })
  })

  it('installs in one tap and hides afterwards', async () => {
    const { win, target } = fakeWindow()
    const store = createInstallPromptStore({ window: win, storage: memoryStorage() })
    store.start()
    const event = installEvent('accepted')
    target.dispatchEvent(event)

    await expect(store.promptInstall()).resolves.toBe('accepted')
    expect(event.prompt).toHaveBeenCalledOnce()
    expect(store.getSnapshot().visible).toBe(false)
  })

  it('offers the steps on iOS, where no prompt event exists', async () => {
    const { win } = fakeWindow({
      userAgent: 'Mozilla/5.0 (iPhone) Version/17 Safari',
      platform: 'iPhone',
      touch: 5,
    })
    const store = createInstallPromptStore({ window: win, storage: memoryStorage() })

    expect(store.getSnapshot()).toMatchObject({ visible: true, canPrompt: false, platform: 'ios' })
    await expect(store.promptInstall()).resolves.toBe('unavailable')
  })

  it('never appears inside the installed app', () => {
    const { win } = fakeWindow({ standalone: true })
    const store = createInstallPromptStore({ window: win, storage: memoryStorage() })
    expect(store.getSnapshot().visible).toBe(false)
  })

  it('remembers a dismiss forever', () => {
    const storage = memoryStorage()
    const first = fakeWindow()
    const store = createInstallPromptStore({ window: first.win, storage })
    store.start()
    first.target.dispatchEvent(installEvent())
    store.dismiss()
    expect(store.getSnapshot().visible).toBe(false)

    const second = fakeWindow()
    const reopened = createInstallPromptStore({ window: second.win, storage })
    reopened.start()
    second.target.dispatchEvent(installEvent())
    expect(reopened.getSnapshot().visible).toBe(false)
  })

  it('hides once the app reports it was installed', () => {
    const { win, target } = fakeWindow()
    const store = createInstallPromptStore({ window: win, storage: memoryStorage() })
    store.start()
    target.dispatchEvent(installEvent())
    target.dispatchEvent(new Event('appinstalled'))
    expect(store.getSnapshot().visible).toBe(false)
  })
})
