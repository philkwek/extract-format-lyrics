import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCurrentSongSender,
  CURRENT_SONG_DEBOUNCE_MS,
  type CurrentSongSenderDeps,
} from '../../src/lib/presenterCurrent'

const identity = {
  publicationId: 'pub-1',
  secret: 'secret-1',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
}

function makeSender(overrides: Partial<CurrentSongSenderDeps> = {}) {
  const getIdentity = vi.fn<CurrentSongSenderDeps['getIdentity']>(async () => identity)
  const api = vi.fn<CurrentSongSenderDeps['api']>(async () => {})
  const sender = createCurrentSongSender({
    getIdentity,
    api,
    now: () => Date.now(),
    ...overrides,
  })
  return { sender, getIdentity, api }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('currentSongSender', () => {
  it('debounces and sends only the latest entry', async () => {
    const { sender, api } = makeSender()

    sender.notify('session-1', 'entry-1')
    await vi.advanceTimersByTimeAsync(CURRENT_SONG_DEBOUNCE_MS - 100)
    sender.notify('session-1', 'entry-2')
    await vi.advanceTimersByTimeAsync(CURRENT_SONG_DEBOUNCE_MS - 1)

    expect(api).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(api).toHaveBeenCalledTimes(1)
    expect(api).toHaveBeenCalledWith('pub-1', 'secret-1', 'entry-2')
  })

  it('sends nothing without an identity', async () => {
    const { sender, api } = makeSender({
      getIdentity: vi.fn(async () => null),
    })

    sender.notify('session-1', 'entry-1')
    await vi.advanceTimersByTimeAsync(CURRENT_SONG_DEBOUNCE_MS)

    expect(api).not.toHaveBeenCalled()
  })

  it('sends nothing when the identity has expired', async () => {
    const { sender, api } = makeSender({
      getIdentity: vi.fn(async () => ({
        ...identity,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      })),
    })

    sender.notify('session-1', 'entry-1')
    await vi.advanceTimersByTimeAsync(CURRENT_SONG_DEBOUNCE_MS)

    expect(api).not.toHaveBeenCalled()
  })

  it('does not send the same entry again', async () => {
    const { sender, api } = makeSender()

    sender.notify('session-1', 'entry-1')
    await vi.advanceTimersByTimeAsync(CURRENT_SONG_DEBOUNCE_MS)
    expect(api).toHaveBeenCalledTimes(1)

    sender.notify('session-1', 'entry-1')
    await vi.advanceTimersByTimeAsync(CURRENT_SONG_DEBOUNCE_MS)

    expect(api).toHaveBeenCalledTimes(1)
  })

  it('resend sends the last requested entry again', async () => {
    const { sender, api } = makeSender()

    sender.notify('session-1', 'entry-1')
    await vi.advanceTimersByTimeAsync(CURRENT_SONG_DEBOUNCE_MS)
    expect(api).toHaveBeenCalledTimes(1)

    sender.resend('session-1')
    await vi.advanceTimersByTimeAsync(CURRENT_SONG_DEBOUNCE_MS)

    expect(api).toHaveBeenCalledTimes(2)
    expect(api).toHaveBeenLastCalledWith('pub-1', 'secret-1', 'entry-1')
  })

  it('swallows api errors and retries once', async () => {
    const api = vi
      .fn<CurrentSongSenderDeps['api']>()
      .mockRejectedValueOnce(new Error('Network down'))
      .mockResolvedValue(undefined)
    const { sender } = makeSender({ api })

    expect(() => sender.notify('session-1', 'entry-1')).not.toThrow()
    await vi.advanceTimersByTimeAsync(CURRENT_SONG_DEBOUNCE_MS)
    expect(api).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)
    expect(api).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(api).toHaveBeenCalledTimes(2)
  })
})
