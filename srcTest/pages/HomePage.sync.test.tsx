// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HomePage from '../../src/pages/HomePage'
import * as sessionStoreModule from '../../src/lib/sessionStore'

const sync = vi.hoisted(() => {
  let state = {
    signedIn: false,
    pendingRemote: new Set<string>(),
    deletedElsewhere: new Set<string>(),
    conflicts: new Map<
      string,
      { diffs: Array<{ label: string; local: string; remote: string }> }
    >(),
  }
  return {
    get: () => state,
    reset: () => {
      state = {
        signedIn: false,
        pendingRemote: new Set(),
        deletedElsewhere: new Set(),
        conflicts: new Map(),
      }
    },
    setSignedIn: (value: boolean) => {
      state = { ...state, signedIn: value }
    },
    setConflicts: (ids: string[]) => {
      state = {
        signedIn: state.signedIn,
        pendingRemote: new Set(),
        deletedElsewhere: new Set(),
        conflicts: new Map(ids.map((id) => [id, { diffs: [] }])),
      }
    },
    setDeletedElsewhere: (ids: string[]) => {
      state = {
        signedIn: state.signedIn,
        pendingRemote: new Set(),
        deletedElsewhere: new Set(ids),
        conflicts: new Map(),
      }
    },
    listRecentlyDeleted: vi.fn(async () => []),
    restoreDeletedSet: vi.fn(),
    AccountOfflineError: class AccountOfflineError extends Error {},
  }
})

vi.mock('../../src/lib/accountSync', () => ({
  getSyncState: sync.get,
  subscribeSyncState: vi.fn(() => () => {}),
  setOpenSet: vi.fn(),
  applyPendingRemote: vi.fn(),
  resolveConflict: vi.fn(),
  keepDeletedCopy: vi.fn(),
  dismissDeleted: vi.fn(),
  listRecentlyDeleted: sync.listRecentlyDeleted,
  restoreDeletedSet: sync.restoreDeletedSet,
  AccountOfflineError: sync.AccountOfflineError,
}))

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

const base = { createdAt: 0, songs: [] }

function mockSessions(sessions: Array<{ id: string; name: string }>) {
  vi.spyOn(sessionStoreModule.sessionStore, 'getAllSessions').mockResolvedValue(
    sessions.map((session) => ({ ...base, ...session })) as never,
  )
}

beforeEach(() => {
  sync.reset()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('HomePage account sync banner', () => {
  it('says one set needs a choice and links to it', async () => {
    sync.setConflicts(['set-a'])
    mockSessions([{ id: 'set-a', name: 'Sunday Set' }])

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('1 set needs your choice.')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Sunday Set' })
    expect(link.getAttribute('href')).toBe('/session/set-a')
  })

  it('includes sets deleted elsewhere in the needs-choice banner', async () => {
    sync.setDeletedElsewhere(['set-a'])
    mockSessions([{ id: 'set-a', name: 'Sunday Set' }])

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('1 set needs your choice.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sunday Set' }).getAttribute('href')).toBe(
      '/session/set-a',
    )
  })

  it('says how many sets need a choice and links to each', async () => {
    sync.setConflicts(['set-a', 'set-b'])
    mockSessions([
      { id: 'set-a', name: 'Sunday Set' },
      { id: 'set-b', name: 'Friday Set' },
      { id: 'set-c', name: 'Other Set' },
    ])

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('2 sets need your choice.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sunday Set' }).getAttribute('href')).toBe(
      '/session/set-a',
    )
    expect(screen.getByRole('link', { name: 'Friday Set' }).getAttribute('href')).toBe(
      '/session/set-b',
    )
    expect(screen.queryByRole('link', { name: 'Other Set' })).toBeNull()
  })

  it('skips sets the page has not loaded', async () => {
    sync.setConflicts(['set-a', 'set-missing'])
    mockSessions([{ id: 'set-a', name: 'Sunday Set' }])

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('1 set needs your choice.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sunday Set' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'set-missing' })).toBeNull()
  })

  it('shows no banner without conflicts', async () => {
    mockSessions([{ id: 'set-a', name: 'Sunday Set' }])

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )

    await screen.findByRole('link', { name: /Sunday Set/ })
    expect(screen.queryByText(/needs your choice/)).toBeNull()
    expect(screen.queryByText(/need your choice/)).toBeNull()
  })

  it('refreshes the set list when the session store emits a remote change', async () => {
    const getAll = vi
      .spyOn(sessionStoreModule.sessionStore, 'getAllSessions')
      .mockResolvedValue([{ ...base, id: 'set-a', name: 'Sunday Set' }] as never)
    let listener: (() => void) | undefined
    vi.spyOn(sessionStoreModule.sessionStore, 'subscribe').mockImplementation((cb) => {
      listener = () => cb({ type: 'created', sessionId: 'set-b' })
      return () => {}
    })

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('link', { name: /Sunday Set/ })).toBeTruthy()
    getAll.mockResolvedValue([
      { ...base, id: 'set-a', name: 'Sunday Set' },
      { ...base, id: 'set-b', name: 'Evening Set' },
    ] as never)
    listener?.()

    expect(await screen.findByRole('link', { name: /Evening Set/ })).toBeTruthy()
  })
})

describe('HomePage Recently deleted', () => {
  it('shows Show deleted sets only when signed in', async () => {
    mockSessions([{ id: 'set-a', name: 'Sunday Set' }])

    const { rerender } = render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )
    await screen.findByRole('link', { name: /Sunday Set/ })
    expect(screen.queryByRole('button', { name: 'Show deleted sets' })).toBeNull()

    sync.setSignedIn(true)
    rerender(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: 'Show deleted sets' })).toBeTruthy()
  })

  it('offers Show deleted sets with an empty library and opens the dialog', async () => {
    sync.setSignedIn(true)
    mockSessions([])

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Show deleted sets' }))

    expect(await screen.findByRole('heading', { name: 'Recently deleted' })).toBeTruthy()
    expect(await screen.findByText('No deleted sets.')).toBeTruthy()
  })

  it('keeps the set and writes nothing when the 5-second undo is used', async () => {
    sync.setSignedIn(true)
    mockSessions([{ id: 'set-a', name: 'Sunday Set' }])
    const deleteSpy = vi
      .spyOn(sessionStoreModule.sessionStore, 'deleteSession')
      .mockResolvedValue(undefined)

    vi.useFakeTimers()
    try {
      render(
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>,
      )
      await act(async () => {
        await Promise.resolve()
      })
      expect(screen.getByRole('link', { name: /Sunday Set/ })).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: 'Delete session' }))
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000)
      })

      expect(deleteSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
