import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/firestoreClient', () => ({
  firebaseConfig: vi.fn(),
  loadFirestore: vi.fn(),
}))

import { firebaseConfig, loadFirestore } from '../../src/lib/firestoreClient'
import { subscribeSharedLyrics } from '../../src/lib/lyricsLive'

const config = { apiKey: 'k', appId: 'a', projectId: 'p' }

function snapshot(data?: Record<string, unknown>) {
  return {
    exists: () => data !== undefined,
    data: () => data,
  }
}

function setupFirestore() {
  let onNext!: (snap: { exists: () => boolean; data: () => unknown }) => void
  let onError!: (error: unknown) => void
  const unsubscribe = vi.fn()
  const onSnapshot = vi.fn((_ref, next, error) => {
    onNext = next
    onError = error
    return unsubscribe
  })
  const doc = vi.fn((_db: unknown, collection: string, id: string) => ({ collection, id }))
  vi.mocked(loadFirestore).mockResolvedValue({
    db: {},
    doc,
    onSnapshot,
  } as never)
  return {
    onSnapshot,
    doc,
    get handlers() {
      return { onNext, onError }
    },
    unsubscribe,
  }
}

describe('subscribeSharedLyrics', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does nothing when Firebase is not configured', async () => {
    vi.mocked(firebaseConfig).mockReturnValue(null)

    const unsubscribe = subscribeSharedLyrics('pub-1', { onUpdate: vi.fn() })
    unsubscribe()

    expect(loadFirestore).not.toHaveBeenCalled()
  })

  it('delivers the revision and current song on every snapshot', async () => {
    vi.mocked(firebaseConfig).mockReturnValue(config)
    const env = setupFirestore()
    const onUpdate = vi.fn()
    const onError = vi.fn()

    const unsubscribe = subscribeSharedLyrics('pub-1', { onUpdate, onError })
    await vi.waitFor(() => expect(env.onSnapshot).toHaveBeenCalledTimes(1))

    expect(env.doc).toHaveBeenCalledWith({}, 'sharedLyrics', 'pub-1')

    env.handlers.onNext(snapshot({ rev: 'rev-1', currentEntryId: 'entry_1' }))
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenLastCalledWith({ rev: 'rev-1', currentEntryId: 'entry_1' })

    env.handlers.onNext(snapshot({ rev: 'rev-1', currentEntryId: 'entry_2' }))
    expect(onUpdate).toHaveBeenCalledTimes(2)
    expect(onUpdate).toHaveBeenLastCalledWith({ rev: 'rev-1', currentEntryId: 'entry_2' })

    env.handlers.onError(new Error('offline'))
    expect(onError).toHaveBeenCalledWith(expect.any(Error))

    unsubscribe()
    expect(env.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('reports nulls when the document is missing or fields are absent', async () => {
    vi.mocked(firebaseConfig).mockReturnValue(config)
    const env = setupFirestore()
    const onUpdate = vi.fn()

    subscribeSharedLyrics('pub-1', { onUpdate })
    await vi.waitFor(() => expect(env.onSnapshot).toHaveBeenCalled())

    env.handlers.onNext(snapshot())
    expect(onUpdate).toHaveBeenLastCalledWith({ rev: null, currentEntryId: null })

    env.handlers.onNext(snapshot({ rev: 7, currentEntryId: null }))
    expect(onUpdate).toHaveBeenLastCalledWith({ rev: null, currentEntryId: null })
  })

  it('does not subscribe after being stopped before the client loads', async () => {
    vi.mocked(firebaseConfig).mockReturnValue(config)
    const env = setupFirestore()

    const unsubscribe = subscribeSharedLyrics('pub-1', { onUpdate: vi.fn() })
    unsubscribe()
    await Promise.resolve()

    expect(env.onSnapshot).not.toHaveBeenCalled()
  })
})
