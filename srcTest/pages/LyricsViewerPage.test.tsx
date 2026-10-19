// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import LyricsViewerPage from '../../src/pages/LyricsViewerPage'
import * as api from '../../src/lib/api'
import type { GetSharedLyricsResult } from '../../src/lib/api'

vi.mock('../../src/lib/api', async () => {
  const actual = await vi.importActual('../../src/lib/api')
  return {
    ...actual,
    getSharedLyricsApi: vi.fn(),
  }
})

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
  window.scrollTo = vi.fn()
})

afterEach(() => {
  cleanup()
})

const mockLyricsData: GetSharedLyricsResult = {
  id: 'pub-123',
  expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
  lyrics: {
    v: 1,
    name: 'Sunday Morning Set',
    songs: [
      {
        entryId: 'entry-song-1',
        title: 'Way Maker',
        sections: [
          { label: 'Verse 1', lines: ['You are here moving in our midst', 'I worship You'] },
          { label: 'Chorus', lines: ['Way maker miracle worker'] },
        ],
      },
      {
        entryId: 'entry-song-2',
        title: 'Goodness of God',
        sections: [
          { label: 'Intro', lines: [] },
          { label: 'Verse 1', lines: ['I love You Lord'] },
        ],
      },
      {
        entryId: 'entry-song-3',
        title: 'Empty Song',
        sections: [],
      },
    ],
  },
}

