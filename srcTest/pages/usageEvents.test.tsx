// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import HomePage from '../../src/pages/HomePage'
import SearchPage from '../../src/pages/SearchPage'
import PrivacyPage from '../../src/pages/PrivacyPage'
import ShareImportPage from '../../src/pages/ShareImportPage'
import ShareModal from '../../src/components/ShareModal'
import { trackEvent, trackSongImport } from '../../src/lib/analytics'
import { songCache } from '../../src/lib/songCache'
import { sessionStore } from '../../src/lib/sessionStore'
import { scrapeApi, searchApi, createShareApi, getShareApi } from '../../src/lib/api'
import type { Song } from '../../src/types/song'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => navigate,
}))
vi.mock('../../src/lib/analytics', async () => ({
  ...(await vi.importActual('../../src/lib/analytics')),
  trackEvent: vi.fn(),
  trackSongImport: vi.fn(),
}))
vi.mock('../../src/lib/api', async () => ({
  ...(await vi.importActual('../../src/lib/api')),
  searchApi: vi.fn(),
  scrapeApi: vi.fn(),
  createShareApi: vi.fn(),
  getShareApi: vi.fn(),
}))

const song = {
  sourceUrl: 'https://pnwchords.com/cached/',
  title: 'Private title',
  artist: 'Private artist',
  sections: [],
} as unknown as Song
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.spyOn(sessionStore, 'getAllSessions').mockResolvedValue([])
  vi.spyOn(songCache, 'getSong').mockResolvedValue(song)
  vi.spyOn(songCache, 'saveSong').mockResolvedValue()
  vi.spyOn(sessionStore, 'createSession').mockResolvedValue({
    id: 'private-set',
    songs: [],
  } as never)
  vi.spyOn(window, 'alert').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function home() {
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  )
}

describe('usage events at action boundaries', () => {
  it('counts cached songs and failed batch items only after the set is saved', async () => {
    vi.mocked(songCache.getSong).mockImplementation(async (url) =>
      url.includes('cached') ? song : null,
    )
    vi.mocked(scrapeApi).mockResolvedValue({
      results: [
        { url: 'https://pnwchords.com/failure/', status: 'error', message: 'private error' },
      ],
    } as never)
    vi.spyOn(songCache, 'recordFailed').mockResolvedValue()
    home()
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'https://pnwchords.com/cached/\nhttps://pnwchords.com/failure/' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Extract and open session' }))
    await waitFor(() => expect(trackSongImport).toHaveBeenCalledWith('pasted_link', 1, 2))
    expect(sessionStore.createSession).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/session/private-set')
  })

  it('does not report cached songs as imported when saving fails', async () => {
    vi.mocked(sessionStore.createSession).mockRejectedValue(new Error('storage unavailable'))
    home()
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'https://pnwchords.com/cached/' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Extract and open session' }))
    await waitFor(() => expect(trackSongImport).toHaveBeenCalledWith('pasted_link', 0, 1))
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByText('Could not save all imported songs. Please try again.')).toBeTruthy()
  })

  it.each(['home', 'search'] as const)(
    'records failed searches from %s without the query or raw error',
    async (entry) => {
      vi.mocked(searchApi).mockRejectedValue(new Error('private error'))
      render(<MemoryRouter>{entry === 'home' ? <HomePage /> : <SearchPage />}</MemoryRouter>)
      if (entry === 'home') fireEvent.click(screen.getByRole('tab', { name: 'Search' }))
      const input = screen.getByPlaceholderText(/e.g. Goodness/)
      fireEvent.change(input, { target: { value: 'Private search' } })
      fireEvent.submit(input.closest('form')!)
      await waitFor(() =>
        expect(trackEvent).toHaveBeenCalledWith('song_search', {
          entry_page: entry,
          outcome: 'error',
          result_count: 0,
        }),
      )
    },
  )

  it('records successful search and cached import only after persistence', async () => {
    vi.mocked(searchApi).mockResolvedValue([
      { url: song.sourceUrl, title: song.title, artist: song.artist, site: 'PNW' },
    ])
    home()
    fireEvent.click(screen.getByRole('tab', { name: 'Search' }))
    const input = screen.getByPlaceholderText(/e.g. Goodness/)
    fireEvent.change(input, { target: { value: 'Private title' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith('song_search', {
        entry_page: 'home',
        outcome: 'success',
        result_count: 1,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start setlist' }))
    await waitFor(() => expect(trackSongImport).toHaveBeenCalledWith('search', 1, 1))
    expect(scrapeApi).not.toHaveBeenCalled()
  })

  it('records shared-set import once under Strict Mode after local persistence', async () => {
    vi.mocked(getShareApi).mockResolvedValue({
      v: 2,
      name: 'Private set',
      songs: [{ entryId: 'entry-1', song, transpose: 0 }],
    } as never)
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/s/private-link']}>
          <Routes>
            <Route path="/s/:shortId" element={<ShareImportPage />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    )
    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith('shared_set_imported', {
        outcome: 'success',
        imported_count: 1,
      }),
    )
    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(sessionStore.createSession).toHaveBeenCalledTimes(1)
  })

  it('records set sharing only when link creation succeeds', async () => {
    vi.mocked(createShareApi)
      .mockRejectedValueOnce(new Error('Private server failure'))
      .mockResolvedValueOnce({ id: 'private-link', expiresAt: '2026-10-24T00:00:00Z' })
    render(
      <ShareModal
        snapshot={
          {
            v: 2,
            name: 'Private set',
            songs: [{ entryId: 'entry-1', song, transpose: 0 }],
          } as never
        }
        isOpen
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Generate link' }))
    await screen.findByText('Private server failure')
    expect(trackEvent).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Generate link' }))
    await waitFor(() => expect(trackEvent).toHaveBeenCalledWith('set_shared', { song_count: 1 }))
    expect(trackEvent).toHaveBeenCalledTimes(1)
  })

  it('persists privacy choices and displays them after remounting', () => {
    const first = render(<PrivacyPage />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Usage tracking' }))
    expect(localStorage.getItem('usage-tracking-disabled')).toBe('true')
    expect(screen.getByRole('status').textContent).toContain('off')
    first.unmount()
    render(<PrivacyPage />)
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  })
})
