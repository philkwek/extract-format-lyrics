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

const diffs = [
  { label: 'Demo Song A · Chosen key', local: 'G', remote: 'A' },
  { label: 'Song order', local: 'Reordered', remote: 'Reordered' },
]

function renderDialog(onClose = vi.fn()) {
  render(<SyncConflictDialog isOpen sessionId="set-1" diffs={diffs} onClose={onClose} />)
  return onClose
}

describe('SyncConflictDialog', () => {
  it('shows a left-right comparison with green local and red cloud cards', () => {
    renderDialog()
    expect(screen.getByRole('heading', { name: 'Choose which version to keep' })).toBeTruthy()
    expect(
      screen.getByText('This set changed in two places. Pick one version; the other is replaced.'),
    ).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Demo Song A · Chosen key' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Song order' })).toBeTruthy()
    const localCard = screen.getByText('G').closest('div')!
    const remoteCard = screen.getByText('A').closest('div')!
    expect(localCard.className).toContain('ui-diff-local')
    expect(localCard.textContent).toContain('This device')
    expect(remoteCard.className).toContain('ui-diff-remote')
    expect(remoteCard.textContent).toContain('Cloud version')
    expect(screen.getByRole('button', { name: 'Keep this device' }).className).toContain(
      'ui-button--diff-local',
    )
    expect(screen.getByRole('button', { name: 'Use cloud version' }).className).toContain(
      'ui-button--diff-remote',
    )
  })

  it('keeps this device and closes on success', async () => {
    const onClose = renderDialog()
    resolveConflict.mockResolvedValueOnce(undefined)

    fireEvent.click(screen.getByRole('button', { name: 'Keep this device' }))

    await waitFor(() => expect(resolveConflict).toHaveBeenCalledWith('set-1', 'keep-local'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('uses the cloud version and closes on success', async () => {
    const onClose = renderDialog()
    resolveConflict.mockResolvedValueOnce(undefined)

    fireEvent.click(screen.getByRole('button', { name: 'Use cloud version' }))

    await waitFor(() => expect(resolveConflict).toHaveBeenCalledWith('set-1', 'use-remote'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('disables both buttons while a choice is running', async () => {
    renderDialog()
    resolveConflict.mockReturnValue(new Promise(() => {}))

    fireEvent.click(screen.getByRole('button', { name: 'Keep this device' }))

    const keepBtn = await screen.findByRole('button', { name: 'Keep this device', busy: true })
    const cloudBtn = screen.getByRole('button', { name: 'Use cloud version' })
    expect((keepBtn as HTMLButtonElement).disabled).toBe(true)
    expect((cloudBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('deduplicates repeated diffs', () => {
    render(
      <SyncConflictDialog
        isOpen
        sessionId="set-1"
        diffs={[diffs[0], diffs[0]]}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getAllByText('Demo Song A · Chosen key')).toHaveLength(1)
  })

  it('says in plain words when the choice fails and keeps the dialog open', async () => {
    const onClose = renderDialog()
    resolveConflict.mockRejectedValueOnce(new Error('offline'))

    fireEvent.click(screen.getByRole('button', { name: 'Use cloud version' }))

    expect(await screen.findByText("Couldn't update the set. Try again.")).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
})
