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
})
