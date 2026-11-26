import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ShareApiError, type GetSharedLyricsResult } from '../../src/lib/api'
import type { LyricsLiveSummary } from '../../src/lib/lyricsLive'
import {
  createPresenterFeed,
  type PresenterFeedDeps,
  type PresenterFeedState,
} from '../../src/lib/usePresenterFeed'
import type { SharedLyricsPayload } from '../../src/types/song'

function payload(name: string): SharedLyricsPayload {
  return { v: 1, name, songs: [] }
}

function response(name: string, currentEntryId: string | null = null): GetSharedLyricsResult {
  return { id: 'pub', lyrics: payload(name), expiresAt: '', currentEntryId }
}

function missing(): ShareApiError {
  return new ShareApiError('This lyrics link has gone', undefined, 404)
}

type GetLyricsMock = Mock<(id: string) => Promise<GetSharedLyricsResult>>

function setup(configure: (getLyrics: GetLyricsMock) => void = () => {}, hasFirestore = true) {
  const states: PresenterFeedState[] = []
  const getLyrics: GetLyricsMock = vi.fn(async () => response('one'))
  configure(getLyrics)

  const unsubscribe = vi.fn()
  let onUpdate: (summary: LyricsLiveSummary) => void = () => {}
  let onError: (error: unknown) => void = () => {}
  const subscribe = vi.fn(
    (
      _id: string,
      handlers: {
        onUpdate: (summary: LyricsLiveSummary) => void
        onError: (error: unknown) => void
      },
    ) => {
      onUpdate = handlers.onUpdate
      onError = handlers.onError
      return unsubscribe
    },
  )
  const listeners = new Map<'online' | 'offline', Set<() => void>>()
  const deps: PresenterFeedDeps = {
    getLyrics,
    subscribe,
    hasFirestore: () => hasFirestore,
    setInterval: (handler, ms) => setInterval(handler, ms),
    clearInterval: (handle) => clearInterval(handle),
    setTimeout: (handler, ms) => setTimeout(handler, ms),
    clearTimeout: (handle) => clearTimeout(handle),
    addWindowListener: (type, handler) => {
      const handlers = listeners.get(type) ?? new Set()
      handlers.add(handler)
      listeners.set(type, handlers)
      return () => handlers.delete(handler)
    },
  }
  const stop = createPresenterFeed('pub', deps, (state) => states.push(state))
  return {
    states,
    getLyrics,
    subscribe,
    unsubscribe,
    stop,
    last: () => states[states.length - 1],
    update: (summary: LyricsLiveSummary) => onUpdate(summary),
    fail: (error: unknown) => onError(error),
    trigger: (type: 'online' | 'offline') => listeners.get(type)?.forEach((handler) => handler()),
    listenerCount: (type: 'online' | 'offline') => listeners.get(type)?.size ?? 0,
  }
}

