// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AccountMenu from '../../src/components/AccountMenu'
import { trackEvent } from '../../src/lib/analytics'
import { setSyncStatus } from '../../src/lib/syncStatus'
import type { AccountUser } from '../../src/lib/auth'

vi.mock('../../src/lib/analytics', () => ({ trackEvent: vi.fn() }))

const mocks = vi.hoisted(() => ({
  onUser: vi.fn(),
  signInWithGoogle: vi.fn(),
  sendEmailLink: vi.fn(),
  signOut: vi.fn(),
  reauthenticate: vi.fn(),
  deleteAccount: vi.fn(),
}))

vi.mock('../../src/lib/auth', () => ({
  onUser: mocks.onUser,
  signInWithGoogle: mocks.signInWithGoogle,
  sendEmailLink: mocks.sendEmailLink,
  signOut: mocks.signOut,
  reauthenticate: mocks.reauthenticate,
}))

vi.mock('../../src/lib/accountSync', () => ({
  deleteAccount: mocks.deleteAccount,
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
  mocks.reauthenticate.mockResolvedValue({ status: 'done' })
  mocks.deleteAccount.mockResolvedValue('deleted')
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

async function openConfirm() {
  render(<AccountMenu />)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Account, signed in as phil@example.com' }),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Delete account' }))
}

describe('AccountMenu', () => {
  it('offers Google and an email link when signed out', async () => {
    mocks.sendEmailLink.mockResolvedValue({ ok: true })
    render(<AccountMenu />)

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(screen.getByRole('dialog').className).toContain('ui-dialog--sm')
    const googleButton = screen.getByRole('button', { name: 'Continue with Google' })
    const emailButton = screen.getByRole('button', { name: 'Send sign-in link' })
    expect(emailButton.compareDocumentPosition(googleButton)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(screen.getByLabelText('Email address')).toBeTruthy()

    await userEvent.type(screen.getByLabelText('Email address'), 'phil@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in link' }))

    expect(await screen.findByText('Check your email for a sign-in link.')).toBeTruthy()
    expect(mocks.sendEmailLink).toHaveBeenCalledWith('phil@example.com')
    expect(trackEvent).toHaveBeenCalledWith('account_sign_in_started', { method: 'email_link' })
    expect(JSON.stringify(vi.mocked(trackEvent).mock.calls)).not.toContain('phil@example.com')
  })

  it('reports a Google sign-in without sending the email', async () => {
    mocks.signInWithGoogle.mockResolvedValue({ status: 'done' })
    render(<AccountMenu />)

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith('account_signed_in', { method: 'google' }),
    )
    expect(trackEvent).toHaveBeenCalledWith('account_sign_in_started', { method: 'google' })
    expect(JSON.stringify(vi.mocked(trackEvent).mock.calls)).not.toMatch(/phil@example.com|u1/)
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
    ).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
  })

  it('asks for confirmation before deleting the account', async () => {
    signedInAs('phil@example.com')
    await openConfirm()

    expect(
      screen.getByText(
        'Delete your account? Your sets, songs and Recently deleted in your account are removed for good. Sets on this device stay here.',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Go back' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Delete account' })).toHaveLength(1)
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
  })

  it('goes back from the confirm step without deleting', async () => {
    signedInAs('phil@example.com')
    await openConfirm()

    await userEvent.click(screen.getByRole('button', { name: 'Go back' }))

    expect(mocks.deleteAccount).not.toHaveBeenCalled()
    expect(screen.getByText('Signed in as')).toBeTruthy()
    expect(screen.queryByText(/Delete your account\?/)).toBeNull()
  })

  it('signs in again with Google and retries the delete once', async () => {
    signedInAs('phil@example.com')
    mocks.deleteAccount.mockResolvedValueOnce('reauth').mockResolvedValueOnce('deleted')
    await openConfirm()

    await userEvent.click(screen.getAllByRole('button', { name: 'Delete account' })[0])

    await waitFor(() => expect(mocks.deleteAccount).toHaveBeenCalledTimes(2))
    expect(mocks.reauthenticate).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('asks the person to open the emailed link when the sign-in is old', async () => {
    signedInAs('phil@example.com')
    mocks.deleteAccount.mockResolvedValue('reauth')
    mocks.reauthenticate.mockResolvedValue({ status: 'link-sent' })
    await openConfirm()

    await userEvent.click(screen.getAllByRole('button', { name: 'Delete account' })[0])

    expect(
      await screen.findByText(
        'We emailed you a sign-in link. Open it, then press Delete account again.',
      ),
    ).toBeTruthy()
    expect(mocks.deleteAccount).toHaveBeenCalledTimes(1)
  })

  it('says a connection is needed when offline', async () => {
    signedInAs('phil@example.com')
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      await openConfirm()

      await userEvent.click(screen.getAllByRole('button', { name: 'Delete account' })[0])

      expect(await screen.findByText('Deleting your account needs a connection.')).toBeTruthy()
      expect(mocks.deleteAccount).not.toHaveBeenCalled()
    } finally {
      online.mockRestore()
    }
  })

  it('shows plain words when the delete fails', async () => {
    signedInAs('phil@example.com')
    mocks.deleteAccount.mockRejectedValue(new Error('boom'))
    await openConfirm()

    await userEvent.click(screen.getAllByRole('button', { name: 'Delete account' })[0])

    expect(await screen.findByText("Couldn't delete your account. Try again.")).toBeTruthy()
  })

  it('waits for redirect without retrying or showing an error when reauth redirects', async () => {
    signedInAs('phil@example.com')
    mocks.deleteAccount.mockResolvedValue('reauth')
    mocks.reauthenticate.mockResolvedValue({ status: 'redirect' })
    await openConfirm()

    await userEvent.click(screen.getAllByRole('button', { name: 'Delete account' })[0])

    await waitFor(() => expect(mocks.reauthenticate).toHaveBeenCalledTimes(1))
    expect(mocks.deleteAccount).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('disables Go back while delete is in flight', async () => {
    signedInAs('phil@example.com')
    let resolveDelete: (value: 'deleted') => void = () => {}
    mocks.deleteAccount.mockImplementation(
      () =>
        new Promise<'deleted'>((resolve) => {
          resolveDelete = resolve
        }),
    )
    await openConfirm()

    await userEvent.click(screen.getAllByRole('button', { name: 'Delete account' })[0])

    const goBack = screen.getByRole('button', { name: 'Go back' }) as HTMLButtonElement
    expect(goBack.disabled).toBe(true)

    resolveDelete('deleted')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
