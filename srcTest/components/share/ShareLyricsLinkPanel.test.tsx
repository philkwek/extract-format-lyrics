// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import ShareLyricsLinkPanel from '../../../src/components/share/ShareLyricsLinkPanel'
import type { Session } from '../../../src/lib/sessionStore'
import type { Song } from '../../../src/types/song'

const mocks = vi.hoisted(() => ({
  getLyricsPublicationIdentity: vi.fn(),
  ensureLyricsFresh: vi.fn(async () => ({ ok: true })),
  publishLyricsForSession: vi.fn(),
}))

vi.mock('../../../src/lib/lyricsPublishIdentity', () => ({
  getLyricsPublicationIdentity: mocks.getLyricsPublicationIdentity,
  publishLyricsForSession: mocks.publishLyricsForSession,
}))
vi.mock('../../../src/lib/lyricsSync', () => ({
  ensureLyricsFresh: mocks.ensureLyricsFresh,
}))

beforeEach(() => {
  vi.stubGlobal('location', { origin: 'https://example.test' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const session: Session = {
  id: 'session-1',
  publicId: 'pub-1',
  createdAt: 0,
  name: 'Sunday Set',
  songs: [{ entryId: 'e1', url: 'https://example.test/a', title: 'A', artist: 'B', status: 'ok' }],
}

const songsData = new Map<string, Song>([
  [
    'https://example.test/a',
    {
      id: 'song-1',
      title: 'A',
      artist: 'B',
      sourceUrl: 'https://example.test/a',
      sourceSite: 'example',
      originalKey: 'G',
      sections: [],
    },
  ],
])

const now = new Date().toISOString()

beforeEach(() => {
  mocks.getLyricsPublicationIdentity.mockResolvedValue({
    sessionId: 'session-1',
    publicationId: 'pub-id-123',
    updateSecret: 'secret-123',
    expiresAt: now,
  })
  mocks.ensureLyricsFresh.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ShareLyricsLinkPanel', () => {
  it('calls ensureLyricsFresh once when rendered with a published identity', async () => {
    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    // Wait for ensureLyricsFresh to be called
    await waitFor(
      () => {
        expect(mocks.ensureLyricsFresh).toHaveBeenCalled()
      },
      { timeout: 5000 },
    )

    expect(mocks.ensureLyricsFresh).toHaveBeenCalledTimes(1)
  })

  it('calls ensureLyricsFresh again when window online is dispatched', async () => {
    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    // Wait for ensureLyricsFresh to be called initially
    await waitFor(
      () => {
        expect(mocks.ensureLyricsFresh).toHaveBeenCalledTimes(1)
      },
      { timeout: 5000 },
    )

    // Dispatch online event
    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    // Wait for ensureLyricsFresh to be called again
    await waitFor(
      () => {
        expect(mocks.ensureLyricsFresh).toHaveBeenCalledTimes(2)
      },
      { timeout: 5000 },
    )
  })

  it('does not call ensureLyricsFresh after unmount when online is dispatched', async () => {
    const { unmount } = render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    // Wait for ensureLyricsFresh to be called initially
    await waitFor(
      () => {
        expect(mocks.ensureLyricsFresh).toHaveBeenCalledTimes(1)
      },
      { timeout: 5000 },
    )

    // Unmount the component
    unmount()

    // Dispatch online event
    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    // Should still be 1, not 2
    expect(mocks.ensureLyricsFresh).toHaveBeenCalledTimes(1)
  })
})
