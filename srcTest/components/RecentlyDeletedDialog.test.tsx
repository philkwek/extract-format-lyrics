// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import RecentlyDeletedDialog from '../../src/components/RecentlyDeletedDialog'

const engine = vi.hoisted(() => {
  class AccountOfflineError extends Error {}
  return {
    listRecentlyDeleted: vi.fn(),
    restoreDeletedSet: vi.fn(),
    AccountOfflineError,
  }
})

vi.mock('../../src/lib/accountSync', () => engine)

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
  engine.listRecentlyDeleted.mockReset()
  engine.restoreDeletedSet.mockReset()
})

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.now()
const rows = [
  { setId: 'set-c', name: 'Demo Song C', songCount: 4, deletedAt: NOW },
  { setId: 'set-b', name: 'Demo Song B', songCount: 1, deletedAt: NOW - DAY_MS },
  { setId: 'set-a', name: 'Demo Song A', songCount: 2, deletedAt: NOW - 3 * DAY_MS },
]

function renderDialog() {
  render(<RecentlyDeletedDialog isOpen onClose={vi.fn()} />)
}

describe('RecentlyDeletedDialog', () => {
  it('lists sets newest first with their song count and when they were deleted', async () => {
    engine.listRecentlyDeleted.mockResolvedValue(rows)
    renderDialog()

    expect(screen.getByRole('heading', { name: 'Recently deleted' })).toBeTruthy()
    expect(screen.getByText('Deleted sets stay here for 30 days.')).toBeTruthy()

    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0].textContent).toContain('Demo Song C')
    expect(items[0].textContent).toContain('4 songs')
    expect(items[0].textContent).toContain('Today')
    expect(items[1].textContent).toContain('Demo Song B')
    expect(items[1].textContent).toContain('1 song')
    expect(items[1].textContent).toContain('Yesterday')
    expect(items[2].textContent).toContain('Demo Song A')
    expect(items[2].textContent).toContain('3 days ago')
  })

  it('restores a set, removes its row and says what happened', async () => {
    engine.listRecentlyDeleted.mockResolvedValue(rows)
    engine.restoreDeletedSet.mockResolvedValue('restored')
    renderDialog()

    await screen.findAllByRole('listitem')
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[2])

    await waitFor(() => expect(engine.restoreDeletedSet).toHaveBeenCalledWith('set-a'))
    expect(await screen.findByText('Restored “Demo Song A”.')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Demo Song A')).toBeNull())
    expect(screen.queryAllByRole('listitem')).toHaveLength(2)
  })

  it('says the account is full and keeps the row', async () => {
    engine.listRecentlyDeleted.mockResolvedValue(rows)
    engine.restoreDeletedSet.mockResolvedValue('full')
    renderDialog()

    await screen.findAllByRole('listitem')
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0])

    expect(
      await screen.findByText('Your account has 100 sets. Delete one to restore this set.'),
    ).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toHaveLength(3)
  })

  it('says a set is gone and refreshes the list', async () => {
    engine.listRecentlyDeleted.mockResolvedValueOnce(rows).mockResolvedValueOnce([rows[0]])
    engine.restoreDeletedSet.mockResolvedValue('gone')
    renderDialog()

    await screen.findAllByRole('listitem')
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0])

    expect(await screen.findByText('This set is no longer in Recently deleted.')).toBeTruthy()
    await waitFor(() => expect(screen.queryAllByRole('listitem')).toHaveLength(1))
    expect(engine.listRecentlyDeleted).toHaveBeenCalledTimes(2)
  })

  it('says Recently deleted needs a connection when offline', async () => {
    engine.listRecentlyDeleted.mockRejectedValue(new engine.AccountOfflineError())
    renderDialog()

    expect(await screen.findByText('Recently deleted needs a connection.')).toBeTruthy()
    expect(screen.queryByText('No deleted sets.')).toBeNull()
  })

  it('says it could not load deleted sets when the read fails', async () => {
    engine.listRecentlyDeleted.mockRejectedValue(new Error('nope'))
    renderDialog()

    expect(await screen.findByText("Couldn't load deleted sets. Try again.")).toBeTruthy()
  })

  it('shows loading text while fetching and resets stale state when reopened', async () => {
    let resolveSecond!: (value: typeof rows) => void
    engine.listRecentlyDeleted
      .mockRejectedValueOnce(new engine.AccountOfflineError())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve
          }),
      )

    const { rerender } = render(<RecentlyDeletedDialog isOpen onClose={vi.fn()} />)
    expect(screen.getByText('Loading deleted sets…')).toBeTruthy()
    expect(await screen.findByText('Recently deleted needs a connection.')).toBeTruthy()

    rerender(<RecentlyDeletedDialog isOpen={false} onClose={vi.fn()} />)
    rerender(<RecentlyDeletedDialog isOpen onClose={vi.fn()} />)

    expect(screen.getByText('Loading deleted sets…')).toBeTruthy()
    expect(screen.queryByText('Recently deleted needs a connection.')).toBeNull()
    expect(screen.queryByText('No deleted sets.')).toBeNull()

    resolveSecond([rows[0]])
    expect(await screen.findByText('Demo Song C')).toBeTruthy()
  })

  it('ignores a slow earlier fetch after closing and reopening', async () => {
    let resolveFirst!: (value: typeof rows) => void
    engine.listRecentlyDeleted
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValueOnce([rows[1]])

    const { rerender } = render(<RecentlyDeletedDialog isOpen onClose={vi.fn()} />)
    rerender(<RecentlyDeletedDialog isOpen={false} onClose={vi.fn()} />)
    rerender(<RecentlyDeletedDialog isOpen onClose={vi.fn()} />)

    expect(await screen.findByText('Demo Song B')).toBeTruthy()

    resolveFirst([rows[0]])
    await Promise.resolve()
    expect(screen.queryByText('Demo Song C')).toBeNull()
    expect(screen.getByText('Demo Song B')).toBeTruthy()
  })

  it('drops a restore notice if the dialog closes before restore finishes', async () => {
    let resolveRestore!: (value: 'restored') => void
    engine.listRecentlyDeleted.mockResolvedValue(rows)
    engine.restoreDeletedSet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRestore = resolve
        }),
    )

    const { rerender } = render(<RecentlyDeletedDialog isOpen onClose={vi.fn()} />)
    await screen.findAllByRole('listitem')
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0])

    rerender(<RecentlyDeletedDialog isOpen={false} onClose={vi.fn()} />)
    resolveRestore('restored')
    await Promise.resolve()

    rerender(<RecentlyDeletedDialog isOpen onClose={vi.fn()} />)
    await screen.findAllByRole('listitem')
    expect(screen.queryByText('Restored “Demo Song C”.')).toBeNull()
  })

  it('shows offline and generic errors when restore fails', async () => {
    engine.listRecentlyDeleted.mockResolvedValue(rows)
    engine.restoreDeletedSet
      .mockRejectedValueOnce(new engine.AccountOfflineError())
      .mockRejectedValueOnce(new Error('boom'))
    renderDialog()

    await screen.findAllByRole('listitem')
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0])
    expect(await screen.findByText('Recently deleted needs a connection.')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0])
    expect(await screen.findByText("Couldn't restore this set. Try again.")).toBeTruthy()
  })

  it('uses calendar days for Today and Yesterday', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const morning = new Date(2026, 10, 27, 9, 0, 0).getTime()
      const lastNight = new Date(2026, 10, 26, 23, 0, 0).getTime()
      vi.setSystemTime(morning)
      engine.listRecentlyDeleted.mockResolvedValue([
        { setId: 'set-y', name: 'Demo Last Night', songCount: 1, deletedAt: lastNight },
      ])

      renderDialog()
      const item = await screen.findByRole('listitem')
      expect(item.textContent).toContain('Yesterday')
      expect(item.textContent).not.toContain('Today')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the Restore button on one row with truncated text', async () => {
    engine.listRecentlyDeleted.mockResolvedValue([rows[0]])
    renderDialog()

    const item = await screen.findByRole('listitem')
    expect(item.className).not.toContain('flex-wrap')
    expect(item.firstElementChild?.className).toContain('flex-1')
  })
})
