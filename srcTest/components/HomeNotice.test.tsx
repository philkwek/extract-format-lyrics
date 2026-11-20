// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HomeNotice from '../../src/components/HomeNotice'
import {
  createInstallPromptStore,
  type BeforeInstallPromptEvent,
} from '../../src/lib/installPrompt'

interface FakeWindowOptions {
  userAgent?: string
  platform?: string
  touch?: number
  standalone?: boolean
}

function fakeWindow({
  userAgent = 'Mozilla/5.0 (Windows) Chrome/120',
  platform = 'Win32',
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
  }
}

function installEvent() {
  const event = new Event('beforeinstallprompt') as BeforeInstallPromptEvent
  Object.assign(event, {
    prompt: vi.fn(async () => undefined),
    userChoice: Promise.resolve({ outcome: 'accepted' as const }),
  })
  return event
}

function chromiumStoreWithPrompt() {
  const { win, target } = fakeWindow()
  const store = createInstallPromptStore({ window: win, storage: memoryStorage() })
  store.start()
  target.dispatchEvent(installEvent())
  return store
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.dispatchEvent(new Event('online'))
})

describe('HomeNotice', () => {
  it('installs in one tap on Chromium', async () => {
    const user = userEvent.setup()
    const store = chromiumStoreWithPrompt()
    render(<HomeNotice install={store} />)

    await user.click(screen.getByRole('button', { name: 'Install app' }))
    expect(store.getSnapshot().visible).toBe(false)
  })

  it('shows the iOS steps instead of a dead install button', async () => {
    const user = userEvent.setup()
    const { win } = fakeWindow({
      userAgent: 'Mozilla/5.0 (iPhone) Version/17 Safari',
      platform: 'iPhone',
      touch: 5,
    })
    const store = createInstallPromptStore({ window: win, storage: memoryStorage() })
    render(<HomeNotice install={store} />)

    await user.click(screen.getByRole('button', { name: 'Show me how' }))
    expect(screen.getByText('Add to Home Screen')).toBeTruthy()
  })

  it('leaves the card out once dismissed', () => {
    const store = chromiumStoreWithPrompt()
    store.dismiss()
    render(<HomeNotice install={store} />)
    expect(screen.queryByText('Install Sets & Sheets')).toBeNull()
  })

  it('offline wins over the install offer, even with a prompt ready', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    const store = chromiumStoreWithPrompt()
    render(<HomeNotice install={store} />)

    expect(screen.getByText('You’re currently offline')).toBeTruthy()
    expect(screen.queryByText('Install Sets & Sheets')).toBeNull()
  })

  it('says nothing for a browser with no way to install', () => {
    const { win } = fakeWindow({ userAgent: 'Mozilla/5.0 (X11) Firefox/120', platform: 'Linux' })
    const store = createInstallPromptStore({ window: win, storage: memoryStorage() })
    render(<HomeNotice install={store} />)
    expect(screen.queryByText('Install Sets & Sheets')).toBeNull()
  })
})
