// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ShareLyricsLinkPanel from '../../../src/components/share/ShareLyricsLinkPanel'
import type { Session } from '../../../src/lib/sessionStore'
import type { Song } from '../../../src/types/song'

const mocks = vi.hoisted(() => ({
  getLyricsPublicationIdentity: vi.fn(),
  ensureLyricsFresh: vi.fn(async () => ({ ok: true })),
  publishLyricsForSession: vi.fn(),
  resendCurrentSong: vi.fn(),
}))

vi.mock('../../../src/lib/lyricsPublishIdentity', () => ({
  getLyricsPublicationIdentity: mocks.getLyricsPublicationIdentity,
  publishLyricsForSession: mocks.publishLyricsForSession,
}))
vi.mock('../../../src/lib/lyricsSync', () => ({
  ensureLyricsFresh: mocks.ensureLyricsFresh,
}))
vi.mock('../../../src/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('../../../src/lib/presenterCurrent', () => ({
  currentSongSender: { notify: vi.fn(), resend: mocks.resendCurrentSong },
}))

const writeText = vi.fn(async () => {})
const windowOpen = vi.fn()

beforeEach(() => {
  vi.stubGlobal('location', { origin: 'https://example.test' })
  vi.stubGlobal('open', windowOpen)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
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

const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

function createLinkButton() {
  return screen.getByRole('button', { name: 'Create link' }) as HTMLButtonElement
}

async function findReadyCreateLink() {
  await waitFor(() => expect(createLinkButton().disabled).toBe(false))
  return createLinkButton()
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getLyricsPublicationIdentity.mockResolvedValue({
    sessionId: 'session-1',
    publicationId: 'pub-id-123',
    updateSecret: 'secret-123',
    expiresAt: futureDate,
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

    await waitFor(
      () => {
        expect(mocks.ensureLyricsFresh).toHaveBeenCalled()
      },
      { timeout: 5000 },
    )

    expect(mocks.ensureLyricsFresh).toHaveBeenCalledTimes(1)
  })

  it('shows Create link and no shared actions when there is no publication', async () => {
    mocks.getLyricsPublicationIdentity.mockResolvedValue(null)

    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    await findReadyCreateLink()
    expect(
      screen.getByText('Link automatically updates when you add or remove songs.'),
    ).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()
  })

  it('creates a link and shows Copy, Preview and the expiry date', async () => {
    mocks.getLyricsPublicationIdentity.mockResolvedValue(null)
    mocks.publishLyricsForSession.mockResolvedValue({
      id: 'pub-new',
      expiresAt: futureDate,
      shareUrl: 'https://example.test/lyrics/pub-new',
    })

    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    fireEvent.click(await findReadyCreateLink())

    await waitFor(() => {
      expect(mocks.publishLyricsForSession).toHaveBeenCalledWith('session-1', expect.anything())
    })
    expect(await screen.findByRole('button', { name: 'Copy' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy()
    expect(screen.getByText(/Works until/)).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('shows a spinner and disables the button while publishing', async () => {
    mocks.getLyricsPublicationIdentity.mockResolvedValue(null)
    mocks.publishLyricsForSession.mockReturnValue(new Promise(() => {}))

    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    fireEvent.click(await findReadyCreateLink())

    await waitFor(() => expect(createLinkButton().getAttribute('aria-busy')).toBe('true'))
    expect(createLinkButton().disabled).toBe(true)
  })

  it('shows the error and keeps Create link when publishing fails', async () => {
    mocks.getLyricsPublicationIdentity.mockResolvedValue(null)
    let reject!: (err: Error) => void
    mocks.publishLyricsForSession.mockReturnValue(
      new Promise((_, r) => {
        reject = r
      }),
    )

    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)
    fireEvent.click(await findReadyCreateLink())

    await act(async () => reject(new Error('Network down')))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Network down'))
    expect(screen.getByRole('button', { name: 'Create link' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
  })

  it('restores an unexpired publication as Copy', async () => {
    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    await screen.findByRole('button', { name: 'Copy' })

    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create link' })).toBeNull()
    expect(mocks.getLyricsPublicationIdentity).toHaveBeenCalledWith('session-1')
  })

  it('shows Create link when the stored publication has expired', async () => {
    mocks.getLyricsPublicationIdentity.mockResolvedValue({
      sessionId: 'session-1',
      publicationId: 'pub-id-123',
      updateSecret: 'secret-123',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    })

    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    await findReadyCreateLink()
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('calls ensureLyricsFresh again when window online is dispatched', async () => {
    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    await waitFor(
      () => {
        expect(mocks.ensureLyricsFresh).toHaveBeenCalledTimes(1)
      },
      { timeout: 5000 },
    )

    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    await waitFor(
      () => {
        expect(mocks.ensureLyricsFresh).toHaveBeenCalledTimes(2)
      },
      { timeout: 5000 },
    )
  })

  it('does not call ensureLyricsFresh after unmount when online is dispatched', async () => {
    const { unmount } = render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    await waitFor(
      () => {
        expect(mocks.ensureLyricsFresh).toHaveBeenCalledTimes(1)
      },
      { timeout: 5000 },
    )

    unmount()

    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    expect(mocks.ensureLyricsFresh).toHaveBeenCalledTimes(1)
  })

  it('shows only the Share lyrics only section without presentation controls', async () => {
    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    await screen.findByRole('button', { name: 'Copy' })

    expect(screen.getByRole('heading', { name: 'Share lyrics only' })).toBeTruthy()
    expect(screen.getByText('Send this link to your friends to see lyrics directly.')).toBeTruthy()
    expect(
      screen.queryByRole('heading', { name: 'Start presentation mode for lyrics' }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open in a new tab' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull()
  })
})
