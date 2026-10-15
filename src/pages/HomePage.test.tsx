// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HomePage from './HomePage'
import * as recentLyricsStore from '../lib/recentLyricsStore'
import * as sessionStoreModule from '../lib/sessionStore'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
  window.scrollTo = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HomePage recent shared lyrics', () => {
  beforeEach(async () => {
    recentLyricsStore.resetRecentLyricsStore()
    await recentLyricsStore.clearRecentSharedLyrics()
    vi.spyOn(sessionStoreModule.sessionStore, 'getAllSessions').mockResolvedValue([])
  })

  it('renders recently opened shared lyrics and navigates on click', async () => {
    await recentLyricsStore.saveRecentSharedLyrics(
      'lyrics-123',
      {
        v: 1,
        name: 'Easter Sunday Set',
        songs: [
          {
            entryId: 'e1',
            title: 'Christ Is Risen',
            sections: [{ label: 'Verse 1', lines: ['Line 1'] }],
          },
        ],
      },
      new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    )

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Recent shared lyrics')).toBeTruthy()
      expect(screen.getByText('Easter Sunday Set')).toBeTruthy()
      expect(screen.getByText(/1 song · Opened/i)).toBeTruthy()
    })

    const card = screen.getByText('Easter Sunday Set').closest('article')
    expect(card).toBeTruthy()
    fireEvent.click(card!)

    expect(mockNavigate).toHaveBeenCalledWith('/lyrics/lyrics-123')
  })

  it('removes a shared lyrics set from recent list on trash click', async () => {
    await recentLyricsStore.saveRecentSharedLyrics(
      'lyrics-to-remove',
      {
        v: 1,
        name: 'Temporary Set',
        songs: [],
      },
      new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    )

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Temporary Set')).toBeTruthy()
    })

    const removeBtn = screen.getByRole('button', { name: /Remove from recent lyrics/i })
    fireEvent.click(removeBtn)

    await waitFor(() => {
      expect(screen.queryByText('Temporary Set')).toBeNull()
      expect(screen.queryByText('Recent shared lyrics')).toBeNull()
    })
  })
})
