// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, SegmentedControl, StatusBanner } from '../../../src/components/ui/index'
import OverlayDialog from '../../../src/components/ui/OverlayDialog'

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

function ThreeWaySegmentedHarness() {
  const [value, setValue] = useState<'paste' | 'search' | 'link'>('paste')
  return (
    <SegmentedControl
      label="Source"
      value={value}
      onChange={setValue}
      idPrefix="source"
      options={[
        { value: 'paste', label: 'Paste' },
        { value: 'search', label: 'Search' },
        { value: 'link', label: 'Link' },
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
  it('shows a status banner title above its message and actions beside it', () => {
    render(
      <StatusBanner title="Set saved" actions={<Button>Dismiss</Button>}>
        It won’t update.
      </StatusBanner>,
    )

    const message = screen.getByRole('status')
    expect(message.textContent).toBe('Set savedIt won’t update.')
    expect(message.contains(screen.getByRole('button', { name: 'Dismiss' }))).toBe(false)
    expect(message.closest('[title]')).toBeNull()
  })

  it('updates segmented selection with accessible tab state', async () => {
    const user = userEvent.setup()
    render(<SegmentedHarness />)

    const paste = screen.getByRole('tab', { name: 'Paste' })
    expect(paste.getAttribute('aria-selected')).toBe('true')
    expect(paste.id).toBe('')
    expect(paste.getAttribute('aria-controls')).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Search' }))
    expect(screen.getByRole('tab', { name: 'Search' }).getAttribute('aria-selected')).toBe('true')
  })

  it('selects and focuses the next tab when ArrowRight is pressed', async () => {
    const user = userEvent.setup()
    render(<SegmentedHarness />)
    screen.getByRole('tab', { name: 'Paste' }).focus()

    await user.keyboard('{ArrowRight}')

    const search = screen.getByRole('tab', { name: 'Search' })
    expect(search.getAttribute('aria-selected')).toBe('true')
    expect(search).toBe(document.activeElement)
  })

  it('wraps from the first tab to the last when ArrowLeft is pressed', async () => {
    const user = userEvent.setup()
    render(<ThreeWaySegmentedHarness />)
    screen.getByRole('tab', { name: 'Paste' }).focus()

    await user.keyboard('{ArrowLeft}')

    const link = screen.getByRole('tab', { name: 'Link' })
    expect(link.getAttribute('aria-selected')).toBe('true')
    expect(link).toBe(document.activeElement)
  })

  it('links each tab to its panel when given an id prefix', () => {
    render(<ThreeWaySegmentedHarness />)

    const search = screen.getByRole('tab', { name: 'Search' })
    expect(search.id).toBe('source-tab-search')
    expect(search.getAttribute('aria-controls')).toBe('source-panel-search')
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
