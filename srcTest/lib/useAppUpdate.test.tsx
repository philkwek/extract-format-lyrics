// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppUpdate } from '../../src/lib/useAppUpdate'

const ANSWER_DELAY = 30_000
const HOUR = 60 * 60 * 1000

function versionResponse(entry: string | null) {
  return Promise.resolve({
    ok: entry !== null,
    json: async () => (entry === null ? {} : { entry }),
  } as Response)
}

async function pass(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useAppUpdate', () => {
  it('waits for the page to settle, then prompts for a different build', async () => {
    const fetchMock = vi.fn(() => versionResponse('index-new.js'))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAppUpdate(true))

    expect(result.current.updateAvailable).toBe(false)
    await pass(ANSWER_DELAY - 1)
    expect(fetchMock).not.toHaveBeenCalled()

    await pass(1)
    expect(result.current.updateAvailable).toBe(true)
  })

  it('says nothing when the deployed build is the one running', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => versionResponse('appUpdate.ts')),
    )
    const { result } = renderHook(() => useAppUpdate(true))

    await pass(ANSWER_DELAY)
    expect(result.current.updateAvailable).toBe(false)
  })

  it('keeps the prompt when the next check cannot reach the server', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => versionResponse('index-new.js'))
      .mockImplementation(() => versionResponse(null))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAppUpdate(true))

    await pass(ANSWER_DELAY)
    expect(result.current.updateAvailable).toBe(true)

    await pass(HOUR)
    expect(result.current.updateAvailable).toBe(true)
  })

  it('stays quiet while dismissed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => versionResponse('index-new.js')),
    )
    const { result } = renderHook(() => useAppUpdate(true))

    await pass(ANSWER_DELAY)
    expect(result.current.updateAvailable).toBe(true)

    act(() => result.current.dismiss())
    expect(result.current.updateAvailable).toBe(false)
  })

  it('does nothing when disabled, as in a dev server without a build stamp', async () => {
    const fetchMock = vi.fn(() => versionResponse('index-new.js'))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAppUpdate(false))

    await pass(HOUR)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.updateAvailable).toBe(false)
  })

  it('asks the service worker for updates instead of polling the version file', async () => {
    const registration = {
      installing: null,
      waiting: null,
      active: {},
      update: vi.fn(async () => undefined),
      addEventListener: vi.fn(),
    }
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: {},
        register: vi.fn(async () => registration),
        addEventListener: vi.fn(),
      },
    })
    const fetchMock = vi.fn(() => versionResponse('index-new.js'))
    vi.stubGlobal('fetch', fetchMock)

    try {
      renderHook(() => useAppUpdate(true))
      await pass(ANSWER_DELAY)

      expect(registration.update).toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(navigator, 'serviceWorker')
    }
  })
})