function renderViewer(shortId = 'pub-123') {
  return render(
    <MemoryRouter initialEntries={[`/lyrics/${shortId}`]}>
      <Routes>
        <Route path="/lyrics/:shortId" element={<LyricsViewerPage />} />
        <Route path="/" element={<div>Home Page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('LyricsViewerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state initially', () => {
    vi.mocked(api.getSharedLyricsApi).mockReturnValue(new Promise(() => {}))
    renderViewer()
    expect(screen.getByText(/Loading lyrics…/i)).toBeTruthy()
  })

  it('renders missing state on 404 NOT_FOUND error', async () => {
    vi.mocked(api.getSharedLyricsApi).mockRejectedValue(
      new api.ShareApiError('Not found', 'NOT_FOUND', 404)
    )
    renderViewer()
    await waitFor(() => {
      expect(screen.getByText(/Lyrics link not found/i)).toBeTruthy()
    })
  })

  it('renders expired state on 410 EXPIRED error', async () => {
    vi.mocked(api.getSharedLyricsApi).mockRejectedValue(
      new api.ShareApiError('Link expired', 'EXPIRED', 410)
    )
    renderViewer()
    await waitFor(() => {
      expect(screen.getByText(/This lyrics link has expired/i)).toBeTruthy()
    })
  })

  it('renders retryable error and retries on button click', async () => {
    vi.mocked(api.getSharedLyricsApi)
      .mockRejectedValueOnce(new Error('Network offline'))
      .mockResolvedValueOnce(mockLyricsData)

    renderViewer()

    await waitFor(() => {
      expect(screen.getByText(/Could not load lyrics/i)).toBeTruthy()
      expect(screen.getByText(/Network offline/i)).toBeTruthy()
    })

    const retryBtn = screen.getByRole('button', { name: /Try again/i })
    fireEvent.click(retryBtn)

    await waitFor(() => {
      expect(screen.getByText('Sunday Morning Set')).toBeTruthy()
    })
  })

  it('renders set name, song tabs, and lyrics in single column format', async () => {
    vi.mocked(api.getSharedLyricsApi).mockResolvedValue(mockLyricsData)
    renderViewer()

    await waitFor(() => {
      expect(screen.getByText('Sunday Morning Set')).toBeTruthy()
    })

    // Song tabs
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(tabs[0].textContent).toContain('Way Maker')
    expect(tabs[1].textContent).toContain('Goodness of God')
    expect(tabs[2].textContent).toContain('Empty Song')

    // Initial selected song is the first one
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs[1].getAttribute('aria-selected')).toBe('false')

    // Lyrics content for first song
    expect(screen.getByRole('heading', { level: 2, name: 'Way Maker' })).toBeTruthy()
    expect(screen.getByText('[Verse 1]')).toBeTruthy()
    expect(screen.getByText('You are here moving in our midst')).toBeTruthy()
    expect(screen.getByText('Way maker miracle worker')).toBeTruthy()

    // Switch to second song
    fireEvent.click(tabs[1])
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { level: 2, name: 'Goodness of God' })).toBeTruthy()
    expect(screen.getByText('[Intro]')).toBeTruthy()
    expect(screen.getByText('Instrumental')).toBeTruthy()
    expect(screen.getByText('I love You Lord')).toBeTruthy()

    // Switch to third song (empty lyrics state)
    fireEvent.click(tabs[2])
    expect(screen.getByText(/No lyrics available for this song/i)).toBeTruthy()
  })

  it('supports keyboard navigation across song tabs', async () => {
    vi.mocked(api.getSharedLyricsApi).mockResolvedValue(mockLyricsData)
    renderViewer()

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Way Maker' })).toBeTruthy()
    })


    const tabs = screen.getAllByRole('tab')
    // ArrowRight moves to next song
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { level: 2, name: 'Goodness of God' })).toBeTruthy()

    // ArrowLeft moves back
    fireEvent.keyDown(tabs[1], { key: 'ArrowLeft' })
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
  })

  it('refreshes data when returning to the browser tab', async () => {
    vi.mocked(api.getSharedLyricsApi).mockResolvedValue(mockLyricsData)
    renderViewer()

    await waitFor(() => {
      expect(screen.getByText('Sunday Morning Set')).toBeTruthy()
    })

    expect(api.getSharedLyricsApi).toHaveBeenCalledTimes(1)

    // Simulate tab visibility change
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    fireEvent(document, new Event('visibilitychange'))

    expect(api.getSharedLyricsApi).toHaveBeenCalledTimes(2)
  })

  it('renders instantly from local cache and saves to recent store', async () => {
    const { saveRecentSharedLyrics, getRecentSharedLyrics, clearRecentSharedLyrics } = await import(
      '../../src/lib/recentLyricsStore'
    )
    await clearRecentSharedLyrics()
    await saveRecentSharedLyrics('pub-cached', mockLyricsData.lyrics, mockLyricsData.expiresAt)

    // Api takes long time to respond
    vi.mocked(api.getSharedLyricsApi).mockReturnValue(new Promise(() => {}))

    renderViewer('pub-cached')

    // Renders cached data immediately without waiting for API
    await waitFor(() => {
      expect(screen.getByText('Sunday Morning Set')).toBeTruthy()
      expect(screen.getByRole('heading', { level: 2, name: 'Way Maker' })).toBeTruthy()
    })

    const recents = await getRecentSharedLyrics()
    expect(recents.some((r) => r.id === 'pub-cached')).toBe(true)
  })

  it('renders dark mode / light mode toggle button next to refresh and toggles theme', async () => {
    vi.mocked(api.getSharedLyricsApi).mockResolvedValue(mockLyricsData)
    renderViewer()

    await waitFor(() => {
      expect(screen.getByText('Sunday Morning Set')).toBeTruthy()
    })

    const refreshButton = screen.getByRole('button', { name: /refresh/i })
    expect(refreshButton).toBeTruthy()

    const themeButton = screen.getByRole('button', { name: /switch to (light|dark) mode/i })
    expect(themeButton).toBeTruthy()

    // Verify button is sibling of refresh in the same header control group
    expect(refreshButton.parentElement).toBe(themeButton.parentElement)

    const initialLabel = themeButton.getAttribute('aria-label')
    fireEvent.click(themeButton)
    expect(themeButton.getAttribute('aria-label')).not.toBe(initialLabel)
  })
})
