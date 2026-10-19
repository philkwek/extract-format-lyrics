// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ArrangeDrawer from '../../src/components/ArrangeDrawer'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
})

afterEach(cleanup)

function ReorderHarness() {
  const [items, setItems] = useState([
    { id: 'one', title: 'First song' },
    { id: 'two', title: 'Second song' },
  ])

  return (
    <ArrangeDrawer
      isOpen
      title="Arrange setlist"
      items={items}
      onMove={(fromIndex, toIndex) => {
        setItems((current) => {
          const reordered = [...current]
          const [moved] = reordered.splice(fromIndex, 1)
          reordered.splice(toIndex, 0, moved)
          return reordered
        })
      }}
      onClose={vi.fn()}
    />
  )
}

describe('ArrangeDrawer', () => {
  it('exposes labelled reorder actions and closes on Escape', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <ArrangeDrawer
        isOpen
        title="Arrange setlist"
        items={[
          { id: 'one', title: 'First song' },
          { id: 'two', title: 'Second song' },
        ]}
        onMove={vi.fn()}
        onClose={onClose}
      />
    )

    expect(screen.getByRole('button', { name: 'Move First song down' })).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('keeps the moved song identity while its position changes', async () => {
    const user = userEvent.setup()
    render(<ReorderHarness />)

    await user.click(screen.getByRole('button', { name: 'Move First song down' }))

    expect(screen.getByRole('button', { name: 'Move First song up' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Move Second song down' })).toBeTruthy()
  })
})
