// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HomePage from '../../src/pages/HomePage'
import * as recentLyricsStore from '../../src/lib/recentLyricsStore'
import * as sessionStoreModule from '../../src/lib/sessionStore'
import { getLiveShare } from '../../src/lib/liveShareSync'
import { searchApiStream } from '../../src/lib/api'

vi.mock('../../src/lib/liveShareSync', () => ({
  getLiveShare: vi.fn(async () => null),
  subscribeLiveShare: vi.fn(() => () => {}),
  subscribeLiveShareStatus: vi.fn(() => () => {}),
}))

vi.mock('../../src/lib/api', async () => ({
  ...(await vi.importActual<typeof import('../../src/lib/api')>('../../src/lib/api')),
  searchApiStream: vi.fn(),
}))

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

describe('HomePage live set cards', () => {
  const base = { createdAt: 0, songs: [] }

  it('tells live sets and shared sets from normal sets', async () => {
    vi.mocked(getLiveShare).mockImplementation(
      async (id: string) => (id === 'host' ? ({ url: 'u' } as never) : null),
    )
    vi.spyOn(sessionStoreModule.sessionStore, 'getAllSessions').mockResolvedValue([
      { ...base, id: 'f', name: 'Followed', liveSourceId: 'live-1' },
      { ...base, id: 'host', name: 'Hosted' },
      { ...base, id: 'n', name: 'Normal' },
    ] as never)

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    )

    expect(await screen.findByText('Live set')).toBeTruthy()
    expect(await screen.findByText('Sharing live')).toBeTruthy()
    expect(screen.getAllByText('Live set')).toHaveLength(1)
    expect(screen.getAllByText('Sharing live')).toHaveLength(1)
  })

  it('marks a live set the host has ended', async () => {
    vi.spyOn(sessionStoreModule.sessionStore, 'getAllSessions').mockResolvedValue([
      { ...base, id: 'f', name: 'Followed', liveSourceId: 'live-1', liveEnded: 'stopped' },
    ] as never)

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    )

    expect(await screen.findByText('Live set ended')).toBeTruthy()
    expect(screen.queryByText('Live set')).toBeNull()
  })
})

describe('HomePage set card actions', () => {
  const base = { createdAt: 0, songs: [] }

  it('asks before deleting a set', async () => {
    vi.spyOn(sessionStoreModule.sessionStore, 'getAllSessions').mockResolvedValue([
      { ...base, id: 'n', name: 'Normal' },
    ] as never)
    const del = vi.spyOn(sessionStoreModule.sessionStore, 'deleteSession').mockResolvedValue()

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    )

    fireEvent.click(await screen.findByLabelText('Delete session'))
    expect(del).not.toHaveBeenCalled()
    expect(await screen.findByText('"Normal" will be deleted. You can undo for 5 seconds.')).toBeTruthy()
    expect(del).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(del).not.toHaveBeenCalled()
  })

  it('keeps the set when delete is cancelled', async () => {
    vi.spyOn(sessionStoreModule.sessionStore, 'getAllSessions').mockResolvedValue([
      { ...base, id: 'n', name: 'Normal' },
    ] as never)
    const del = vi.spyOn(sessionStoreModule.sessionStore, 'deleteSession').mockResolvedValue()

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    )

    fireEvent.click(await screen.findByLabelText('Delete session'))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(del).not.toHaveBeenCalled()
  })

  it('does not let a live set be renamed', async () => {
    vi.spyOn(sessionStoreModule.sessionStore, 'getAllSessions').mockResolvedValue([
      { ...base, id: 'f', name: 'Followed', liveSourceId: 'live-1' },
      { ...base, id: 'n', name: 'Normal' },
    ] as never)

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    )

    await screen.findByText('Followed')
    expect(screen.getAllByLabelText('Rename set')).toHaveLength(1)
  })
})

describe('HomePage undoable set deletion', () => {
  const stored = { createdAt: 0, songs: [], id: 'n', name: 'Normal' }

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  async function openDialog() {
    vi.spyOn(sessionStoreModule.sessionStore, 'getAllSessions').mockResolvedValue([
      stored,
    ] as never)
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    )
    fireEvent.click(await screen.findByLabelText('Delete session'))
    await screen.findByRole('heading', { name: 'Delete this set?' })
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => {})
  }

  it('hides the set but does not delete it for 5 seconds', async () => {
    const del = vi.spyOn(sessionStoreModule.sessionStore, 'deleteSession').mockResolvedValue()
    await openDialog()

    expect(screen.queryByRole('link', { name: /Normal/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
    expect(del).not.toHaveBeenCalled()
  })

  it('Undo brings the set back and never deletes', async () => {
    const del = vi.spyOn(sessionStoreModule.sessionStore, 'deleteSession').mockResolvedValue()
    await openDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await act(async () => {})
    expect(screen.getByRole('link', { name: /Normal/ })).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(10000)
    })
    expect(del).not.toHaveBeenCalled()
  })

  it('deletes after 5 seconds', async () => {
    const del = vi.spyOn(sessionStoreModule.sessionStore, 'deleteSession').mockResolvedValue()
    await openDialog()
    expect(del).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(del).toHaveBeenCalledWith('n')
  })
})

describe('HomePage song tray', () => {
  beforeEach(() => {
    vi.spyOn(sessionStoreModule.sessionStore, 'getAllSessions').mockResolvedValue([])
  })

  it('says Limit reached on cards that no longer fit once the tray holds 30 songs', async () => {
    const candidate = (n: number) => ({
      site: 'pnwchords' as const,
      title: `Song ${n}`,
      artist: `Artist ${n}`,
      url: `https://pnwchords.com/song-${n}`,
    })
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    )
    const input = screen.getByPlaceholderText(/e\.g\. Goodness/)

    // One search shows at most 8 cards, so fill the tray over four searches.
    for (let page = 0; page < 4; page += 1) {
      vi.mocked(searchApiStream).mockResolvedValue({
        query: `song ${page}`,
        results: Array.from({ length: 8 }, (_, i) => candidate(page * 8 + i + 1)),
        sources: [],
        partial: false,
      })
      fireEvent.change(input, { target: { value: `song ${page}` } })
      fireEvent.submit(input.closest('form')!)
      await waitFor(() => expect(screen.getByText(`Song ${page * 8 + 1}`)).toBeTruthy())
      for (const button of screen.queryAllByRole('button', { name: /^Add (multiple songs|to set)$/ })) {
        if (!(button as HTMLButtonElement).disabled) fireEvent.click(button)
      }
    }

    expect(screen.getAllByRole('button', { name: 'Limit reached' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Added' })).toHaveLength(6)
  })
})
