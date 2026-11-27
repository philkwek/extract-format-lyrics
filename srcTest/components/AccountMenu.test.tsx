// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AccountMenu from '../../src/components/AccountMenu'
import { setSyncStatus } from '../../src/lib/syncStatus'
import type { AccountUser } from '../../src/lib/auth'

const mocks = vi.hoisted(() => ({
  onUser: vi.fn(),
  signInWithGoogle: vi.fn(),
  sendEmailLink: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('../../src/lib/auth', () => ({
  onUser: mocks.onUser,
  signInWithGoogle: mocks.signInWithGoogle,
  sendEmailLink: mocks.sendEmailLink,
  signOut: mocks.signOut,
}))

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
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

beforeEach(() => {
  vi.clearAllMocks()
  mocks.onUser.mockImplementation((callback: (user: AccountUser | null) => void) => {
    callback(null)
    return () => {}
  })
  mocks.signOut.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  setSyncStatus('synced')
})

function signedInAs(email: string) {
  mocks.onUser.mockImplementation((callback: (user: AccountUser | null) => void) => {
    callback({ uid: 'u1', email, displayName: null })
    return () => {}
  })
}

describe('AccountMenu', () => {
  it('offers Google and an email link when signed out', async () => {
    mocks.sendEmailLink.mockResolvedValue({ ok: true })
    render(<AccountMenu />)

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(screen.getByRole('dialog').className).toContain('ui-dialog--sm')
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy()
    expect(screen.getByLabelText('Email address')).toBeTruthy()

    await userEvent.type(screen.getByLabelText('Email address'), 'phil@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in link' }))

    expect(await screen.findByText('Check your email for a sign-in link.')).toBeTruthy()
    expect(mocks.sendEmailLink).toHaveBeenCalledWith('phil@example.com')
  })

  it('shows plain words for a failed sign in', async () => {
    mocks.signInWithGoogle.mockResolvedValue({
      status: 'error',
      message: "That email address doesn't look right.",
    })
    render(<AccountMenu />)

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("That email address doesn't look right.")
  })

  it('shows the email, sync status and sign out when signed in', async () => {
    signedInAs('phil@example.com')
    setSyncStatus('offline')
    render(<AccountMenu />)

    await userEvent.click(
      await screen.findByRole('button', { name: 'Account, signed in as phil@example.com' }),
    )

    expect(screen.getByText('Offline - will sync later')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Delete account' }) as HTMLButtonElement).disabled,
    ).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
  })
})
