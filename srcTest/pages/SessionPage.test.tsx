// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import SessionPage from '../../src/pages/SessionPage'
import { ChromeVisibilityContext } from '../../src/lib/chromeVisibility'
import { sessionStore } from '../../src/lib/sessionStore'
import { simplifyApi } from '../../src/lib/api'
import { songCache } from '../../src/lib/songCache'
import { loadSetLinkPreview, savePreviewAsNew } from '../../src/lib/setLinkImport'
import {
  followLiveSet,
  type FollowHandlers,
} from '../../src/lib/liveFollow'

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
      },
    ],
  }

  return { song, session }
})

vi.mock('../../src/lib/sessionStore', () => ({
  sessionPath: (s: { id: string; publicId?: string }) => `/session/${s.publicId ?? s.id}`,
  sessionStore: {
    getSession: vi.fn(async () => fixtures.session),
    updateSession: vi.fn(),
    removeSongFromSession: vi.fn(),
    reorderSongsInSession: vi.fn(),
    renameSession: vi.fn(),
    createSession: vi.fn(),
    createSetCopy: vi.fn(),
    dismissImportFailures: vi.fn(),
    findByImportedLinkId: vi.fn(),
    replaceSongsFromLink: vi.fn(),
  },
  makeEntryId: () => 'entry-2',
}))

vi.mock('../../src/lib/setLinkSync', () => ({
  ensureSetLinkFresh: vi.fn(async () => undefined),
}))

vi.mock('../../src/lib/liveShareSync', () => ({
  getLiveShare: vi.fn(async () => null),
  subscribeLiveShare: vi.fn(() => () => {}),
  subscribeLiveShareStatus: vi.fn(() => () => {}),
}))

vi.mock('../../src/lib/liveFollow', () => ({
  followLiveSet: vi.fn(),
}))

vi.mock('../../src/lib/setLinkImport', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/setLinkImport')>(
    '../../src/lib/setLinkImport',
  )
  return {
    loadSetLinkPreview: vi.fn(),
    savePreviewAsNew: vi.fn(),
    diffLinkSnapshot: actual.diffLinkSnapshot,
  }
})

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

function LocationProbe() {
  const loc = useLocation()
  return <output data-testid="loc">{loc.pathname}</output>
}

