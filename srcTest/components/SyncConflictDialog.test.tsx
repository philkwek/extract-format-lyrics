// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SyncConflictDialog from '../../src/components/SyncConflictDialog'

const resolveConflict = vi.hoisted(() => vi.fn())

vi.mock('../../src/lib/accountSync', () => ({ resolveConflict }))

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
  resolveConflict.mockReset()
})

const clashes = ['Both devices changed the key of Song A.', 'Song order changed on both.']

function renderDialog(onClose = vi.fn()) {
  render(<SyncConflictDialog isOpen sessionId="set-1" clashes={clashes} onClose={onClose} />)
  return onClose
}

describe('SyncConflictDialog', () => {
  it('lists what clashed', () => {
    renderDialog()
    expect(screen.getByRole('heading', { name: 'Choose which version to keep' })).toBeTruthy()
    expect(
      screen.getByText('This set changed in two places. Pick one version; the other is replaced.'),
    ).toBeTruthy()
    for (const clash of clashes) expect(screen.getByText(clash)).toBeTruthy()
  })

  it('keeps this device and closes on success', async () => {
    const onClose = renderDialog()
    resolveConflict.mockResolvedValueOnce(undefined)

    fireEvent.click(screen.getByRole('button', { name: 'Keep this device' }))

    await waitFor(() => expect(resolveConflict).toHaveBeenCalledWith('set-1', 'keep-local'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('uses the account version and closes on success', async () => {
    const onClose = renderDialog()
    resolveConflict.mockResolvedValueOnce(undefined)

    fireEvent.click(screen.getByRole('button', { name: 'Use account version' }))

    await waitFor(() => expect(resolveConflict).toHaveBeenCalledWith('set-1', 'use-remote'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('shows the busy state while the choice runs', async () => {
    renderDialog()
    resolveConflict.mockReturnValue(new Promise(() => {}))

    fireEvent.click(screen.getByRole('button', { name: 'Keep this device' }))

    expect(await screen.findByRole('button', { name: 'Keep this device', busy: true })).toBeTruthy()
  })

  it('says in plain words when the choice fails and keeps the dialog open', async () => {
    const onClose = renderDialog()
    resolveConflict.mockRejectedValueOnce(new Error('offline'))

    fireEvent.click(screen.getByRole('button', { name: 'Use account version' }))

    expect(await screen.findByText("Couldn't update the set. Try again.")).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
})
