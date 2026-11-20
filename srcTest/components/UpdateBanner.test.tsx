// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UpdateBanner from '../../src/components/UpdateBanner'

afterEach(cleanup)

describe('UpdateBanner', () => {
  it('stays out of the page until a new build is found', () => {
    render(<UpdateBanner open={false} onReload={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.queryByText('New version available')).toBeNull()
  })

  it('asks before reloading, and can be dismissed', async () => {
    const user = userEvent.setup()
    const onReload = vi.fn()
    const onDismiss = vi.fn()
    render(<UpdateBanner open onReload={onReload} onDismiss={onDismiss} />)

    expect(screen.getByText('New version available')).toBeTruthy()
    expect(onReload).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Reload' }))
    expect(onReload).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
