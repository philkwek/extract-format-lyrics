// @vitest-environment jsdom
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useModalFocus } from '../../../src/components/ui/useModalFocus'

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

function ModalHarness({ onClose }: { onClose: () => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const close = () => {
    onClose()
    setIsOpen(false)
  }
  const handleKeyDown = useModalFocus(isOpen, panelRef, close)

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open panel
      </button>
      {isOpen && (
        <div ref={panelRef} role="dialog" tabIndex={-1} onKeyDown={handleKeyDown}>
          <button type="button">First action</button>
          <button type="button" onClick={close}>
            Close panel
          </button>
        </div>
      )}
    </>
  )
}

describe('useModalFocus', () => {
  it('focuses the first panel control and locks body scroll on open', async () => {
    const user = userEvent.setup()
    render(<ModalHarness onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Open panel' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'First action' })).toBe(document.activeElement),
    )
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('restores body overflow and focus when closed', async () => {
    document.body.style.overflow = 'scroll'
    const user = userEvent.setup()
    render(<ModalHarness onClose={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'Open panel' })

    await user.click(trigger)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'First action' })).toBe(document.activeElement),
    )

    await user.click(screen.getByRole('button', { name: 'Close panel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.body.style.overflow).toBe('scroll')
    expect(trigger).toBe(document.activeElement)
  })

  it('wraps Tab and Shift+Tab inside the panel', async () => {
    const user = userEvent.setup()
    render(<ModalHarness onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Open panel' }))
    const first = screen.getByRole('button', { name: 'First action' })
    const last = screen.getByRole('button', { name: 'Close panel' })
    await waitFor(() => expect(first).toBe(document.activeElement))

    await user.tab()
    expect(last).toBe(document.activeElement)

    await user.tab()
    expect(first).toBe(document.activeElement)

    await user.tab({ shift: true })
    expect(last).toBe(document.activeElement)
  })

  it('calls onClose once on Escape', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<ModalHarness onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Open panel' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'First action' })).toBe(document.activeElement),
    )

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledOnce()
  })
})
