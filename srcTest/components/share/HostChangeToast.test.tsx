// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HostChangeToast from '../../../src/components/share/HostChangeToast'

describe('HostChangeToast', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  const note = { text: 'Added “Bravo”' }

  it('closes itself after a few seconds', () => {
    const onDismiss = vi.fn()
    render(<HostChangeToast note={note} onDismiss={onDismiss} />)
    expect(screen.getByRole('status').textContent).toBe('Host: Added “Bravo”')
    act(() => vi.advanceTimersByTime(4900))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(100))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('waits while the pointer is on it', () => {
    const onDismiss = vi.fn()
    render(<HostChangeToast note={note} onDismiss={onDismiss} />)
    const toast = screen.getByRole('button', { name: 'Dismiss' }).parentElement!
    fireEvent.mouseEnter(toast)
    act(() => vi.advanceTimersByTime(10000))
    expect(onDismiss).not.toHaveBeenCalled()
    fireEvent.mouseLeave(toast)
    act(() => vi.advanceTimersByTime(5000))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('starts the timer again for a new note', () => {
    const onDismiss = vi.fn()
    const { rerender } = render(<HostChangeToast note={note} onDismiss={onDismiss} />)
    act(() => vi.advanceTimersByTime(4000))
    rerender(<HostChangeToast note={{ text: 'Changed the song order' }} onDismiss={onDismiss} />)
    act(() => vi.advanceTimersByTime(4000))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('offers Show only when there is a song to open', () => {
    const onShow = vi.fn()
    const { rerender } = render(<HostChangeToast note={note} onDismiss={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Show' })).toBeNull()
    rerender(<HostChangeToast note={{ ...note, onShow }} onDismiss={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(onShow).toHaveBeenCalled()
  })
})
