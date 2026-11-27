// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import SessionPage from '../../src/pages/SessionPage'
import { ChromeVisibilityContext } from '../../src/lib/chromeVisibility'
import { sessionStore } from '../../src/lib/sessionStore'

const sync = vi.hoisted(() => {
  let state = {
    pendingRemote: new Set<string>(),
    deletedElsewhere: new Set<string>(),
    conflicts: new Map<string, { clashes: string[] }>(),
  }
  const listeners = new Set<(next: typeof state) => void>()
  return {
    get: () => state,
    subscribe: (listener: (next: typeof state) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set: (next: typeof state) => {
      state = next
      for (const listener of listeners) listener(next)
    },
    reset: () => {
      state = { pendingRemote: new Set(), deletedElsewhere: new Set(), conflicts: new Map() }
    },
    setOpenSet: vi.fn(),
    applyPendingRemote: vi.fn(),
    resolveConflict: vi.fn(),
    keepDeletedCopy: vi.fn(),
    dismissDeleted: vi.fn(),
  }
})

vi.mock('../../src/lib/accountSync', () => ({
  getSyncState: sync.get,
  subscribeSyncState: sync.subscribe,
  setOpenSet: sync.setOpenSet,
  applyPendingRemote: sync.applyPendingRemote,
  resolveConflict: sync.resolveConflict,
  keepDeletedCopy: sync.keepDeletedCopy,
  dismissDeleted: sync.dismissDeleted,
}))

vi.mock('../../src/lib/lyricsPublishIdentity', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/lyricsPublishIdentity')>(
    '../../src/lib/lyricsPublishIdentity',
  )
  return {
    ...actual,
    getLyricsPublicationIdentity: vi.fn(async () => null),
    publishLyricsForSession: vi.fn(async () => ({ id: 'pub-test' })),
  }
})

vi.mock('../../src/lib/lyricsSync', () => ({
  ensureLyricsFresh: vi.fn(async () => ({ ok: true })),
}))

