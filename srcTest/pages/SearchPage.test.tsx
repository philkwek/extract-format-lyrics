// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SearchPage from '../../src/pages/SearchPage'
import { searchApi } from '../../src/lib/api'
import { importSources } from '../../src/lib/setlistImport'
import { sessionStore } from '../../src/lib/sessionStore'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => navigate,
}))
vi.mock('../../src/lib/setlistImport', async () => ({
  ...(await vi.importActual('../../src/lib/setlistImport')),
  importSources: vi.fn(),
}))
vi.mock('../../src/lib/api', async () => ({
  ...(await vi.importActual('../../src/lib/api')),
  searchApi: vi.fn(),
}))
vi.mock('../../src/lib/analytics', async () => ({
  ...(await vi.importActual('../../src/lib/analytics')),
  trackEvent: vi.fn(),
  trackSongImport: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(sessionStore, 'getSession').mockResolvedValue({
    id: 'session-1',
    createdAt: 0,
    name: 'Sunday Set',
    songs: [],
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SearchPage import wiring', () => {
  it('appends pasted sources to the target session and opens the first new song', async () => {
    vi.mocked(importSources).mockResolvedValue({
      session: { id: 'session-1', createdAt: 0, name: 'Sunday Set', songs: [] },
      items: [],
      imported: 1,
      attempted: 1,
      firstNewIndex: 3,
      failures: [],
    })

    render(
      <MemoryRouter initialEntries={['/search?session=session-1']}>
        <SearchPage />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Paste links' }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'https://pnwchords.com/song' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add to setlist' }))

    await waitFor(() =>
      expect(importSources).toHaveBeenCalledWith(
        [{ url: 'https://pnwchords.com/song' }],
        expect.objectContaining({ targetSessionId: 'session-1' })
      )
    )
    expect(navigate).toHaveBeenCalledWith('/session/session-1?song=3')
  })

  it('does not show the empty state underneath a search error', async () => {
    vi.mocked(searchApi).mockRejectedValue(new Error('Search unavailable'))

    render(
      <MemoryRouter initialEntries={['/search']}>
        <SearchPage />
      </MemoryRouter>
    )

    const input = screen.getByPlaceholderText(/Goodness of God, Hallelujah, Holy Forever/)
    fireEvent.change(input, { target: { value: 'Good Grace' } })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => expect(screen.getByText('Search unavailable')).toBeTruthy())
    expect(screen.queryByText(/No matching songs found/)).toBeNull()
  })

  it('creates a new session when no target session is supplied', async () => {
    vi.mocked(importSources).mockResolvedValue({
      session: { id: 'new-session', createdAt: 0, name: 'New Set', songs: [] },
      items: [],
      imported: 1,
      attempted: 1,
      firstNewIndex: 0,
      failures: [],
    })

    render(
      <MemoryRouter initialEntries={['/search']}>
        <SearchPage />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Paste links' }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'https://pnwchords.com/song' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Extract and open' }))

    await waitFor(() =>
      expect(importSources).toHaveBeenCalledWith(
        [{ url: 'https://pnwchords.com/song' }],
        expect.objectContaining({ targetSessionId: undefined })
      )
    )
    expect(navigate).toHaveBeenCalledWith('/session/new-session')
  })
})
