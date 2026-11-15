// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
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
  songs: [{ entryId: 'e1', url: 'https://example.test/a', title: 'A', artist: 'B' }],
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

  it('reports the publication as active when an existing one is restored', async () => {
    const onActiveChange = vi.fn()
    render(
      <ShareLyricsLinkPanel
        session={session}
        songsData={songsData}
        onActiveChange={onActiveChange}
      />,
    )

    await waitFor(
      () => {
        expect(onActiveChange).toHaveBeenLastCalledWith(true)
      },
      { timeout: 5000 },
    )

    expect(mocks.getLyricsPublicationIdentity).toHaveBeenCalledWith('session-1')
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

  it('shows the simpler copy and the create action before a link exists', async () => {
    mocks.getLyricsPublicationIdentity.mockResolvedValue(null)

    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    expect(
      screen.getByText(
        'Anyone with the link can see the words. The link works for 7 days after your last change.',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create link' })).toBeTruthy()

    await waitFor(() => {
      expect((screen.getByLabelText('Lyrics link') as HTMLInputElement).value).toBe('No link yet')
    })
  })

  it('shows the update action and shorter copy once a link exists', async () => {
    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Update lyrics' })).toBeTruthy()
    })

    expect(
      screen.getByText('Changes update the link and keep it working for 7 days.'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })
})