function NavProbe() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate('/session/session-2')}>
      Open second set
    </button>
  )
}

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
  let originalScrollTo: typeof window.scrollTo

  beforeEach(() => {
    originalScrollTo = window.scrollTo
    window.scrollTo = vi.fn()
  })

  afterEach(() => {
    window.scrollTo = originalScrollTo
    cleanup()
    localStorage.clear()
  })

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
    expect(screen.getByRole('button', { name: 'Add Song' })).toBeTruthy()
  })

  it('groups set sharing behind one Share modal with both share options', async () => {
    render(<TestHarness />)

    fireEvent.click(await screen.findByRole('button', { name: 'Share' }))

    expect(await screen.findByText('Share this set')).toBeTruthy()
    expect(screen.getByText('Share lyrics')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Send a copy' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Generate link' })).toBeTruthy()
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

  it('Add Song opens the add-song modal', async () => {
    render(<TestHarness />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Song' }))

    const heading = screen.getByRole('heading', { name: 'Add song' })
    expect(heading).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Search' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Paste links' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Upload sheet' })).toBeTruthy()

    const dialog = heading.closest('[role="dialog"]') as HTMLElement
    expect(dialog).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Arrange setlist' })).toBeNull()
  })

  it('does not show Arrange setlist with a single song', async () => {
    render(<TestHarness />)

    await screen.findByRole('button', { name: 'Add Song' })

    expect(screen.queryByRole('button', { name: 'Arrange setlist' })).toBeNull()
  })

  it('Arrange setlist on the song-tab row opens the drawer', async () => {
    const twoSongSession = {
      ...fixtures.session,
      songs: [
        {
          entryId: 'entry-a',
          url: 'https://example.test/broken',
        },
        { ...fixtures.session.songs[0], entryId: 'entry-b' },
      ],
    }
    vi.mocked(sessionStore.getSession).mockResolvedValue(twoSongSession as never)

    try {
      render(<TestHarness />)

      fireEvent.click(await screen.findByRole('button', { name: 'Arrange setlist' }))

      const arrangeHeading = await screen.findByRole('heading', { name: 'Arrange Setlist' })
      const arrangeDialog = arrangeHeading.closest('[role="dialog"]') as HTMLElement
      expect(arrangeDialog).toBeTruthy()

      fireEvent.click(within(arrangeDialog).getByRole('button', { name: 'Done' }))

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: 'Arrange Setlist' })).toBeNull()
      })
    } finally {
      vi.mocked(sessionStore.getSession).mockImplementation(async () => fixtures.session as never)
    }
  })

  it('hides Arrange setlist in full screen', async () => {
    const twoSongSession = {
      ...fixtures.session,
      songs: [
        {
          entryId: 'entry-a',
          url: 'https://example.test/broken',
        },
        { ...fixtures.session.songs[0], entryId: 'entry-b' },
      ],
    }
    vi.mocked(sessionStore.getSession).mockResolvedValue(twoSongSession as never)

    try {
      render(<TestHarness />)

      await screen.findByRole('button', { name: 'Arrange setlist' })

      fireEvent.click(screen.getByRole('button', { name: /full screen/i }))

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Arrange setlist' })).toBeNull()
      })
    } finally {
      vi.mocked(sessionStore.getSession).mockImplementation(async () => fixtures.session as never)
    }
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

  it('saves two edits fired back-to-back in one save', async () => {
    vi.mocked(sessionStore.updateSession).mockClear()

    render(<TestHarness />)

    const select = (await screen.findAllByLabelText('Transpose song'))[0]
    const simplifyButton = screen.getByRole('button', { name: 'Simplify' })
    act(() => {
      fireEvent.change(select, { target: { value: 'A' } })
      fireEvent.click(simplifyButton)
    })

    await waitFor(() => {
      expect(sessionStore.updateSession).toHaveBeenCalledTimes(2)
    })
    const saved = vi.mocked(sessionStore.updateSession).mock.calls.at(-1)![0]
    expect(saved.songs[0].targetKey).toBe('A')
    expect(saved.songs[0].simplified).toBe(true)
  })

  it('does not restart the simplify request when the song is edited', async () => {
    const pendingSong = {
      ...fixtures.song,
      simplifiedSections: undefined,
      simplifiedSource: undefined,
      simplificationPending: true,
      sourceSite: 'ultimate-guitar',
    }
    vi.mocked(songCache.getSong).mockResolvedValue(pendingSong as never)
    vi.mocked(simplifyApi).mockReset()
    vi.mocked(simplifyApi).mockReturnValue(new Promise(() => {}))

    try {
      render(<TestHarness />)

      await waitFor(() => {
        expect(simplifyApi).toHaveBeenCalledTimes(1)
      })
      const select = (await screen.findAllByLabelText('Transpose song'))[0]
      fireEvent.change(select, { target: { value: 'A' } })
      await waitFor(() => {
        expect(sessionStore.updateSession).toHaveBeenCalledTimes(1)
      })
      fireEvent.change((await screen.findAllByLabelText('Transpose song'))[0], {
        target: { value: 'B' },
      })
      await waitFor(() => {
        expect(sessionStore.updateSession).toHaveBeenCalledTimes(2)
      })

      expect(simplifyApi).toHaveBeenCalledTimes(1)
    } finally {
      vi.mocked(songCache.getSong).mockImplementation(async () => fixtures.song as never)
    }
  })
})


