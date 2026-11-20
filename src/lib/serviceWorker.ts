export interface ServiceWorkerClient {
  readonly registration: ServiceWorkerRegistration | null
  /** Asks the browser to look for a new sw.js. */
  check(): void
  /** Activates a waiting worker and reloads; falls back to a plain reload. */
  update(): void
}

interface RegisterServiceWorkerOptions {
  onNeedRefresh: () => void
  /** Called when registration fails, so the caller can fall back to the version file. */
  onUnavailable?: () => void
  /** Injected by tests; defaults to reloading the page. */
  reload?: () => void
}

/**
 * Registers the hand-written worker. `onNeedRefresh` fires once when a newer build is waiting
 * behind an open page.
 */
export function registerServiceWorker({
  onNeedRefresh,
  onUnavailable,
  reload = () => window.location.reload(),
}: RegisterServiceWorkerOptions): ServiceWorkerClient | null {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null

  let registration: ServiceWorkerRegistration | null = null
  let announced = false

  const announce = () => {
    if (announced) return
    announced = true
    onNeedRefresh()
  }

  const watchInstalling = (installing: ServiceWorker | null) => {
    if (!installing) return
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) announce()
    })
  }

  void navigator.serviceWorker
    .register('/sw.js')
    .then((reg) => {
      registration = reg
      // A worker left waiting by an earlier visit.
      if (reg.waiting && navigator.serviceWorker.controller) announce()
      watchInstalling(reg.installing)
      reg.addEventListener('updatefound', () => watchInstalling(reg.installing))
    })
    .catch(() => onUnavailable?.())

  return {
    get registration() {
      return registration
    },
    check() {
      void registration?.update().catch(() => undefined)
    },
    update() {
      const waiting = registration?.waiting
      if (!waiting) {
        reload()
        return
      }
      navigator.serviceWorker.addEventListener('controllerchange', () => reload(), { once: true })
      waiting.postMessage({ type: 'SKIP_WAITING' })
    },
  }
}

/** `?sw=off` recovery: drop the worker and its caches, never the person's sets. */
export async function resetServiceWorker(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false
  const registrations = await navigator.serviceWorker.getRegistrations()
  await Promise.all(registrations.map((registration) => registration.unregister()))
  const keys = await caches.keys()
  await Promise.all(keys.map((key) => caches.delete(key)))
  return true
}

/** True when the address bar asked for the recovery switch. */
export function serviceWorkerResetRequested(search: string): boolean {
  return new URLSearchParams(search).get('sw') === 'off'
}
