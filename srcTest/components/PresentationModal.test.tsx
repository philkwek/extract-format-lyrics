// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PresentationModal from '../../src/components/PresentationModal'
import type { Session } from '../../src/lib/sessionStore'
import type { Song } from '../../src/types/song'

const mocks = vi.hoisted(() => ({
  getLyricsPublicationIdentity: vi.fn(),
  ensureLyricsFresh: vi.fn(async () => ({ ok: true })),
  publishLyricsForSession: vi.fn(),
  resendCurrentSong: vi.fn(),
}))

vi.mock('../../src/lib/lyricsPublishIdentity', () => ({
  getLyricsPublicationIdentity: mocks.getLyricsPublicationIdentity,
  publishLyricsForSession: mocks.publishLyricsForSession,
}))
vi.mock('../../src/lib/lyricsSync', () => ({
  ensureLyricsFresh: mocks.ensureLyricsFresh,
}))
vi.mock('../../src/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('../../src/lib/presenterCurrent', () => ({
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

describe('PresentationModal', () => {
  it('renders the presentation header and both device options', async () => {
    render(<PresentationModal session={session} songsData={songsData} isOpen onClose={vi.fn()} />)

    expect(
      screen.getByRole('heading', { name: 'Start presentation mode for lyrics' }),
    ).toBeTruthy()
    expect(screen.getByText('Just like a PowerPoint presentation.')).toBeTruthy()
    expect(screen.getByText('Present on this device')).toBeTruthy()
    expect(screen.getByText('Drag the new window into your 2nd display.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open in a new tab' })).toBeTruthy()
    expect(screen.getByText('Present from a different laptop')).toBeTruthy()
    expect(screen.getByText('Copy the link and open it on your 2nd device.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })

  it('copies the presenter link when the lyrics link is published', async () => {
    render(<PresentationModal session={session} songsData={songsData} isOpen onClose={vi.fn()} />)

    const copyButton = screen.getByRole('button', { name: 'Copy link' }) as HTMLButtonElement
    await waitFor(() => expect(copyButton.disabled).toBe(false))
    fireEvent.click(copyButton)

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

    render(<PresentationModal session={session} songsData={songsData} isOpen onClose={vi.fn()} />)

    const button = screen.getByRole('button', {
      name: 'Copy link',
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
    render(<PresentationModal session={session} songsData={songsData} isOpen onClose={vi.fn()} />)

    const button = screen.getByRole('button', {
      name: 'Open in a new tab',
    }) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(false))
    fireEvent.click(button)

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

    render(<PresentationModal session={session} songsData={songsData} isOpen onClose={vi.fn()} />)

    const button = screen.getByRole('button', {
      name: 'Open in a new tab',
    }) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(false))
    fireEvent.click(button)

    await waitFor(() => expect(opened.location.href).toBe('https://example.test/present/pub-new'))
    expect(windowOpen).toHaveBeenNthCalledWith(1, '', '_blank')
    expect(opened.close).not.toHaveBeenCalled()
  })

  it('shows an error alert when publishing fails', async () => {
    mocks.getLyricsPublicationIdentity.mockResolvedValue(null)
    let reject!: (err: Error) => void
    mocks.publishLyricsForSession.mockReturnValue(
      new Promise((_, r) => {
        reject = r
      }),
    )

    render(<PresentationModal session={session} songsData={songsData} isOpen onClose={vi.fn()} />)

    const button = screen.getByRole('button', {
      name: 'Copy link',
    }) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(false))
    fireEvent.click(button)

    await act(async () => reject(new Error('Network down')))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Network down'))
  })
})