const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createPresenterFeed', () => {
  it('starts loading, then shows the first load', async () => {
    const feed = setup((getLyrics) => {
      getLyrics.mockResolvedValue(response('one', 'entry_1'))
    })

    expect(feed.states[0]).toEqual({
      status: 'loading',
      lyrics: null,
      currentEntryId: null,
    })
    await settle()

    expect(feed.getLyrics).toHaveBeenCalledWith('pub')
    expect(feed.last()).toEqual({
      status: 'live',
      lyrics: payload('one'),
      currentEntryId: 'entry_1',
    })
    feed.stop()
  })

  it('reports a missing publication on a 404 first load and does not retry', async () => {
    const feed = setup((getLyrics) => {
      getLyrics.mockRejectedValue(missing())
    })
    await settle()

    expect(feed.last()).toMatchObject({ status: 'missing', lyrics: null })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(feed.getLyrics).toHaveBeenCalledTimes(1)
    feed.stop()
  })

  it('keeps last lyrics when the first load is a network error, retrying after ten seconds', async () => {
    const feed = setup((getLyrics) => {
      getLyrics.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response('one'))
    })

    await settle()
    expect(feed.last()).toMatchObject({ status: 'lost', lyrics: null })

    await vi.advanceTimersByTimeAsync(10_000)
    expect(feed.getLyrics).toHaveBeenCalledTimes(2)
    expect(feed.last()).toMatchObject({ status: 'live', lyrics: payload('one') })
    feed.stop()
  })

  it('records the first revision without refetching, and refetches on a later one', async () => {
    const feed = setup((getLyrics) => {
      getLyrics
        .mockResolvedValueOnce(response('one', 'entry_1'))
        .mockResolvedValueOnce(response('two', 'entry_1'))
    })
    await settle()

    feed.update({ rev: 'rev-1', currentEntryId: 'entry_1' })
    await settle()
    expect(feed.getLyrics).toHaveBeenCalledTimes(1)

    feed.update({ rev: 'rev-2', currentEntryId: 'entry_1' })
    await settle()
    expect(feed.getLyrics).toHaveBeenCalledTimes(2)
    expect(feed.last()).toMatchObject({ status: 'live', lyrics: payload('two') })
    feed.stop()
  })

  it('changes only the current song when the revision stays the same', async () => {
    const feed = setup()
    await settle()

    feed.update({ rev: 'rev-1', currentEntryId: 'entry_1' })
    feed.update({ rev: 'rev-1', currentEntryId: 'entry_2' })
    await settle()

    expect(feed.getLyrics).toHaveBeenCalledTimes(1)
    expect(feed.last()).toMatchObject({ status: 'live', currentEntryId: 'entry_2' })
    feed.stop()
  })

  it('stops when the document is deleted', async () => {
    const feed = setup()
    await settle()

    feed.update({ rev: null, currentEntryId: null })

    expect(feed.last()).toEqual({
      status: 'stopped',
      lyrics: null,
      currentEntryId: null,
    })
    feed.stop()
  })

  it('polls at once after a listener error and stays live while the API works', async () => {
    const feed = setup((getLyrics) => {
      getLyrics
        .mockResolvedValueOnce(response('one'))
        .mockResolvedValueOnce(response('two', 'entry_2'))
        .mockResolvedValueOnce(response('three', 'entry_3'))
    })
    await settle()

    feed.fail(new Error('listener down'))
    await settle()
    expect(feed.getLyrics).toHaveBeenCalledTimes(2)
    expect(feed.states.some((state) => state.status === 'lost')).toBe(false)
    expect(feed.last()).toEqual({
      status: 'live',
      lyrics: payload('two'),
      currentEntryId: 'entry_2',
    })

    await vi.advanceTimersByTimeAsync(30_000)
    expect(feed.getLyrics).toHaveBeenCalledTimes(3)
    expect(feed.last()).toMatchObject({ status: 'live', currentEntryId: 'entry_3' })
    feed.stop()
  })

  it('shows lost connection when the poll after a listener error fails', async () => {
    const feed = setup((getLyrics) => {
      getLyrics
        .mockResolvedValueOnce(response('one'))
        .mockRejectedValueOnce(new TypeError('offline'))
    })
    await settle()

    feed.fail(new Error('listener down'))
    await settle()
    expect(feed.last()).toMatchObject({ status: 'lost', lyrics: payload('one') })
    feed.stop()
  })

  it('stops when polling finds the publication gone', async () => {
    const feed = setup((getLyrics) => {
      getLyrics.mockResolvedValueOnce(response('one')).mockRejectedValueOnce(missing())
    })
    await settle()

    feed.fail(new Error('listener down'))
    await settle()

    expect(feed.last()).toMatchObject({ status: 'stopped', lyrics: null })
    feed.stop()
  })

  it('polls when Firestore is not configured', async () => {
    const feed = setup((getLyrics) => {
      getLyrics.mockResolvedValueOnce(response('one')).mockResolvedValueOnce(response('two'))
    }, false)
    await settle()

    await vi.advanceTimersByTimeAsync(30_000)
    expect(feed.getLyrics).toHaveBeenCalledTimes(2)
    expect(feed.last()).toMatchObject({ status: 'live', lyrics: payload('two') })
    feed.stop()
  })

  it('keeps the lyrics through offline and refetches once when online', async () => {
    const feed = setup((getLyrics) => {
      getLyrics
        .mockResolvedValueOnce(response('one', 'entry_1'))
        .mockResolvedValueOnce(response('two', 'entry_2'))
    })
    await settle()

    feed.trigger('offline')
    expect(feed.last()).toMatchObject({ status: 'lost', lyrics: payload('one') })

    feed.trigger('online')
    await settle()
    expect(feed.getLyrics).toHaveBeenCalledTimes(2)
    expect(feed.last()).toEqual({
      status: 'live',
      lyrics: payload('two'),
      currentEntryId: 'entry_2',
    })
    feed.stop()
  })

  it('stops when a refetch after a successful load finds the publication gone', async () => {
    const feed = setup((getLyrics) => {
      getLyrics.mockResolvedValueOnce(response('one')).mockRejectedValueOnce(missing())
    })
    await settle()

    feed.trigger('online')
    await settle()

    expect(feed.last()).toMatchObject({ status: 'stopped', lyrics: null })
    feed.stop()
  })

  it('cleans up timers, the listener, and late results', async () => {
    let resolveLate: (value: GetSharedLyricsResult) => void = () => {}
    const feed = setup((getLyrics) => {
      getLyrics
        .mockResolvedValueOnce(response('one'))
        .mockImplementationOnce(
          () => new Promise<GetSharedLyricsResult>((resolve) => (resolveLate = resolve)),
        )
    })
    await settle()

    feed.fail(new Error('listener down'))
    await settle()
    expect(feed.getLyrics).toHaveBeenCalledTimes(2)

    const countBeforeStop = feed.states.length
    feed.stop()
    expect(feed.unsubscribe).toHaveBeenCalledTimes(1)
    expect(feed.listenerCount('online')).toBe(0)
    expect(feed.listenerCount('offline')).toBe(0)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(feed.getLyrics).toHaveBeenCalledTimes(2)

    resolveLate(response('late'))
    await settle()
    expect(feed.states).toHaveLength(countBeforeStop)
  })
})
