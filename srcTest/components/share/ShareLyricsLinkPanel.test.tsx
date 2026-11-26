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
    expect(screen.getByText('Updates when you change the set.')).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()
  })

  it('creates a link and shows Copy link, Preview and the expiry date', async () => {
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
    expect(await screen.findByRole('button', { name: 'Copy link' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy()
    expect(screen.getByText(/Link works until/)).toBeTruthy()
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
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull()
  })

  it('restores an unexpired publication as Copy link', async () => {
    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    await screen.findByRole('button', { name: 'Copy link' })

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
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull()
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

  it('shows the individual and group rows', async () => {
    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    await screen.findByRole('button', { name: 'Copy link' })

    expect(screen.getByText('For individual phones')).toBeTruthy()
    expect(screen.getByText('For group projector/screen')).toBeTruthy()
    expect(
      screen.getByText(
        'Updates when you change songs. Stops if your device sleeps or goes offline.',
      ),
    ).toBeTruthy()
  })

  it('copies the presenter link when the lyrics link is published', async () => {
    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    await screen.findByRole('button', { name: 'Copy link' })
    fireEvent.click(screen.getByRole('button', { name: 'Copy presenter link' }))

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('https://example.test/present/pub-id-123'),
    )
    expect(mocks.publishLyricsForSession).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()
  })

  it('publishes first when copying the presenter link without a link', async () => {
    mocks.getLyricsPublicationIdentity.mockResolvedValue(null)
    mocks.publishLyricsForSession.mockResolvedValue({
      id: 'pub-new',
      expiresAt: futureDate,
      shareUrl: 'https://example.test/lyrics/pub-new',
    })

    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    const button = screen.getByRole('button', {
      name: 'Copy presenter link',
    }) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(false))
    fireEvent.click(button)

    await waitFor(() =>
      expect(mocks.publishLyricsForSession).toHaveBeenCalledWith('session-1', expect.anything()),
    )
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('https://example.test/present/pub-new'),
    )
    expect(mocks.resendCurrentSong).toHaveBeenCalledWith('session-1')
  })

  it('opens the presenter window at once when the lyrics link is published', async () => {
    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    await screen.findByRole('button', { name: 'Copy link' })
    fireEvent.click(screen.getByRole('button', { name: 'Open presenter window' }))

    expect(windowOpen).toHaveBeenCalledWith('https://example.test/present/pub-id-123', '_blank')
  })

  it('opens the presenter window after publishing without a link', async () => {
    mocks.getLyricsPublicationIdentity.mockResolvedValue(null)
    mocks.publishLyricsForSession.mockResolvedValue({
      id: 'pub-new',
      expiresAt: futureDate,
      shareUrl: 'https://example.test/lyrics/pub-new',
    })
    const opened = { location: { href: '' }, close: vi.fn() }
    windowOpen.mockReturnValue(opened)

    render(<ShareLyricsLinkPanel session={session} songsData={songsData} />)

    const button = screen.getByRole('button', {
      name: 'Open presenter window',
    }) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(false))
    fireEvent.click(button)

    await waitFor(() => expect(opened.location.href).toBe('https://example.test/present/pub-new'))
    expect(windowOpen).toHaveBeenNthCalledWith(1, '', '_blank')
    expect(opened.close).not.toHaveBeenCalled()
  })
})
