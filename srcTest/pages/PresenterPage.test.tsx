// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import PresenterPage from '../../src/pages/PresenterPage'
import { trackEvent } from '../../src/lib/analytics'
import type { PresenterFeedState } from '../../src/lib/usePresenterFeed'
import type { SharedLyricsPayload } from '../../src/types/song'

const feed = vi.hoisted(() => ({
  current: { status: 'loading', lyrics: null, currentEntryId: null } as PresenterFeedState,
}))

vi.mock('../../src/lib/usePresenterFeed', () => ({
  usePresenterFeed: () => feed.current,
}))

vi.mock('../../src/lib/analytics', async () => ({
  ...(await vi.importActual('../../src/lib/analytics')),
  trackEvent: vi.fn(),
}))

const lyrics: SharedLyricsPayload = {
  v: 1,
  name: 'Sunday Morning Set',
  songs: [
    {
      entryId: 'entry-1',
      title: 'First Song',
      sections: [{ label: 'Verse 1', lines: ['First line'] }],
    },
    {
      entryId: 'entry-2',
      title: 'Second Song',
      sections: [{ label: 'Chorus', lines: ['Second line'] }],
    },
  ],
}

function live(currentEntryId: string | null = 'entry-1'): PresenterFeedState {
  return { status: 'live', lyrics, currentEntryId }
}

function installMatchMedia(wide: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query === '(min-width: 1024px)' ? wide : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

function renderPage(id = 'pub-123') {
  return render(
    <MemoryRouter initialEntries={[`/present/${id}`]}>
      <Routes>
        <Route path="/present/:id" element={<PresenterPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const originalMatchMedia = window.matchMedia

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  feed.current = { status: 'loading', lyrics: null, currentEntryId: null }
  installMatchMedia(true)
  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  })
  Object.defineProperty(document, 'exitFullscreen', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  })
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  window.matchMedia = originalMatchMedia
  document.documentElement.classList.remove('dark')
  vi.restoreAllMocks()
})

