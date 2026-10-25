// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SessionPage from '../../src/pages/SessionPage'
import { ChromeVisibilityContext } from '../../src/lib/chromeVisibility'

const fixtures = vi.hoisted(() => {
  const sections = [
    {
      type: 'Verse',
      label: 'Verse 1',
      lines: [
        { kind: 'lyric', text: 'You give life, You are love', chords: [{ chord: 'G', pos: 0 }] },
      ],
    },
  ]

  const song = {
    id: 'song-1',
    title: 'Great Are You Lord',
    artist: 'All Sons & Daughters',
    sourceUrl: 'https://example.test/great-are-you-lord',
    sourceSite: 'Demo',
    originalKey: 'G',
    sections,
    simplifiedSections: sections,
    simplifiedSource: 'algorithmic',
  }

  const session = {
    id: 'session-1',
    createdAt: 0,
    name: 'Sunday Set',
    songs: [
      {
        entryId: 'entry-1',
        url: song.sourceUrl,
        title: song.title,
        artist: song.artist,
        status: 'ok',
      },
    ],
  }

  return { song, session }
})

vi.mock('../../src/lib/sessionStore', () => ({
  sessionStore: {
    getSession: vi.fn(async () => fixtures.session),
    updateSession: vi.fn(),
    removeSongFromSession: vi.fn(),
    reorderSongsInSession: vi.fn(),
    renameSession: vi.fn(),
  },
  makeEntryId: () => 'entry-2',
}))

vi.mock('../../src/lib/songCache', () => ({
  songCache: {
    getSong: vi.fn(async () => fixtures.song),
    saveSong: vi.fn(async () => undefined),
  },
}))

vi.mock('../../src/lib/api', () => ({
  scrapeApi: vi.fn(),
  simplifyApi: vi.fn(),
}))

vi.mock('../../src/lib/useThemeMode', () => ({
  useThemeMode: () => ({
    mode: 'light',
    isDark: false,
    setMode: vi.fn(),
    cycleMode: vi.fn(),
  }),
}))

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function TestHarness() {
  const [chromeHidden, setChromeHidden] = useState(false)
  return (
    <ChromeVisibilityContext.Provider value={{ hidden: chromeHidden, setHidden: setChromeHidden }}>
      <MemoryRouter initialEntries={['/session/session-1']}>
        <Routes>
          <Route path="/session/:sessionId" element={<SessionPage />} />
        </Routes>
      </MemoryRouter>
      <output data-testid="chrome-hidden">{String(chromeHidden)}</output>
    </ChromeVisibilityContext.Provider>
  )
}

describe('SessionPage full screen mode', () => {
  it('enters full screen, hides set management, and exits with the button', async () => {
    render(<TestHarness />)

    const fullScreenButton = await screen.findByRole('button', { name: /full screen/i })
    fireEvent.click(fullScreenButton)

    expect(screen.getByTestId('chrome-hidden').textContent).toBe('true')
    expect(screen.queryByRole('button', { name: /share set/i })).toBeNull()
    expect(screen.queryByText('1 song(s) in setlist')).toBeNull()
    expect(screen.getByRole('button', { name: /exit full screen/i })).toBeTruthy()
    expect(screen.queryByText('Original key')).toBeNull()
    expect(screen.getByRole('button', { name: /play ambient pad/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Auto' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Simplify' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Simplified' })).toBeTruthy()
    })

    const customiseButton = screen.getByRole('button', {
      name: /customise song sheet display/i,
    })
    expect(customiseButton.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(customiseButton)
    expect(customiseButton.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'Auto' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '4' })).toBeTruthy()

    fireEvent.click(customiseButton)
    expect(customiseButton.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Auto' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /exit full screen/i }))

    expect(screen.getByTestId('chrome-hidden').textContent).toBe('false')
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit Set' })).toBeTruthy()
  })

  it('groups set sharing behind one Share modal with both link generators', async () => {
    render(<TestHarness />)

    fireEvent.click(await screen.findByRole('button', { name: 'Share' }))

    expect(await screen.findByText('Share this set')).toBeTruthy()
    expect(screen.getByText('Share lyrics')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Generate link' })).toHaveLength(2)
  })

  it('layers the lyrics preview over Share and returns to Share when closed', async () => {
    render(<TestHarness />)

    fireEvent.click(await screen.findByRole('button', { name: 'Share' }))
    fireEvent.click(await screen.findByRole('button', { name: 'See Preview' }))

    expect(screen.getByRole('heading', { name: /\(Preview\) Sunday Set/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Share .*Sunday Set/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close Preview' }))

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /\(Preview\) Sunday Set/ })).toBeNull()
    })
    expect(screen.getByRole('heading', { name: /Share .*Sunday Set/ })).toBeTruthy()
  })

  it('groups arrange, add song and upload under Edit Set', async () => {
    render(<TestHarness />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Set' }))

    expect(screen.getByRole('heading', { name: 'Edit set' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Search' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Paste links' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Upload sheet' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Arrange setlist' })).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Upload sheet' }))
    expect(screen.getByRole('button', { name: /Extract with Gemini/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Arrange setlist' }))
    const arrangeHeading = await screen.findByRole('heading', { name: 'Arrange Setlist' })
    expect(screen.getByRole('heading', { name: 'Edit set' })).toBeTruthy()

    const arrangeDialog = arrangeHeading.closest('[role="dialog"]') as HTMLElement
    expect(arrangeDialog).toBeTruthy()
    fireEvent.click(within(arrangeDialog).getByRole('button', { name: 'Done' }))

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Arrange Setlist' })).toBeNull()
    })
    expect(screen.getByRole('heading', { name: 'Edit set' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Upload sheet' }).getAttribute('aria-selected')).toBe(
      'true'
    )
  })

  it('exits full screen with Escape', async () => {
    render(<TestHarness />)

    fireEvent.click(await screen.findByRole('button', { name: /full screen/i }))
    expect(screen.getByTestId('chrome-hidden').textContent).toBe('true')

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.getByTestId('chrome-hidden').textContent).toBe('false')
    })
  })

  it('closes chord editing when entering full screen', async () => {
    render(<TestHarness />)

    expect(await screen.findByRole('button', { name: 'Edit chords' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Edit chords' }))
    expect(screen.getByText(/Chord editing active/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /full screen/i }))

    expect(screen.queryByText(/Chord editing active/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit chords' })).toBeNull()
  })
})
