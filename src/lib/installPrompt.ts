import { useSyncExternalStore } from 'react'
import { isStandalone } from './standalone'

export { isStandalone }

export type InstallPlatform = 'chromium' | 'ios' | 'other'

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'install-notice-dismissed'

/** Chromium is the only engine that lets a page start an install; iOS gets instructions. */
export function platformOf(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
): InstallPlatform {
  const ios = /iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)
  if (ios) return 'ios'
  if (/Firefox|FxiOS/i.test(userAgent)) return 'other'
  return /Chrome|Chromium|Edg\/|EdgA\/|OPR\/|SamsungBrowser/i.test(userAgent) ? 'chromium' : 'other'
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export interface InstallSnapshot {
  /** The notice card should be on screen. */
  visible: boolean
  /** A Chromium install prompt is captured, so one tap can install. */
  canPrompt: boolean
  platform: InstallPlatform
}

export interface InstallPromptStore {
  start(): void
  subscribe(listener: () => void): () => void
  getSnapshot(): InstallSnapshot
  promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'>
  dismiss(): void
}

function wasDismissed(storage: StorageLike | null | undefined): boolean {
  if (!storage) return false
  try {
    return storage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function safeLocalStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function createInstallPromptStore(deps: {
  window: Window
  storage?: StorageLike | null
}): InstallPromptStore {
  const { window: win, storage } = deps
  const platform = platformOf(
    win.navigator.userAgent,
    win.navigator.platform,
    win.navigator.maxTouchPoints,
  )
  const listeners = new Set<() => void>()
  let deferred: BeforeInstallPromptEvent | null = null
  let installed = isStandalone(win)
  let dismissed = wasDismissed(storage)

  const compute = (): InstallSnapshot => {
    const canPrompt = deferred !== null
    return {
      canPrompt,
      platform,
      // A captured prompt is the only honest way to offer one tap. iOS always gets the steps.
      visible: !installed && !dismissed && (canPrompt || platform === 'ios'),
    }
  }
  let snapshot = compute()
  const refresh = () => {
    snapshot = compute()
    for (const listener of listeners) listener()
  }

  const onPrompt = (event: Event) => {
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    refresh()
  }
  const onInstalled = () => {
    installed = true
    deferred = null
    refresh()
  }

  return {
    start() {
      win.addEventListener('beforeinstallprompt', onPrompt)
      win.addEventListener('appinstalled', onInstalled)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    async promptInstall() {
      const event = deferred
      if (!event) return 'unavailable'
      deferred = null
      refresh()
      await event.prompt()
      return (await event.userChoice).outcome
    },
    dismiss() {
      dismissed = true
      try {
        storage?.setItem(DISMISS_KEY, '1')
      } catch {
        // Private mode: the card stays hidden for this page load only.
      }
      refresh()
    },
  }
}

export const installStore = createInstallPromptStore({ window, storage: safeLocalStorage() })

/** Subscribes to the install notice state; starts nothing on its own. */
export function useInstallNotice(store: InstallPromptStore = installStore) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return {
    ...snapshot,
    promptInstall: store.promptInstall,
    dismiss: store.dismiss,
  }
}
