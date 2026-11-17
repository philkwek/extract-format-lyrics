// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChangeToast from '../../../src/components/share/ChangeToast'

describe('ChangeToast', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  const note = { text: 'Song removed' }

  it('closes itself after a few seconds', () => {
    const onDismiss = vi.fn()
    render(<ChangeToast note={note} onDismiss={onDismiss} />)
    act(() => vi.advanceTimersByTime(4900))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(100))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('offers a single action such as Undo', () => {
    const onDismiss = vi.fn()
    const run = vi.fn()
    render(
      <ChangeToast
        note={{ ...note, action: { label: 'Undo', run } }}
        onDismiss={onDismiss}
        dismissible={false}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(run).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('the undo toast does not pause on hover', () => {
    const onDismiss = vi.fn()
    render(<ChangeToast note={note} onDismiss={onDismiss} pauseOnHover={false} />)
    const toast = screen.getByRole('button', { name: 'Dismiss' }).parentElement!
    fireEvent.mouseEnter(toast)
    act(() => vi.advanceTimersByTime(5000))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('keeps waiting while the pointer is on it by default', () => {
    const onDismiss = vi.fn()
    render(<ChangeToast note={note} onDismiss={onDismiss} />)
    const toast = screen.getByRole('button', { name: 'Dismiss' }).parentElement!
    fireEvent.mouseEnter(toast)
    act(() => vi.advanceTimersByTime(10000))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('draws the draining ring when a progress window is set', () => {
    render(<ChangeToast note={note} onDismiss={vi.fn()} progressMs={5000} />)
    expect(document.querySelector('[data-undo-ring]')).toBeTruthy()
  })
})
