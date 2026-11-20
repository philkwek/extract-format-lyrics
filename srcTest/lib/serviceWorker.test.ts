// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  registerServiceWorker,
  resetServiceWorker,
  serviceWorkerResetRequested,
} from '../../src/lib/serviceWorker'

interface FakeWorker {
  state: string
  messages: unknown[]
  postMessage(message: unknown): void
  addEventListener(type: string, listener: () => void): void
  finishInstall(): void
}

function fakeWorker(state = 'installing'): FakeWorker {
  const listeners: Array<() => void> = []
  const worker: FakeWorker = {
    state,
    messages: [],
    postMessage: (message) => worker.messages.push(message),
    addEventListener: (_type, listener) => listeners.push(listener),
    finishInstall() {
      worker.state = 'installed'
      for (const listener of listeners) listener()
    },
  }
  return worker
}

function fakeRegistration(installing: FakeWorker | null = null, waiting: FakeWorker | null = null) {
  const listeners: Array<() => void> = []
  return {
    installing,
    waiting,
    active: {},
    update: vi.fn(async () => undefined),
    addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
    emitUpdateFound() {
      for (const listener of listeners) listener()
    },
  }
}

function install(serviceWorker: unknown) {
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker })
}

function uninstall() {
  Reflect.deleteProperty(navigator, 'serviceWorker')
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('registerServiceWorker', () => {
  it('reports a worker left waiting by an earlier visit', async () => {
    const registration = fakeRegistration(null, fakeWorker('installed'))
    install({
      controller: {},
      register: vi.fn(async () => registration),
      addEventListener: vi.fn(),
    })
    const onNeedRefresh = vi.fn()

    registerServiceWorker({ onNeedRefresh })
    await settle()

    expect(onNeedRefresh).toHaveBeenCalledOnce()
    uninstall()
  })

  it('does not prompt on the very first install', async () => {
    const registration = fakeRegistration()
    install({
      controller: null,
      register: vi.fn(async () => registration),
      addEventListener: vi.fn(),
    })
    const onNeedRefresh = vi.fn()

    registerServiceWorker({ onNeedRefresh })
    await settle()

    expect(onNeedRefresh).not.toHaveBeenCalled()
    uninstall()
  })

  it('reports a new worker once it finishes installing behind an open page', async () => {
    const installing = fakeWorker()
    const registration = fakeRegistration(installing)
    install({
      controller: {},
      register: vi.fn(async () => registration),
      addEventListener: vi.fn(),
    })
    const onNeedRefresh = vi.fn()

    registerServiceWorker({ onNeedRefresh })
    await settle()
    registration.emitUpdateFound()
    installing.finishInstall()

    expect(onNeedRefresh).toHaveBeenCalledOnce()
    uninstall()
  })

  it('reports a worker that was already installing when register resolved', async () => {
    const installing = fakeWorker()
    const registration = fakeRegistration(installing)
    install({
      controller: {},
      register: vi.fn(async () => registration),
      addEventListener: vi.fn(),
    })
    const onNeedRefresh = vi.fn()

    registerServiceWorker({ onNeedRefresh })
    await settle()
    installing.finishInstall()

    expect(onNeedRefresh).toHaveBeenCalledOnce()
    uninstall()
  })

  it('asks the waiting worker to take over, then reloads once', async () => {
    const waiting = fakeWorker('installed')
    const registration = fakeRegistration(null, waiting)
    const controllerChange: Array<() => void> = []
    install({
      controller: {},
      register: vi.fn(async () => registration),
      addEventListener: (_type: string, listener: () => void) => controllerChange.push(listener),
    })
    const reload = vi.fn()

    const client = registerServiceWorker({ onNeedRefresh: vi.fn(), reload })
    await settle()
    client?.update()

    expect(waiting.messages).toEqual([{ type: 'SKIP_WAITING' }])
    for (const listener of controllerChange) listener()
    expect(reload).toHaveBeenCalledOnce()
    uninstall()
  })

  it('falls back to a plain reload when nothing is waiting', async () => {
    const registration = fakeRegistration()
    install({
      controller: {},
      register: vi.fn(async () => registration),
      addEventListener: vi.fn(),
    })
    const reload = vi.fn()

    const client = registerServiceWorker({ onNeedRefresh: vi.fn(), reload })
    await settle()
    client?.update()

    expect(reload).toHaveBeenCalledOnce()
    uninstall()
  })

  it('asks the browser to check for a new sw.js', async () => {
    const registration = fakeRegistration()
    install({
      controller: {},
      register: vi.fn(async () => registration),
      addEventListener: vi.fn(),
    })

    const client = registerServiceWorker({ onNeedRefresh: vi.fn() })
    await settle()
    client?.check()

    expect(registration.update).toHaveBeenCalledOnce()
    uninstall()
  })
})

describe('resetServiceWorker', () => {
  it('unregisters every worker and deletes all Cache Storage buckets', async () => {
    const unregisterA = vi.fn(async () => true)
    const unregisterB = vi.fn(async () => true)
    install({
      getRegistrations: vi.fn(async () => [
        { unregister: unregisterA },
        { unregister: unregisterB },
      ]),
    })
    const deleteCache = vi.fn(async () => true)
    vi.stubGlobal('caches', {
      keys: vi.fn(async () => ['workbox-precache-v2', 'pads-v1']),
      delete: deleteCache,
    })

    try {
      await expect(resetServiceWorker()).resolves.toBe(true)
      expect(unregisterA).toHaveBeenCalledOnce()
      expect(unregisterB).toHaveBeenCalledOnce()
      expect(deleteCache).toHaveBeenCalledWith('workbox-precache-v2')
      expect(deleteCache).toHaveBeenCalledWith('pads-v1')
    } finally {
      vi.unstubAllGlobals()
      uninstall()
    }
  })

  it('returns false when service workers are unsupported', async () => {
    uninstall()
    await expect(resetServiceWorker()).resolves.toBe(false)
  })
})

describe('serviceWorkerResetRequested', () => {
  it('matches only ?sw=off', () => {
    expect(serviceWorkerResetRequested('?sw=off')).toBe(true)
    expect(serviceWorkerResetRequested('?foo=1&sw=off')).toBe(true)
    expect(serviceWorkerResetRequested('?sw=on')).toBe(false)
    expect(serviceWorkerResetRequested('')).toBe(false)
  })
})
