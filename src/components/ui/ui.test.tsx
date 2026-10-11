// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, SegmentedControl } from './index'
import OverlayDialog from './OverlayDialog'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

afterEach(cleanup)

function SegmentedHarness() {
  const [value, setValue] = useState<'paste' | 'search'>('paste')
  return (
    <SegmentedControl
      label="Source"
      value={value}
      onChange={setValue}
      options={[
        { value: 'paste', label: 'Paste' },
        { value: 'search', label: 'Search' },
      ]}
    />
  )
}

function DialogHarness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <OverlayDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Test dialog"
        footer={<Button onClick={() => setOpen(false)}>Done</Button>}
      >
        <button type="button">First action</button>
      </OverlayDialog>
    </>
  )
}

describe('UI primitives', () => {
  it('updates segmented selection with accessible tab state', async () => {
    const user = userEvent.setup()
    render(<SegmentedHarness />)

    expect(screen.getByRole('tab', { name: 'Paste' }).getAttribute('aria-selected')).toBe('true')
    await user.click(screen.getByRole('tab', { name: 'Search' }))
    expect(screen.getByRole('tab', { name: 'Search' }).getAttribute('aria-selected')).toBe('true')
  })

  it('closes on Escape and restores focus to its trigger', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)
    const trigger = screen.getByRole('button', { name: 'Open dialog' })

    await user.click(trigger)
    expect(screen.getByRole('dialog')).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toBe(document.activeElement))
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(trigger).toBe(document.activeElement)
  })

  it('wraps focus from the final dialog action to the close button', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)
    await user.click(screen.getByRole('button', { name: 'Open dialog' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toBe(document.activeElement))

    const done = screen.getByRole('button', { name: 'Done' })
    done.focus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Close' })).toBe(document.activeElement)
  })
})
