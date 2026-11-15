// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import ShareLyricsModal from '../../src/components/ShareLyricsModal'
import { trackEvent } from '../../src/lib/analytics'
vi.mock('../../src/lib/analytics', () => ({ trackEvent: vi.fn() }))
import * as lyricsIdentity from '../../src/lib/lyricsPublishIdentity'
import type { Session } from '../../src/lib/sessionStore'
import type { Song } from '../../src/types/song'

vi.mock('../../src/lib/lyricsPublishIdentity', async () => {
  const actual = await vi.importActual('../../src/lib/lyricsPublishIdentity')
  return {
    ...actual,
    getLyricsPublicationIdentity: vi.fn(),
    deleteLyricsPublicationIdentity: vi.fn(async () => {}),
    publishLyricsForSession: vi.fn(),
  }
})

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
})

const mockSong: Song = {
  id: 'song-1',
  title: 'Test Song',
  artist: 'Artist',
  sourceUrl: 'https://example.com/s1',
  sourceSite: 'example.com',
  originalKey: 'C',
  sections: [
    {
      type: 'Verse',
      label: 'Verse 1',
      lines: [{ kind: 'lyric', text: 'Singing a song', chords: [] }],
    },
  ],
}

const mockSession: Session = {
  id: 'session-modal-1',
  createdAt: Date.now(),
  name: 'Sunday Morning',
  songs: [
    {
      entryId: 'e1',
      url: mockSong.sourceUrl,
      title: mockSong.title,
      artist: mockSong.artist,
    },
  ],
}

const mockSongsData = new Map<string, Song>([
  ['e1', mockSong],
  [mockSong.sourceUrl, mockSong],
])

function lyricsSwitch() {
  return screen.getByRole('switch', { name: 'Lyrics link' }) as HTMLButtonElement
}

async function findReadySwitch() {
  await waitFor(() => expect(lyricsSwitch().disabled).toBe(false))
  return lyricsSwitch()
}

function renderModal() {
  return render(
    <ShareLyricsModal
      session={mockSession}
      songsData={mockSongsData}
      isOpen={true}
      onClose={vi.fn()}
    />,
  )
}

describe('ShareLyricsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('performs no network publication when opened', async () => {
    vi.mocked(lyricsIdentity.getLyricsPublicationIdentity).mockResolvedValue(null)

    renderModal()

    await findReadySwitch()
    expect(lyricsSwitch().getAttribute('aria-checked')).toBe('false')
    expect(lyricsIdentity.publishLyricsForSession).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('publishes and shows Copy link and Preview after the switch is turned on', async () => {
    vi.mocked(lyricsIdentity.getLyricsPublicationIdentity).mockResolvedValue(null)
    const expiry = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    vi.mocked(lyricsIdentity.publishLyricsForSession).mockResolvedValue({
      id: 'pub-test-id',
      expiresAt: expiry,
      shareUrl: 'http://localhost/lyrics/pub-test-id',
    })

    renderModal()

    fireEvent.click(await findReadySwitch())

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Copy link/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /Preview/i })).toBeTruthy()
    })

    expect(trackEvent).toHaveBeenCalledWith('lyrics_published', {
      operation: 'create',
      outcome: 'success',
      song_count: 1,
    })
    expect(screen.getByText('On. Updates when you change the set.')).toBeTruthy()
    expect(screen.getByText(/Link works until/i)).toBeTruthy()
  })

  it('restores an existing publication and turns it off', async () => {
    const existingExpiry = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString()
    vi.mocked(lyricsIdentity.getLyricsPublicationIdentity).mockResolvedValue({
      sessionId: mockSession.id,
      publicationId: 'pub-existing',
      updateSecret: 'secret-123',
      expiresAt: existingExpiry,
    })

    renderModal()

    await screen.findByRole('button', { name: /Copy link/i })
    expect(lyricsSwitch().getAttribute('aria-checked')).toBe('true')

    fireEvent.click(lyricsSwitch())

    await waitFor(() => {
      expect(lyricsIdentity.deleteLyricsPublicationIdentity).toHaveBeenCalledWith(mockSession.id)
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Copy link/i })).toBeNull()
    })
    expect(screen.queryByRole('button', { name: /Preview/i })).toBeNull()
  })

  it('renders Preview and opens the preview modal once the link is on', async () => {
    vi.mocked(lyricsIdentity.getLyricsPublicationIdentity).mockResolvedValue(null)
    vi.mocked(lyricsIdentity.publishLyricsForSession).mockResolvedValue({
      id: 'pub-test-id',
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      shareUrl: 'http://localhost/lyrics/pub-test-id',
    })

    renderModal()

    fireEvent.click(await findReadySwitch())
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /\(Preview\) Sunday Morning/i })).toBeTruthy()
    })

    expect(screen.getAllByText('Test Song').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Singing a song')).toBeTruthy()

    const closeButtons = screen.getAllByRole('button', { name: /Close/i })
    expect(closeButtons.length).toBeGreaterThan(0)
    fireEvent.click(closeButtons[closeButtons.length - 1])

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /\(Preview\) Sunday Morning/i })).toBeNull()
    })
  })
})
