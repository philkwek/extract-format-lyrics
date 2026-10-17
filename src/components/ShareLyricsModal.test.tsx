// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import ShareLyricsModal from './ShareLyricsModal'
import { trackEvent } from '../lib/analytics'
vi.mock('../lib/analytics', () => ({ trackEvent: vi.fn() }))
import * as lyricsIdentity from '../lib/lyricsPublishIdentity'
import type { Session } from '../lib/sessionStore'
import type { Song } from '../types/song'

vi.mock('../lib/lyricsPublishIdentity', async () => {
  const actual = await vi.importActual('../lib/lyricsPublishIdentity')
  return {
    ...actual,
    getLyricsPublicationIdentity: vi.fn(),
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
      status: 'ok',
    },
  ],
}

const mockSongsData = new Map<string, Song>([
  ['e1', mockSong],
  [mockSong.sourceUrl, mockSong],
])

describe('ShareLyricsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('performs no network publication when opened', async () => {
    vi.mocked(lyricsIdentity.getLyricsPublicationIdentity).mockResolvedValue(null)

    render(
      <ShareLyricsModal
        session={mockSession}
        songsData={mockSongsData}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Generate link/i })).toBeTruthy()
    })

    expect(lyricsIdentity.publishLyricsForSession).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('publishes and shows stable link, expiry, Copy link, and Update lyrics after generation', async () => {
    vi.mocked(lyricsIdentity.getLyricsPublicationIdentity).mockResolvedValue(null)
    const expiry = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    vi.mocked(lyricsIdentity.publishLyricsForSession).mockResolvedValue({
      id: 'pub-test-id',
      expiresAt: expiry,
      shareUrl: 'http://localhost/lyrics/pub-test-id',
    })

    render(
      <ShareLyricsModal
        session={mockSession}
        songsData={mockSongsData}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    const generateBtn = await screen.findByRole('button', { name: /Generate link/i })
    fireEvent.click(generateBtn)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Copy link/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /Update lyrics/i })).toBeTruthy()
    })

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(trackEvent).toHaveBeenCalledWith('lyrics_published', { operation: 'create', outcome: 'success', song_count: 1 })
    expect(input.value).toBe('http://localhost/lyrics/pub-test-id')
    expect(screen.getByText(/Updates keep this link and renew expiry for seven days/i)).toBeTruthy()
  })

  it('restores existing publication on opening and preserves link on failed update', async () => {
    const existingExpiry = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString()
    vi.mocked(lyricsIdentity.getLyricsPublicationIdentity).mockResolvedValue({
      sessionId: mockSession.id,
      publicationId: 'pub-existing',
      updateSecret: 'secret-123',
      expiresAt: existingExpiry,
    })

    render(
      <ShareLyricsModal
        session={mockSession}
        songsData={mockSongsData}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Copy link/i })).toBeTruthy()
      expect(screen.getByRole('button', { name: /Update lyrics/i })).toBeTruthy()
    })

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toContain('/lyrics/pub-existing')

    // Simulate failed update
    vi.mocked(lyricsIdentity.publishLyricsForSession).mockRejectedValue(
      new Error('Failed to reach server')
    )

    const updateBtn = screen.getByRole('button', { name: /Update lyrics/i })
    fireEvent.click(updateBtn)

    await waitFor(() => {
      expect(screen.getByText(/Failed to reach server/i)).toBeTruthy()
    })

    expect(trackEvent).toHaveBeenCalledWith('lyrics_published', { operation: 'update', outcome: 'error', song_count: 1 })

    // URL and buttons are retained despite the failure
    expect(input.value).toContain('/lyrics/pub-existing')
    expect(screen.getByRole('button', { name: /Copy link/i })).toBeTruthy()
  })

  it('renders See Preview button and opens preview modal with (Preview) header without generating a link', async () => {
    vi.mocked(lyricsIdentity.getLyricsPublicationIdentity).mockResolvedValue(null)

    render(
      <ShareLyricsModal
        session={mockSession}
        songsData={mockSongsData}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    const previewBtn = await screen.findByRole('button', { name: /See Preview/i })
    expect(previewBtn).toBeTruthy()

    // Click See Preview
    fireEvent.click(previewBtn)

    // Modal with (Preview) header must appear
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /\(Preview\) Sunday Morning/i })).toBeTruthy()
    })

    // Lyrics content is rendered inside preview (tab and heading)
    expect(screen.getAllByText('Test Song').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Singing a song')).toBeTruthy()

    // Must NOT call publishLyricsForSession
    expect(lyricsIdentity.publishLyricsForSession).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalled()

    // Close button (X) is available in preview modal
    const closeButtons = screen.getAllByRole('button', { name: /Close/i })
    expect(closeButtons.length).toBeGreaterThan(0)
    fireEvent.click(closeButtons[closeButtons.length - 1])

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /\(Preview\) Sunday Morning/i })).toBeNull()
    })
  })
})