describe('PresenterPage', () => {
  it('shows only the bigger-screen notice on a narrow screen', () => {
    localStorage.setItem('presenter.mode', 'auto')
    feed.current = live()
    installMatchMedia(false)

    renderPage()

    expect(screen.getByRole('heading', { name: 'Open this on a bigger screen' })).toBeTruthy()
    expect(screen.getByText(/Presenter view is for sharing lyrics/)).toBeTruthy()
    expect(screen.queryByText('How should this screen work?')).toBeNull()
    expect(screen.queryByText('First Song')).toBeNull()
  })

  it('asks for a mode when none is stored and saves the choice', async () => {
    feed.current = live('entry-2')

    renderPage()

    expect(screen.getByRole('heading', { name: 'How should this screen work?' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Follow the host/ }))

    expect(localStorage.getItem('presenter.mode')).toBe('auto')
    expect(screen.getByText('Second Song')).toBeTruthy()
    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith('presenter_opened', { mode: 'auto' }),
    )
  })

  it('shows the host song and falls back to the first song', () => {
    localStorage.setItem('presenter.mode', 'auto')
    feed.current = live('entry-2')

    renderPage()

    expect(screen.getByText('Second Song')).toBeTruthy()
    expect(screen.getByText('Chorus')).toBeTruthy()
    expect(screen.queryByText('First Song')).toBeNull()

    cleanup()
    feed.current = live('missing-entry')
    renderPage()

    expect(screen.getByText('First Song')).toBeTruthy()
    expect(screen.getByText('Verse 1')).toBeTruthy()
  })

  it('keeps lyrics and says the connection was lost', () => {
    localStorage.setItem('presenter.mode', 'auto')
    feed.current = { status: 'lost', lyrics, currentEntryId: 'entry-1' }

    renderPage()

    expect(screen.getByText('Not live: Lost connection')).toBeTruthy()
    expect(screen.getByText('First Song')).toBeTruthy()
    expect(screen.getByText('First line')).toBeTruthy()
  })

  it('shows a stopped message without lyrics', () => {
    localStorage.setItem('presenter.mode', 'auto')
    feed.current = { status: 'stopped', lyrics: null, currentEntryId: null }

    renderPage()

    expect(screen.getByText('Not live: Sharing stopped')).toBeTruthy()
    expect(screen.queryByText('First Song')).toBeNull()
    expect(screen.queryByText('First line')).toBeNull()
  })

  it('explains a missing presenter link', () => {
    localStorage.setItem('presenter.mode', 'auto')
    feed.current = { status: 'missing', lyrics: null, currentEntryId: null }

    renderPage()

    expect(
      screen.getByRole('heading', { name: "This presenter link isn't available" }),
    ).toBeTruthy()
    expect(screen.getByText(/Ask the host for a new link/)).toBeTruthy()
    expect(screen.queryByText(/^Not live:/)).toBeNull()
  })

  it('toggles full screen from the F key', () => {
    localStorage.setItem('presenter.mode', 'auto')
    feed.current = live()

    renderPage()
    fireEvent.keyDown(document, { key: 'f' })

    expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1)
  })

  it('persists the All caps setting from the settings popover', async () => {
    localStorage.setItem('presenter.mode', 'auto')
    feed.current = live()

    renderPage()
    fireEvent.mouseMove(window)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('tab', { name: 'All caps' }))

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('presenter.display') ?? '{}').caps).toBe(true)
    })
  })

  it('switches to manual control and remembers it', () => {
    localStorage.setItem('presenter.mode', 'auto')
    feed.current = live()

    renderPage()
    fireEvent.mouseMove(window)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Switch to manual control' }))

    expect(localStorage.getItem('presenter.mode')).toBe('manual')
    expect(screen.getByText('Presenter · Sunday Morning Set')).toBeTruthy()
    expect(trackEvent).toHaveBeenCalledWith('presenter_mode_switched', { mode: 'manual' })
  })

  it('restores the html dark class on unmount', async () => {
    document.documentElement.classList.add('dark')
    localStorage.setItem('presenter.mode', 'auto')
    localStorage.setItem('presenter.display', JSON.stringify({ theme: 'light' }))
    feed.current = live()

    const { unmount } = renderPage()

    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false))
    unmount()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('hides the corner controls 500ms after closing settings even when the button was focused', () => {
    vi.useFakeTimers()
    localStorage.setItem('presenter.mode', 'auto')
    feed.current = live()

    renderPage()
    fireEvent.mouseMove(window)

    const settingsButton = screen.getByRole('button', { name: 'Settings' })
    const corner = settingsButton.closest('div.fixed')
    expect(corner?.className).toContain('opacity-100')

    settingsButton.focus()
    fireEvent.click(settingsButton)
    expect(screen.getByRole('dialog', { name: 'Display settings' })).toBeTruthy()

    fireEvent.click(settingsButton)
    expect(screen.queryByRole('dialog', { name: 'Display settings' })).toBeNull()

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(corner?.className).toContain('opacity-0')
    expect(corner?.className).toContain('pointer-events-none')
  })

  it('keeps corner controls visible while hovered and hides 500ms after mouse leave', () => {
    vi.useFakeTimers()
    localStorage.setItem('presenter.mode', 'auto')
    feed.current = live()

    renderPage()
    fireEvent.mouseMove(window)

    const corner = screen.getByRole('button', { name: 'Settings' }).closest('div.fixed')!
    fireEvent.mouseEnter(corner)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(corner.className).toContain('opacity-100')

    fireEvent.mouseLeave(corner)
    act(() => {
      vi.advanceTimersByTime(499)
    })
    expect(corner.className).toContain('opacity-100')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(corner.className).toContain('opacity-0')
    expect(corner.className).toContain('pointer-events-none')
  })
})
