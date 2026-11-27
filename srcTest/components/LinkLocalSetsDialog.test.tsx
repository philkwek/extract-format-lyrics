// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import LinkLocalSetsDialog from '../../src/components/LinkLocalSetsDialog'

const sync = vi.hoisted(() => {
  class AccountOfflineError extends Error {}
  let state = {
    signedIn: true,
    unlinkedSets: [] as Array<{ id: string; name: string }>,
    pendingRemote: new Set<string>(),
    deletedElsewhere: new Set<string>(),
    conflicts: new Map<
      string,
      { diffs: Array<{ label: string; local: string; remote: string }> }
    >(),
  }
  const listeners = new Set<(next: typeof state) => void>()
  function publish(next: typeof state) {
    state = next
    for (const listener of listeners) listener(next)
  }
  return {
    AccountOfflineError,
    linkLocalSets: vi.fn(),
    removeUnlinkedSets: vi.fn(),
    get: () => state,
    subscribe: (listener: (next: typeof state) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setSets: (unlinkedSets: Array<{ id: string; name: string }>) => {
      publish({ ...state, unlinkedSets })
    },
    reset: () => {
      state = {
        signedIn: true,
        unlinkedSets: [],
        pendingRemote: new Set(),
        deletedElsewhere: new Set(),
        conflicts: new Map(),
      }
    },
  }
})

vi.mock('../../src/lib/accountSync', () => ({
  getSyncState: sync.get,
  subscribeSyncState: sync.subscribe,
  linkLocalSets: sync.linkLocalSets,
  removeUnlinkedSets: sync.removeUnlinkedSets,
  AccountOfflineError: sync.AccountOfflineError,
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
  sync.linkLocalSets.mockReset()
  sync.removeUnlinkedSets.mockReset()
  sync.reset()
})

const sets = [
  { id: 'set-a', name: 'Demo Song A' },
  { id: 'set-b', name: 'Demo Band' },
  { id: 'set-c', name: 'Sunday demo set' },
]

function renderDialog() {
  render(<LinkLocalSetsDialog />)
}

describe('LinkLocalSetsDialog', () => {
  it('shows up to five names and how many more there are', () => {
    sync.setSets(
      Array.from({ length: 7 }, (_, index) => ({
        id: `set-${index}`,
        name: `Demo Set ${index + 1}`,
      })),
    )
    renderDialog()

    expect(screen.getByRole('dialog').className).toContain('ui-dialog--sm')
    expect(screen.getByRole('heading', { name: 'Save sets to your account?' })).toBeTruthy()
    expect(
      screen.getByText('You currently have local sets, save them to your account?'),
    ).toBeTruthy()
    expect(screen.getByText('Demo Set 1')).toBeTruthy()
    expect(screen.getByText('Demo Set 5')).toBeTruthy()
    expect(screen.queryByText('Demo Set 6')).toBeNull()
    expect(screen.getByText('and 2 more')).toBeTruthy()
  })

  it('removes nothing until Remove sets is pressed in the confirm step', async () => {
    sync.setSets(sets)
    sync.removeUnlinkedSets.mockResolvedValue(undefined)
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(screen.getByText("Remove 3 sets from this device? This can't be undone.")).toBeTruthy()
    expect(sync.removeUnlinkedSets).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }))
    expect(screen.queryByText(/This can't be undone/)).toBeNull()
    expect(sync.removeUnlinkedSets).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove sets' }))

    await waitFor(() => expect(sync.removeUnlinkedSets).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('calls the engine from Add to account and closes when everything was added', async () => {
    sync.setSets(sets)
    sync.linkLocalSets.mockResolvedValue({ added: 3, keptLocal: 0 })
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Add to account' }))

    await waitFor(() => expect(sync.linkLocalSets).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('stays open and says how many sets stay local when the account is full', async () => {
    sync.setSets(sets)
    sync.linkLocalSets.mockResolvedValue({ added: 1, keptLocal: 2 })
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Add to account' }))

    expect(
      await screen.findByText('Your account can hold 100 sets. 2 sets stay on this device only.'),
    ).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('says saving needs a connection when offline', async () => {
    sync.setSets(sets)
    sync.linkLocalSets.mockRejectedValue(new sync.AccountOfflineError())
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Add to account' }))

    expect(await screen.findByText('Saving to your account needs a connection.')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('says it could not save the sets for other errors', async () => {
    sync.setSets(sets)
    sync.linkLocalSets.mockRejectedValue(new Error('boom'))
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Add to account' }))

    expect(await screen.findByText("Couldn't save your sets. Try again.")).toBeTruthy()
  })

  it('hides the dialog on Close and keeps the sets local', async () => {
    sync.setSets(sets)
    renderDialog()

    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(sync.linkLocalSets).not.toHaveBeenCalled()
    expect(sync.removeUnlinkedSets).not.toHaveBeenCalled()
  })
})
