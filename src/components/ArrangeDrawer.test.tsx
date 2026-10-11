// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ArrangeDrawer from './ArrangeDrawer'

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
})