describe('SessionPage floating full screen button', () => {
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
  let header: HTMLElement

  function rect(bottom: number): DOMRect {
    return {
      top: bottom - 32,
      bottom,
      left: 0,
      right: 100,
      width: 100,
      height: 32,
      x: 0,
      y: bottom - 32,
    } as DOMRect
  }

  function setTriggerBottom(bottom: number) {
    const trigger = document.querySelector<HTMLElement>('[data-fullscreen-trigger]')
    expect(trigger).toBeTruthy()
    trigger!.getBoundingClientRect = () => rect(bottom)
  }

  async function scroll() {
    await act(async () => {
      window.dispatchEvent(new Event('scroll'))
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)))
    })
  }

  let originalScrollTo: typeof window.scrollTo
  let originalScrollY: number | undefined

  beforeEach(() => {
    HTMLElement.prototype.getBoundingClientRect = function () {
      return rect(200)
    }
    header = document.createElement('header')
    header.dataset.appHeader = ''
    header.getBoundingClientRect = () => rect(63)
    document.body.prepend(header)
    originalScrollTo = window.scrollTo
    originalScrollY = window.scrollY
    window.scrollTo = vi.fn()
  })

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
    header.remove()
    window.scrollTo = originalScrollTo
    if (originalScrollY !== undefined) {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: originalScrollY })
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).scrollY
    }
    cleanup()
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('hides while full screen', async () => {
    render(<TestHarness />)
    await screen.findByRole('button', { name: 'Full screen' })
    expect(document.querySelector('[data-floating-fullscreen-trigger]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }))
    expect(screen.getByTestId('chrome-hidden').textContent).toBe('true')
    expect(document.querySelector('[data-floating-fullscreen-trigger]')).toBeNull()
  })

  it('shows once the in-page button is under the header and hides when it returns', async () => {
    render(<TestHarness />)
    await screen.findByRole('button', { name: 'Full screen' })
    expect(document.querySelector('[data-floating-fullscreen-trigger]')).toBeNull()

    setTriggerBottom(40)
    await scroll()
    await waitFor(() => {
      expect(document.querySelector('[data-floating-fullscreen-trigger]')).toBeTruthy()
    })

    setTriggerBottom(200)
    await scroll()
    await waitFor(() => {
      expect(document.querySelector('[data-floating-fullscreen-trigger]')).toBeNull()
    })
  })

  it('does not show when the button is below the viewport', async () => {
    render(<TestHarness />)
    await screen.findByRole('button', { name: 'Full screen' })

    setTriggerBottom(900)
    await scroll()
    expect(document.querySelector('[data-floating-fullscreen-trigger]')).toBeNull()
  })

  it('enters full screen from the floating button', async () => {
    render(<TestHarness />)
    await screen.findByRole('button', { name: 'Full screen' })

    setTriggerBottom(40)
    await scroll()
    await waitFor(() => {
      expect(document.querySelector('[data-floating-fullscreen-trigger]')).toBeTruthy()
    })

    fireEvent.click(document.querySelector('[data-floating-fullscreen-trigger]') as HTMLElement)
    expect(screen.getByTestId('chrome-hidden').textContent).toBe('true')
    expect(screen.getByRole('button', { name: /exit full screen/i })).toBeTruthy()
    expect(document.querySelector('[data-floating-fullscreen-trigger]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /exit full screen/i }))
    expect(screen.getByTestId('chrome-hidden').textContent).toBe('false')
    expect(document.querySelector('[data-floating-fullscreen-trigger]')).toBeNull()
    await waitFor(() =>
      expect(document.activeElement).toBe(document.querySelector('[data-fullscreen-trigger]')),
    )
  })

  it('restores scroll position on exit and focuses trigger with preventScroll', async () => {
    // Track scrollTo calls
    const scrollToCalls: [number, number][] = []
    const scrollToImpl = vi.fn()
    scrollToImpl.mockImplementation((x: number, y: number) => {
      scrollToCalls.push([x, y])
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window.scrollTo as any) = scrollToImpl

    // Spy on focus to verify preventScroll option
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')

    render(<TestHarness />)
    await screen.findByRole('button', { name: 'Full screen' })

    setTriggerBottom(40)
    await scroll()
    await waitFor(() => {
      expect(document.querySelector('[data-floating-fullscreen-trigger]')).toBeTruthy()
    })

    // Mock window.scrollY to return 800
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => 800,
    })

    // Enter full screen - this should save window.scrollY (800)
    fireEvent.click(document.querySelector('[data-floating-fullscreen-trigger]') as HTMLElement)
    expect(screen.getByTestId('chrome-hidden').textContent).toBe('true')

    // Exit full screen - this should call scrollTo
    fireEvent.click(screen.getByRole('button', { name: /exit full screen/i }))
    expect(screen.getByTestId('chrome-hidden').textContent).toBe('false')

    // Wait for the window.setTimeout to complete
    await waitFor(() => {
      expect(scrollToCalls).toEqual([[0, 800]])
    })

    // Verify scrollTo was called with correct arguments
    expect(scrollToCalls).toEqual([[0, 800]])

    // Verify focus was called with preventScroll: true
    const exitTrigger = document.querySelector<HTMLElement>('[data-fullscreen-trigger]')
    expect(exitTrigger?.focus).toHaveBeenCalledWith({ preventScroll: true })

    // Cleanup spies
    scrollToImpl.mockRestore()
    focusSpy.mockRestore()
  })

  it('uses the app header specifically and ignores a decorative header above it', async () => {
    render(<TestHarness />)
    await screen.findByRole('button', { name: 'Full screen' })

    // Add a decorative header above the app header with different bottom
    const decorativeHeader = document.createElement('header')
    decorativeHeader.getBoundingClientRect = () => rect(200)
    document.body.prepend(decorativeHeader)

    // Set trigger bottom to 100 (between app header 63 and decorative header 200)
    try {
      setTriggerBottom(100)
      await scroll()

      // The floating button should NOT appear because app header bottom is 63
      // (trigger bottom 100 > 63 means trigger is visible)
      expect(document.querySelector('[data-floating-fullscreen-trigger]')).toBeNull()
    } finally {
      decorativeHeader.remove()
    }
  })
})

const PUBLIC_ID = 'abcdefghijklmnopqrstuv'

function renderAt(entry: string | { pathname: string; state: unknown }) {
  return render(
    <ChromeVisibilityContext.Provider value={{ hidden: false, setHidden: vi.fn() }}>
      <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
        <Routes>
          <Route path="/session/:sessionId" element={<SessionPage />} />
        </Routes>
      </MemoryRouter>
    </ChromeVisibilityContext.Provider>,
  )
}

describe('SessionPage set links', () => {
  const preview = {
    linkId: PUBLIC_ID,
    name: 'Shared Sunday',
    items: [
      {
        entryId: 'entry-1',
        url: fixtures.song.sourceUrl,
        title: fixtures.song.title,
        artist: fixtures.song.artist,
      },
    ],
    failures: [],
    snapshot: [{ entryId: 'entry-1' }],
  }
  const savedCopy = {
    ...fixtures.session,
    id: 'copy-1',
    publicId: 'copypublicidcopypublic1',
    importedFromLinkId: PUBLIC_ID,
  }

  beforeEach(() => {
    vi.mocked(sessionStore.getSession).mockReset()
    vi.mocked(sessionStore.getSession).mockImplementation(async () => fixtures.session as never)
    vi.mocked(sessionStore.updateSession).mockClear()
    vi.mocked(sessionStore.createSession).mockClear()
    vi.mocked(sessionStore.dismissImportFailures).mockClear()
    vi.mocked(loadSetLinkPreview).mockReset()
    vi.mocked(sessionStore.findByImportedLinkId).mockReset()
    vi.mocked(sessionStore.findByImportedLinkId).mockResolvedValue(null)
    vi.mocked(savePreviewAsNew).mockReset()
    vi.mocked(sessionStore.replaceSongsFromLink).mockReset()
    vi.mocked(songCache.getSong).mockResolvedValue(fixtures.song as never)
  })

  function mockLinkSessions(byId: Record<string, unknown>) {
    vi.mocked(sessionStore.getSession).mockImplementation(
      async (id: string) => (id === PUBLIC_ID ? null : (byId[id] ?? null)) as never,
    )
  }

  it('shows Session not found for an unknown non-link id', async () => {
    vi.mocked(sessionStore.getSession).mockResolvedValueOnce(null)
    renderAt('/session/nope')
    expect(await screen.findByText(/Session not found/)).toBeTruthy()
    expect(loadSetLinkPreview).not.toHaveBeenCalled()
  })

  it('opens a link as a preview without saving it', async () => {
    mockLinkSessions({})
    vi.mocked(loadSetLinkPreview).mockResolvedValueOnce({ kind: 'preview', preview } as never)

    renderAt(`/session/${PUBLIC_ID}`)

    expect(
      await screen.findByText('This is a shared set. Save to keep it on your device.'),
    ).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Shared Sunday' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Great Are You Lord' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
    expect(sessionStore.updateSession).not.toHaveBeenCalled()
    expect(sessionStore.createSession).not.toHaveBeenCalled()
  })

  it('saves a preview as a new set and opens it', async () => {
    const saved = {
      ...fixtures.session,
      id: 'saved-1',
      publicId: 'savedpublicidsavedpub',
      name: 'Shared Sunday',
    }
    mockLinkSessions({ [saved.publicId]: saved })
    vi.mocked(loadSetLinkPreview).mockResolvedValueOnce({ kind: 'preview', preview } as never)
    vi.mocked(savePreviewAsNew).mockResolvedValueOnce(saved as never)

    renderAt(`/session/${PUBLIC_ID}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(screen.getByTestId('loc').textContent).toBe('/session/savedpublicidsavedpub'),
    )
    expect(savePreviewAsNew).toHaveBeenCalledWith(preview)
    expect(await screen.findByText(/Saved to your sets as/)).toBeTruthy()
    expect(screen.getByText(/“Shared Sunday”/)).toBeTruthy()
  })

  it('asks to save the preview before an edit and does not save the edit', async () => {
    mockLinkSessions({})
    vi.mocked(loadSetLinkPreview).mockResolvedValueOnce({ kind: 'preview', preview } as never)

    renderAt(`/session/${PUBLIC_ID}`)
    await screen.findByText('This is a shared set. Save to keep it on your device.')
    const select = (await screen.findAllByLabelText('Transpose song'))[0]
    fireEvent.change(select, { target: { value: 'A' } })

    expect(await screen.findByText('Save to your sets?')).toBeTruthy()
    expect(sessionStore.updateSession).not.toHaveBeenCalled()
  })

  it('updates the saved copy from the preview after confirmation', async () => {
    const copy = {
      ...savedCopy,
      linkSnapshot: [
        { entryId: 'entry-1', targetKey: 'G' },
        { entryId: 'entry-2' },
      ],
    }
    const changedPreview = {
      ...preview,
      items: [
        preview.items[0],
        { entryId: 'entry-2', url: 'https://example.test/second', title: 'Second Song' },
        { entryId: 'entry-3', url: 'https://example.test/third', title: 'Third Song' },
      ],
      snapshot: [
        { entryId: 'entry-1', targetKey: 'A' },
        { entryId: 'entry-2' },
        { entryId: 'entry-3' },
      ],
    }
    mockLinkSessions({ [copy.publicId]: copy })
    vi.mocked(loadSetLinkPreview).mockResolvedValueOnce({
      kind: 'preview',
      preview: changedPreview,
    } as never)
    vi.mocked(sessionStore.findByImportedLinkId).mockResolvedValueOnce(copy as never)
    vi.mocked(sessionStore.replaceSongsFromLink).mockResolvedValueOnce(copy as never)

    renderAt(`/session/${PUBLIC_ID}`)

    expect(
      await screen.findByText('You saved a copy of this set before.'),
    ).toBeTruthy()
    expect(screen.getByText('Since you saved it: 1 song added, 1 key changed.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save as new' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open my copy' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Update my copy' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Update' }))

    await waitFor(() =>
      expect(screen.getByTestId('loc').textContent).toBe(`/session/${copy.publicId}`),
    )
    expect(sessionStore.replaceSongsFromLink).toHaveBeenCalledWith(
      'copy-1',
      changedPreview.items,
      changedPreview.snapshot,
      changedPreview.failures,
    )
    expect(await screen.findByText(/Your copy now matches the shared set/)).toBeTruthy()
  })

  it('opens the saved copy from the preview banner', async () => {
    mockLinkSessions({ [savedCopy.publicId]: savedCopy })
    vi.mocked(loadSetLinkPreview).mockResolvedValueOnce({ kind: 'preview', preview } as never)
    vi.mocked(sessionStore.findByImportedLinkId).mockResolvedValueOnce(savedCopy as never)

    renderAt(`/session/${PUBLIC_ID}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Open my copy' }))

    await waitFor(() =>
      expect(screen.getByTestId('loc').textContent).toBe(`/session/${savedCopy.publicId}`),
    )
  })

  it('names what it compared when nothing was added, removed or re-keyed', async () => {
    const copy = { ...savedCopy, linkSnapshot: preview.snapshot }
    mockLinkSessions({ [copy.publicId]: copy })
    vi.mocked(loadSetLinkPreview).mockResolvedValueOnce({ kind: 'preview', preview } as never)
    vi.mocked(sessionStore.findByImportedLinkId).mockResolvedValueOnce(copy as never)

    renderAt(`/session/${PUBLIC_ID}`)

    expect(await screen.findByText('No songs added, removed or re-keyed.')).toBeTruthy()
  })

  it('does not show a change line for a saved copy without a snapshot', async () => {
    mockLinkSessions({ [savedCopy.publicId]: savedCopy })
    vi.mocked(loadSetLinkPreview).mockResolvedValueOnce({ kind: 'preview', preview } as never)
    vi.mocked(sessionStore.findByImportedLinkId).mockResolvedValueOnce(savedCopy as never)

    renderAt(`/session/${PUBLIC_ID}`)

    expect(
      await screen.findByText('You saved a copy of this set before.'),
    ).toBeTruthy()
    expect(screen.queryByText(/Since you saved it/)).toBeNull()
    expect(screen.queryByText(/re-keyed/)).toBeNull()
  })

  it('shows preview failures and dismisses them without saving that', async () => {
    mockLinkSessions({})
    vi.mocked(loadSetLinkPreview).mockResolvedValueOnce({
      kind: 'preview',
      preview: {
        ...preview,
        failures: [{ url: 'https://example.test/gone', reason: 'Page not found' }],
      },
    } as never)
    vi.mocked(sessionStore.dismissImportFailures).mockResolvedValueOnce(fixtures.session as never)

    renderAt(`/session/${PUBLIC_ID}`)
    expect(await screen.findByText(/This link couldn.t be added/)).toBeTruthy()
    expect(screen.getByText('https://example.test/gone')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => expect(screen.queryByText(/This link couldn.t be added/)).toBeNull())
    expect(sessionStore.dismissImportFailures).not.toHaveBeenCalled()
  })

  it('dismisses the failed links banner on a saved set and saves that', async () => {
    const withFailures = {
      ...fixtures.session,
      importFailures: [{ url: 'https://example.test/gone', reason: 'Page not found' }],
    }
    vi.mocked(sessionStore.getSession).mockResolvedValue(withFailures as never)
    vi.mocked(sessionStore.dismissImportFailures).mockResolvedValueOnce(fixtures.session as never)
    renderAt('/session/session-1')
    expect(await screen.findByText(/This link couldn.t be added/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByText(/This link couldn.t be added/)).toBeNull())
    expect(sessionStore.dismissImportFailures).toHaveBeenCalledWith('session-1')
    vi.mocked(sessionStore.getSession).mockImplementation(async () => fixtures.session as never)
  })

  it('shows the empty card when no song in the link loads', async () => {
    mockLinkSessions({})
    vi.mocked(loadSetLinkPreview).mockResolvedValueOnce({ kind: 'empty' } as never)
    renderAt(`/session/${PUBLIC_ID}`)
    expect(await screen.findByText('None of the songs could be loaded')).toBeTruthy()
  })

  it('shows the missing card when the link is unavailable', async () => {
    mockLinkSessions({})
    vi.mocked(loadSetLinkPreview).mockResolvedValueOnce({ kind: 'missing' } as never)
    renderAt(`/session/${PUBLIC_ID}`)
    expect(await screen.findByText(/hasn.t synced yet/)).toBeTruthy()
  })

  it('falls back to a saved copy when the link cannot load', async () => {
    mockLinkSessions({ [savedCopy.publicId]: savedCopy })
    vi.spyOn(console, 'error').mockImplementationOnce(() => {})
    vi.mocked(loadSetLinkPreview).mockRejectedValueOnce(new Error('offline'))
    vi.mocked(sessionStore.findByImportedLinkId).mockResolvedValueOnce(savedCopy as never)

    renderAt(`/session/${PUBLIC_ID}`)

    await waitFor(() =>
      expect(screen.getByTestId('loc').textContent).toBe(`/session/${savedCopy.publicId}`),
    )
    expect(await screen.findByText('Couldn’t load the latest version')).toBeTruthy()
    expect(screen.getByText('Showing your saved copy of the shared set.')).toBeTruthy()
  })

  it('says the link expired when its saved copy opens instead', async () => {
    renderAt({
      pathname: '/session/session-1',
      state: { fromSetLink: { kind: 'expired', name: 'Sunday Set' } },
    })
    expect(await screen.findByText('This set link has expired')).toBeTruthy()
    expect(screen.getByText('Showing your saved copy of the shared set.')).toBeTruthy()
  })

  it('shows the banner from navigation state and dismisses it', async () => {
    renderAt({
      pathname: '/session/session-1',
      state: { fromSetLink: { kind: 'saved', name: 'Sunday Set' } },
    })
    expect(await screen.findByText(/Saved to your sets as “Sunday Set”/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByText(/Saved to your sets as/)).toBeNull())
  })

  it('replaces a legacy id URL with the public id', async () => {
    vi.mocked(sessionStore.getSession).mockResolvedValue({
      ...fixtures.session,
      publicId: PUBLIC_ID,
    } as never)
    renderAt('/session/session-1')
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe(`/session/${PUBLIC_ID}`))
    vi.mocked(sessionStore.getSession).mockImplementation(async () => fixtures.session as never)
  })
})


describe('SessionPage following a live set', () => {
  const followed = { ...fixtures.session, liveSourceId: 'live-1' }
  const controller = { stop: vi.fn(), flushDeferred: vi.fn(), dropDeferred: vi.fn() }
  let handlers: FollowHandlers

  function setup(session: object = followed) {
    vi.mocked(sessionStore.getSession).mockResolvedValue(session as never)
    vi.mocked(sessionStore.updateSession).mockClear()
    vi.mocked(followLiveSet).mockImplementation((_session, h) => {
      handlers = h
      return controller
    })
    renderAt('/session/session-1')
  }

  afterEach(() => {
    vi.mocked(sessionStore.getSession).mockImplementation(async () => fixtures.session as never)
    vi.clearAllMocks()
  })

  it('shows the live banner with the live status and no switch', async () => {
    setup()
    expect(await screen.findByText(/Live set from host/)).toBeTruthy()
    expect(screen.getByText(/Editing makes your own copy/)).toBeTruthy()
    expect(screen.queryByText('Live')).toBeNull()
    expect(screen.getByRole('button', { name: 'Create a copy' })).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    await waitFor(() => expect(followLiveSet).toHaveBeenCalledTimes(1))
  })

  it('shows a Live set chip for a live set only', async () => {
    setup()
    expect(await screen.findByText('Live set')).toBeTruthy()
    cleanup()
    setup(fixtures.session)
    await screen.findByRole('button', { name: 'Add Song' })
    expect(screen.queryByText('Live set')).toBeNull()
  })

  it('shows the status in words', async () => {
    setup()
    await waitFor(() => expect(followLiveSet).toHaveBeenCalled())
    act(() => handlers.onStatus('reconnecting'))
    expect(await screen.findByText(/^Reconnecting\u2026/)).toBeTruthy()
    expect(screen.getByText('Live set from host')).toBeTruthy()
    act(() => handlers.onStatus('expired'))
    expect(await screen.findByText('Live link expired')).toBeTruthy()
    expect(screen.getByText('Set no longer updating. Create your own copy to edit.')).toBeTruthy()
  })

  it('makes a copy from the banner button', async () => {
    setup()
    const copy = { ...fixtures.session, id: 'session-copy', name: 'Copy' }
    vi.mocked(sessionStore.createSetCopy).mockResolvedValue(copy as never)
    fireEvent.click(await screen.findByRole('button', { name: 'Create a copy' }))
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/session/session-copy'))
    expect(sessionStore.createSetCopy).toHaveBeenCalledWith(followed)
  })

  it('does not show the banner for a set that is not live', async () => {
    setup(fixtures.session)
    await screen.findByRole('button', { name: 'Add Song' })
    expect(screen.queryByText(/Live set from host/)).toBeNull()
  })

  it('announces the follow state in a live region without the button', async () => {
    setup()
    const title = await screen.findByText(/Live set from host/)
    const liveRegion = title.closest('[role="status"]')
    expect(liveRegion).toBeTruthy()
    expect(liveRegion?.contains(screen.getByRole('button', { name: 'Create a copy' }))).toBe(false)
  })

  it('asks before chord editing and makes a copy when confirmed', async () => {
    setup()
    const copy = { ...fixtures.session, id: 'session-copy', name: 'Copy' }
    vi.mocked(sessionStore.createSetCopy).mockResolvedValue(copy as never)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit chords' }))
    expect(await screen.findByText('Make your own copy?')).toBeTruthy()
    expect(screen.queryByText(/Chord editing active/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Make a copy' }))

    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/session/session-copy'))
    expect(sessionStore.createSetCopy).toHaveBeenCalledWith(followed)
    expect(sessionStore.updateSession).not.toHaveBeenCalled()
    expect(controller.dropDeferred).toHaveBeenCalled()
  })

  it('leaves the host key in place when Cancel is chosen', async () => {
    setup()
    const select = (await screen.findAllByLabelText('Transpose song'))[0] as HTMLSelectElement
    const hostKey = select.value
    fireEvent.change(select, { target: { value: 'A' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((screen.getAllByLabelText('Transpose song')[0] as HTMLSelectElement).value).toBe(hostKey)
    expect(sessionStore.updateSession).not.toHaveBeenCalled()
    expect(sessionStore.createSetCopy).not.toHaveBeenCalled()
    expect(controller.flushDeferred).toHaveBeenCalled()
  })

  it('does not ask for columns or font size', async () => {
    setup()
    await screen.findByText(/Live set from host/)
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Increase song font size' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows a set that already ended without connecting', async () => {
    setup({ ...followed, liveEnded: 'stopped' })
    expect(await screen.findByText('Live set ended by host')).toBeTruthy()
    expect(followLiveSet).not.toHaveBeenCalled()
  })

  it('still asks before edits when the host stops sharing', async () => {
    setup()
    await waitFor(() => expect(followLiveSet).toHaveBeenCalled())
    act(() => handlers.onStatus('stopped'))

    expect(await screen.findByText('Live set ended by host')).toBeTruthy()
    expect(screen.getByText('Live set ended')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit chords' }))
    expect(await screen.findByText('Make your own copy?')).toBeTruthy()
  })
})

describe('SessionPage removed-by-host songs', () => {
  const followed = { ...fixtures.session, liveSourceId: 'live-1' }
  const controller = { stop: vi.fn(), flushDeferred: vi.fn(), dropDeferred: vi.fn() }
  let handlers: FollowHandlers

  function renderNavigable() {
    return render(
      <ChromeVisibilityContext.Provider value={{ hidden: false, setHidden: vi.fn() }}>
        <MemoryRouter initialEntries={['/session/session-1']}>
          <NavProbe />
          <Routes>
            <Route path="/session/:sessionId" element={<SessionPage />} />
          </Routes>
        </MemoryRouter>
      </ChromeVisibilityContext.Provider>,
    )
  }

  function mockFollow(session: object) {
    vi.mocked(sessionStore.getSession).mockResolvedValue(session as never)
    vi.mocked(followLiveSet).mockImplementation((_session, h) => {
      handlers = h
      return controller
    })
  }

  afterEach(() => {
    vi.mocked(sessionStore.getSession).mockImplementation(async () => fixtures.session as never)
    vi.clearAllMocks()
  })

  it('clears a removed-by-host song when the set id changes', async () => {
    const second = {
      ...fixtures.session,
      id: 'session-2',
      name: 'Second Set',
      songs: [
        {
          entryId: 'entry-s2',
          url: 'https://example.test/second',
          title: 'Second Song',
        },
      ],
    }
    vi.mocked(sessionStore.getSession).mockImplementation(async (id: string) => {
      if (id === 'session-1') return followed as never
      if (id === 'session-2') return second as never
      return fixtures.session as never
    })
    vi.mocked(followLiveSet).mockImplementation((_session, h) => {
      handlers = h
      return controller
    })

    renderNavigable()
    await screen.findByText(/Live set from host/)
    await waitFor(() => expect(followLiveSet).toHaveBeenCalled())

    await act(async () => {
      handlers.onUpdate({ ...followed, songs: [] } as never)
    })
    await waitFor(() => expect(screen.getByText(/Removed by the host/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Open second set' }))
    await waitFor(() => expect(screen.queryByText(/Removed by the host/)).toBeNull())
    expect(screen.queryByText(/\(removed\)/)).toBeNull()
  })

  it('wraps tab arrow keys around the tabs actually shown', async () => {
    const threeSongs = {
      ...followed,
      songs: [
        { entryId: 'entry-a', url: 'https://example.test/a', title: 'Alpha' },
        { entryId: 'entry-b', url: 'https://example.test/b', title: 'Bravo' },
        { entryId: 'entry-c', url: 'https://example.test/c', title: 'Charlie' },
      ],
    }
    mockFollow(threeSongs)

    renderAt('/session/session-1')
    await screen.findByText(/Live set from host/)
    await waitFor(() => expect(followLiveSet).toHaveBeenCalled())

    await act(async () => {
      handlers.onUpdate({ ...threeSongs, songs: threeSongs.songs.slice(1) } as never)
    })
    await waitFor(() => expect(screen.getByText(/Removed by the host/)).toBeTruthy())

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    fireEvent.keyDown(tabs[2], { key: 'ArrowRight' })

    await waitFor(() =>
      expect(screen.getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true'),
    )
    expect(screen.getAllByRole('tab')[0].textContent).toContain('(removed)')
    expect(screen.queryByText(/Removed by the host/)).toBeTruthy()
  })
})

describe('SessionPage host change notice', () => {
  const twoSongs = {
    ...fixtures.session,
    liveSourceId: 'live-1',
    songs: [
      { entryId: 'entry-a', url: 'https://example.test/a', title: 'Alpha' },
      { entryId: 'entry-b', url: 'https://example.test/b', title: 'Bravo' },
    ],
  }
  const controller = { stop: vi.fn(), flushDeferred: vi.fn(), dropDeferred: vi.fn() }
  let handlers: FollowHandlers

  const announced = (text: string) =>
    screen.getAllByRole('status').some((el) => el.textContent === `Host: ${text}`)

  async function open() {
    vi.mocked(sessionStore.getSession).mockResolvedValue(twoSongs as never)
    vi.mocked(followLiveSet).mockImplementation((_session, h) => {
      handlers = h
      return controller
    })
    renderAt('/session/session-1')
    await screen.findByText(/Live set from host/)
    await waitFor(() => expect(followLiveSet).toHaveBeenCalled())
  }

  afterEach(() => {
    vi.mocked(sessionStore.getSession).mockImplementation(async () => fixtures.session as never)
    vi.clearAllMocks()
  })

  it('says nothing when the set opens', async () => {
    await open()
    expect(screen.queryByText(/^Host:/)).toBeNull()
  })

  it('says what the host changed and opens that song on Show', async () => {
    await open()
    const songs = [twoSongs.songs[0], { ...twoSongs.songs[1], targetKey: 'A' }]
    await act(async () => handlers.onUpdate({ ...twoSongs, songs } as never))

    await waitFor(() => expect(announced('“Bravo” is now in A')).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))

    await waitFor(() =>
      expect(screen.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true'),
    )
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show' })).toBeNull())
    expect(announced('“Bravo” is now in A')).toBe(false)
  })

  it('adds a quick second change to the same notice', async () => {
    await open()
    const keyed = [twoSongs.songs[0], { ...twoSongs.songs[1], targetKey: 'A' }]
    await act(async () => handlers.onUpdate({ ...twoSongs, songs: keyed } as never))
    await act(async () =>
      handlers.onUpdate({ ...twoSongs, name: 'Youth', songs: keyed } as never),
    )

    await waitFor(() =>
      expect(announced('“Bravo” is now in A. Renamed the set to “Youth”')).toBe(
        true,
      ),
    )
  })

  it('closes on Dismiss', async () => {
    await open()
    await act(async () =>
      handlers.onUpdate({ ...twoSongs, songs: [twoSongs.songs[0]] } as never),
    )
    await waitFor(() => expect(announced('Removed “Bravo”')).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(announced('Removed “Bravo”')).toBe(false))
  })
})