const fixtures = vi.hoisted(() => {
  const sections = [
    {
      type: 'Verse',
      label: 'Verse 1',
      lines: [
        { kind: 'lyric', text: 'Morning light on the open road', chords: [{ chord: 'G', pos: 0 }] },
      ],
    },
  ]

  const song = {
    id: 'song-1',
    title: 'Demo Song A',
    artist: 'Demo Band',
    sourceUrl: 'https://example.test/demo-song-a',
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

vi.mock('../../src/lib/liveFollow', () => ({ followLiveSet: vi.fn() }))

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
  putLyricsCurrentApi: vi.fn(async () => undefined),
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
  vi.clearAllMocks()
  sync.reset()
})

beforeEach(() => {
  vi.mocked(sessionStore.getSession).mockImplementation(async () => fixtures.session as never)
})

function LocationProbe() {
  const loc = useLocation()
  return <output data-testid="loc">{loc.pathname}</output>
}

function renderPage() {
  return render(
    <ChromeVisibilityContext.Provider value={{ hidden: false, setHidden: vi.fn() }}>
      <MemoryRouter initialEntries={['/session/session-1']}>
        <LocationProbe />
        <Routes>
          <Route path="/session/:sessionId" element={<SessionPage />} />
        </Routes>
      </MemoryRouter>
    </ChromeVisibilityContext.Provider>,
  )
}

const copy = {
  id: 'copy-1',
  publicId: 'copypublicidcopypublic1',
  createdAt: 0,
  name: 'Sunday Set copy',
  songs: [],
}

describe('SessionPage account sync banners', () => {
  it('shows no sync banner when the state is empty', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Add song' })

    expect(screen.queryByText('This set was changed on another device.')).toBeNull()
    expect(screen.queryByText('This set was deleted on another device.')).toBeNull()
    expect(screen.queryByText('This set changed on this device and on another device.')).toBeNull()
  })

  it('offers Update set for a waiting account version', async () => {
    sync.set({ ...sync.get(), pendingRemote: new Set(['session-1']) })
    sync.applyPendingRemote.mockResolvedValueOnce(undefined)
    renderPage()

    expect(await screen.findByText('This set was changed on another device.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Update set' }))

    await waitFor(() => expect(sync.applyPendingRemote).toHaveBeenCalledWith('session-1'))
  })

  it('shows the account version right after Update set', async () => {
    sync.set({ ...sync.get(), pendingRemote: new Set(['session-1']) })
    sync.applyPendingRemote.mockImplementationOnce(async () => {
      vi.mocked(sessionStore.getSession).mockResolvedValue({
        ...fixtures.session,
        name: 'Sunday Set from the account',
      })
    })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Update set' }))

    expect(await screen.findByText('Sunday Set from the account')).toBeTruthy()
  })

  it('says in plain words when Update set fails', async () => {
    sync.set({ ...sync.get(), pendingRemote: new Set(['session-1']) })
    sync.applyPendingRemote.mockRejectedValueOnce(new Error('offline'))
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Update set' }))

    expect(await screen.findByText("Couldn't update the set. Try again.")).toBeTruthy()
  })

  it('keeps a copy of a set deleted on another device and opens it', async () => {
    sync.set({ ...sync.get(), deletedElsewhere: new Set(['session-1']) })
    sync.keepDeletedCopy.mockResolvedValueOnce(copy.id)
    vi.mocked(sessionStore.getSession).mockImplementation(
      async (id: string) =>
        (id === 'session-1'
          ? fixtures.session
          : id === copy.id || id === copy.publicId
            ? copy
            : null) as never,
    )
    renderPage()

    expect(await screen.findByText('This set was deleted on another device.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep a copy' }))

    await waitFor(() =>
      expect(screen.getByTestId('loc').textContent).toBe(`/session/${copy.publicId}`),
    )
    expect(sync.keepDeletedCopy).toHaveBeenCalledWith('session-1')
  })

  it('goes back from a set deleted on another device', async () => {
    sync.set({ ...sync.get(), deletedElsewhere: new Set(['session-1']) })
    sync.dismissDeleted.mockResolvedValueOnce(undefined)
    renderPage()

    expect(await screen.findByText('This set was deleted on another device.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }))

    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/'))
    expect(sync.dismissDeleted).toHaveBeenCalledWith('session-1')
  })

  it('disables both deleted-banner buttons while one action runs', async () => {
    sync.set({ ...sync.get(), deletedElsewhere: new Set(['session-1']) })
    sync.keepDeletedCopy.mockReturnValue(new Promise(() => {}))
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Keep a copy' }))

    const keepBtn = await screen.findByRole('button', { name: 'Keep a copy', busy: true })
    const backBtn = screen.getByRole('button', { name: 'Go back' })
    expect((keepBtn as HTMLButtonElement).disabled).toBe(true)
    expect((backBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('opens the conflict dialog from Review', async () => {
    sync.set({
      ...sync.get(),
      conflicts: new Map([
        [
          'session-1',
          {
            clashes: ['Demo Song A key: G on this device vs A in the cloud.'],
            diffs: [{ label: 'Demo Song A · Chosen key', local: 'G', remote: 'A' }],
          },
        ],
      ]),
    })
    renderPage()

    expect(
      await screen.findByText('This set changed on this device and on another device.'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))

    expect(
      await screen.findByRole('heading', { name: 'Choose which version to keep' }),
    ).toBeTruthy()
    expect(screen.getByText('Demo Song A · Chosen key')).toBeTruthy()
    expect(screen.getByText('This device')).toBeTruthy()
    expect(screen.getByText('Cloud version')).toBeTruthy()
  })

  it('shows the deleted banner first when more than one state applies', async () => {
    sync.set({
      pendingRemote: new Set(['session-1']),
      deletedElsewhere: new Set(['session-1']),
      conflicts: new Map([['session-1', { clashes: ['Song order changed.'] }]]),
    })
    renderPage()

    expect(await screen.findByText('This set was deleted on another device.')).toBeTruthy()
    expect(screen.queryByText('This set was changed on another device.')).toBeNull()
    expect(screen.queryByText('This set changed on this device and on another device.')).toBeNull()
  })

  it('marks the set as open until the page unmounts', async () => {
    const { unmount } = renderPage()

    await waitFor(() => expect(sync.setOpenSet).toHaveBeenCalledWith('session-1'))

    sync.setOpenSet.mockClear()
    unmount()

    expect(sync.setOpenSet).toHaveBeenCalledWith(null)
  })
})
