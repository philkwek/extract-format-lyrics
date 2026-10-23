// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SessionPage from '../../src/pages/SessionPage'
import { ChromeVisibilityContext } from '../../src/lib/chromeVisibility'

const fixtures = vi.hoisted(() => {
  const song = {
    id: 'song-1',
    title: 'Great Are You Lord',
    artist: 'All Sons & Daughters',
    sourceUrl: 'https://example.test/great-are-you-lord',
    sourceSite: 'Demo',
    originalKey: 'G',
    sections: [
      {
        type: 'Verse',
        label: 'Verse 1',
        lines: [
          { kind: 'lyric', text: 'You give life, You are love', chords: [{ chord: 'G', pos: 0 }] },
        ],
      },
    ],
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
    expect(screen.getByRole('button', { name: 'Fit' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /exit full screen/i }))

    expect(screen.getByTestId('chrome-hidden').textContent).toBe('false')
    expect(screen.getByRole('button', { name: /share set/i })).toBeTruthy()
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

    fireEvent.click(await screen.findByRole('button', { name: 'Edit chords' }))
    expect(screen.getByText(/Chord editing active/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /full screen/i }))

    expect(screen.queryByText(/Chord editing active/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit chords' })).toBeNull()
  })
})
