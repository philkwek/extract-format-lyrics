// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SyncConflictDialog from '../../src/components/SyncConflictDialog'
import { trackEvent } from '../../src/lib/analytics'

const resolveConflict = vi.hoisted(() => vi.fn())

vi.mock('../../src/lib/accountSync', () => ({ resolveConflict }))
vi.mock('../../src/lib/analytics', () => ({ trackEvent: vi.fn() }))

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
  vi.mocked(trackEvent).mockClear()
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
  it('reports the conflict once each time it opens', () => {
    const { rerender } = render(
      <SyncConflictDialog isOpen={false} sessionId="set-1" diffs={diffs} onClose={vi.fn()} />,
    )
    expect(trackEvent).not.toHaveBeenCalled()

    rerender(<SyncConflictDialog isOpen sessionId="set-1" diffs={diffs} onClose={vi.fn()} />)
    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith('account_conflict_shown', {})

    rerender(<SyncConflictDialog isOpen sessionId="set-1" diffs={[diffs[0]]} onClose={vi.fn()} />)
    expect(trackEvent).toHaveBeenCalledTimes(1)

    rerender(
      <SyncConflictDialog isOpen={false} sessionId="set-1" diffs={diffs} onClose={vi.fn()} />,
    )
    rerender(<SyncConflictDialog isOpen sessionId="set-1" diffs={diffs} onClose={vi.fn()} />)
    expect(trackEvent).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(vi.mocked(trackEvent).mock.calls)).not.toContain('set-1')
  })

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
