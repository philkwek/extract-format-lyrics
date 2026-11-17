// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SearchPage from '../../src/pages/SearchPage'
import { searchApiStream } from '../../src/lib/api'
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
  searchApiStream: vi.fn(),
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
      outcomes: [],
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

  it('builds one new set from several picked songs, in tray order', async () => {
    const candidate = (n: number) => ({
      site: 'pnwchords' as const,
      title: `Song ${n}`,
      artist: `Artist ${n}`,
      url: `https://pnwchords.com/song-${n}`,
    })
    vi.mocked(searchApiStream).mockResolvedValue({
      query: 'song',
      results: [candidate(1), candidate(2)],
      sources: [],
      partial: false,
    })
    vi.mocked(importSources).mockResolvedValue({
      session: { id: 'new-set', createdAt: 0, name: 'New', songs: [] },
      items: [],
      outcomes: [],
      imported: 2,
      attempted: 2,
      firstNewIndex: 0,
      failures: [],
    })

    render(
      <MemoryRouter initialEntries={['/search']}>
        <SearchPage />
      </MemoryRouter>
    )
    const input = screen.getByPlaceholderText(/Goodness of God, Hallelujah, Holy Forever/)
    fireEvent.change(input, { target: { value: 'song' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Add multiple songs' })).toHaveLength(2))
    expect(screen.queryByRole('region', { name: 'Songs for your new set' })).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: 'Add multiple songs' })[1])
    expect(screen.queryAllByRole('button', { name: 'Start now' })).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Add to set' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move Song 2 up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create set' }))

    await waitFor(() => expect(importSources).toHaveBeenCalledTimes(1))
    const [sources, options] = vi.mocked(importSources).mock.calls[0]
    expect(sources.map((source) => source.title)).toEqual(['Song 2', 'Song 1'])
    expect(options).toEqual(expect.objectContaining({ requireAll: true }))
    expect(options?.targetSessionId).toBeUndefined()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/session/new-set'))
  })

  it('lets a removed tray song be undone from the toast', async () => {
    vi.mocked(searchApiStream).mockResolvedValue({
      query: 'song',
      results: [
        { site: 'pnwchords', title: 'Song 1', artist: 'Artist 1', url: 'https://pnwchords.com/s1' },
        { site: 'pnwchords', title: 'Song 2', artist: 'Artist 2', url: 'https://pnwchords.com/s2' },
      ],
      sources: [],
      partial: false,
    })
    render(
      <MemoryRouter initialEntries={['/search']}>
        <SearchPage />
      </MemoryRouter>
    )
    const input = screen.getByPlaceholderText(/Goodness of God, Hallelujah, Holy Forever/)
    fireEvent.change(input, { target: { value: 'song' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Add multiple songs' })).toHaveLength(2))
    for (const button of screen.getAllByRole('button', { name: 'Add multiple songs' })) fireEvent.click(button)

    fireEvent.click(screen.getByRole('button', { name: 'Remove Song 1' }))
    expect(screen.queryByRole('button', { name: 'Remove Song 1' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('button', { name: 'Remove Song 1' })).toBeTruthy()
  })

  it('says Limit reached on cards that no longer fit once the tray holds 30 songs', async () => {
    const candidate = (n: number) => ({
      site: 'pnwchords' as const,
      title: `Song ${n}`,
      artist: `Artist ${n}`,
      url: `https://pnwchords.com/song-${n}`,
    })
    render(
      <MemoryRouter initialEntries={['/search']}>
        <SearchPage />
      </MemoryRouter>
    )
    const input = screen.getByPlaceholderText(/Goodness of God, Hallelujah, Holy Forever/)

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
    for (const button of screen.getAllByRole('button', { name: 'Limit reached' })) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
    expect(screen.getByText(/^Sets made here hold up to 30 songs/, { selector: 'p[role=status]' })).toBeTruthy()
  })

  it('does not show the empty state underneath a search error', async () => {
    vi.mocked(searchApiStream).mockRejectedValue(new Error('Search unavailable'))

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

  it('shows and keeps partial results selectable while another source is pending', async () => {
    let resolveSearch!: (value: {
      query: string
      results: never[]
      sources: never[]
      partial: boolean
    }) => void
    vi.mocked(searchApiStream).mockImplementation(async (_query, options) => {
      options?.onSource?.({
        site: 'pnwchords',
        status: 'ok',
        count: 1,
        durationMs: 5,
        candidates: [
          {
            site: 'pnwchords',
            title: 'Good Grace',
            artist: 'Hillsong Worship',
            url: 'https://pnwchords.com/good-grace',
          },
        ],
      })
      return new Promise((resolve) => {
        resolveSearch = resolve
      })
    })

    render(
      <MemoryRouter initialEntries={['/search']}>
        <SearchPage />
      </MemoryRouter>
    )

    const input = screen.getByPlaceholderText(/Goodness of God, Hallelujah, Holy Forever/)
    fireEvent.change(input, { target: { value: 'Good Grace' } })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => expect(screen.getByText('Good Grace')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Start now' })).toBeTruthy()
    expect(screen.getByText(/Checking remaining sources/)).toBeTruthy()

    resolveSearch({ query: 'Good Grace', results: [], sources: [], partial: false })
  })

  it('does not let a superseded search replace newer results', async () => {
    let resolveFirst!: (value: {
      query: string
      results: Array<{ site: string; title: string; artist: string; url: string }>
      sources: never[]
      partial: boolean
    }) => void
    let firstSignal: AbortSignal | undefined
    vi.mocked(searchApiStream).mockImplementation((query, options) => {
      if (query === 'first') {
        firstSignal = options?.signal
        return new Promise((resolve) => {
          resolveFirst = resolve
        })
      }
      return Promise.resolve({
        query: 'second',
        results: [
          {
            site: 'pnwchords',
            title: 'Second Song',
            artist: 'Artist',
            url: 'https://pnwchords.com/second',
          },
        ],
        sources: [],
        partial: false,
      })
    })

    render(
      <MemoryRouter initialEntries={['/search']}>
        <SearchPage />
      </MemoryRouter>
    )

    const input = screen.getByPlaceholderText(/Goodness of God, Hallelujah, Holy Forever/)
    fireEvent.change(input, { target: { value: 'first' } })
    fireEvent.submit(input.closest('form')!)
    fireEvent.change(input, { target: { value: 'second' } })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => expect(screen.getByText('Second Song')).toBeTruthy())
    expect(firstSignal?.aborted).toBe(true)

    resolveFirst({
      query: 'first',
      results: [
        {
          site: 'pnwchords',
          title: 'First Song',
          artist: 'Artist',
          url: 'https://pnwchords.com/first',
        },
      ],
      sources: [],
      partial: false,
    })
    await waitFor(() => expect(screen.queryByText('First Song')).toBeNull())
    expect(screen.getByText('Second Song')).toBeTruthy()
  })

  it('distinguishes unavailable sources from a genuine empty result', async () => {
    vi.mocked(searchApiStream).mockResolvedValueOnce({
      query: 'missing',
      results: [],
      sources: [
        {
          site: 'ultimate-guitar',
          status: 'failed',
          count: 0,
          durationMs: 5,
          failure: 'timeout',
        },
      ],
      partial: true,
    })

    const { unmount } = render(
      <MemoryRouter initialEntries={['/search']}>
        <SearchPage />
      </MemoryRouter>
    )
    const input = screen.getByPlaceholderText(/Goodness of God, Hallelujah, Holy Forever/)
    fireEvent.change(input, { target: { value: 'missing' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(screen.getByText(/Search sources are unavailable/)).toBeTruthy())
    unmount()

    vi.mocked(searchApiStream).mockResolvedValueOnce({
      query: 'empty',
      results: [],
      sources: [{ site: 'pnwchords', status: 'empty', count: 0, durationMs: 5 }],
      partial: false,
    })
    render(
      <MemoryRouter initialEntries={['/search']}>
        <SearchPage />
      </MemoryRouter>
    )
    const nextInput = screen.getByPlaceholderText(/Goodness of God, Hallelujah, Holy Forever/)
    fireEvent.change(nextInput, { target: { value: 'empty' } })
    fireEvent.submit(nextInput.closest('form')!)
    await waitFor(() => expect(screen.getByText(/No matching songs found/)).toBeTruthy())
  })

  it('creates a new session when no target session is supplied', async () => {
    vi.mocked(importSources).mockResolvedValue({
      session: { id: 'new-session', createdAt: 0, name: 'New Set', songs: [] },
      items: [],
      outcomes: [],
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
