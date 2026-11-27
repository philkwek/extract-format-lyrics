import { useEffect, useId, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { CircleUserRound } from 'lucide-react'
import { Button, StatusBanner } from './ui'
import OverlayDialog from './ui/OverlayDialog'
import {
  loadAuth,
  onUser,
  reauthenticate,
  sendEmailLink,
  signInWithGoogle,
  signOut,
  type AccountUser,
} from '../lib/auth'
import { deleteAccount } from '../lib/accountSync'
import { trackEvent } from '../lib/analytics'
import { getSyncStatus, subscribeSyncStatus, type SyncStatus } from '../lib/syncStatus'

const STATUS_LABELS: Record<SyncStatus, string> = {
  synced: 'Synced',
  syncing: 'Syncing',
  offline: 'Offline - will sync later',
  'needs-choice': 'Needs your choice',
}

export default function AccountMenu() {
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [linkSent, setLinkSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'google' | 'email' | 'sign-out' | null>(null)
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus)
  const [step, setStep] = useState<'menu' | 'confirm'>('menu')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const emailId = useId()

  useEffect(() => onUser(setUser), [])
  useEffect(() => subscribeSyncStatus(setStatus), [])

  function openMenu() {
    setError(null)
    setLinkSent(false)
    setStep('menu')
    setDeleteError(null)
    setOpen(true)
    if (!user) void loadAuth().catch(() => {})
  }

  async function handleGoogle() {
    trackEvent('account_sign_in_started', { method: 'google' })
    setBusy('google')
    setError(null)
    const result = await signInWithGoogle()
    setBusy(null)
    if (result.status === 'error') {
      setError(result.message)
    } else if (result.status !== 'cancelled') {
      if (result.status === 'done') trackEvent('account_signed_in', { method: 'google' })
      setOpen(false)
    }
  }

  async function handleEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    trackEvent('account_sign_in_started', { method: 'email_link' })
    setBusy('email')
    setError(null)
    const result = await sendEmailLink(email)
    setBusy(null)
    if (result.ok) setLinkSent(true)
    else setError(result.message)
  }

  async function handleSignOut() {
    setBusy('sign-out')
    setError(null)
    const result = await signOut()
    setBusy(null)
    if (result.ok) setOpen(false)
    else setError(result.message)
  }

  async function handleDelete() {
    setDeleteError(null)
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setDeleteError('Deleting your account needs a connection.')
      return
    }
    setDeleteBusy(true)
    try {
      let result = await deleteAccount()
      if (result === 'reauth') {
        const again = await reauthenticate()
        if (again.status === 'link-sent') {
          setDeleteError('We emailed you a sign-in link. Open it, then press Delete account again.')
          return
        }
        if (again.status === 'error') {
          setDeleteError(again.message)
          return
        }
        if (again.status === 'cancelled' || again.status === 'redirect') return
        result = await deleteAccount()
      }
      if (result === 'deleted') {
        setOpen(false)
        return
      }
      setDeleteError("Couldn't delete your account. Try again.")
    } catch {
      setDeleteError("Couldn't delete your account. Try again.")
    } finally {
      setDeleteBusy(false)
    }
  }

  if (user === undefined) return null

  const confirming = Boolean(user) && step === 'confirm'

  return (
    <>
      {user ? (
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Account, signed in as ${user.email ?? 'you'}`}
          icon={<CircleUserRound size={15} className="md:hidden" />}
          onClick={openMenu}
        >
          <span className="hidden max-w-[14rem] truncate md:block">{user.email ?? 'Account'}</span>
        </Button>
      ) : (
        <Button variant="secondary" size="sm" onClick={openMenu}>
          Sign in
        </Button>
      )}
      {createPortal(
        <OverlayDialog
          isOpen={open}
          onClose={() => setOpen(false)}
          title={confirming ? 'Delete account' : user ? 'Account' : 'Sign in'}
          description={user ? undefined : 'Sign in to keep your sets on every device.'}
          size="sm"
          footer={
            confirming ? undefined : (
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Close
              </Button>
            )
          }
        >
          {user ? (
            step === 'confirm' ? (
              <div className="space-y-4">
                <p className="text-ui-text text-sm">
                  Delete your account? Your sets, songs and Recently deleted in your account are
                  removed for good. Sets on this device stay here.
                </p>
                {deleteError && <StatusBanner tone="error">{deleteError}</StatusBanner>}
                <div className="space-y-2">
                  <Button
                    variant="danger"
                    className="w-full"
                    loading={deleteBusy}
                    onClick={handleDelete}
                  >
                    Delete account
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full"
                    disabled={deleteBusy}
                    onClick={() => setStep('menu')}
                  >
                    Go back
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="min-w-0">
                  <p className="text-ui-text-muted text-xs font-medium">Signed in as</p>
                  <p className="text-ui-text mt-0.5 text-sm font-semibold break-all">
                    {user.email ?? 'Your account'}
                  </p>
                </div>
                <div className="border-ui-border rounded-xl border p-3">
                  <p className="text-ui-text-muted text-xs font-medium">Sync status</p>
                  <p role="status" className="text-ui-text mt-0.5 text-sm font-semibold">
                    {STATUS_LABELS[status]}
                  </p>
                </div>
                {error && <StatusBanner tone="error">{error}</StatusBanner>}
                <div className="space-y-2">
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={handleSignOut}
                    loading={busy === 'sign-out'}
                  >
                    Sign out
                  </Button>
                  <Button
                    variant="danger"
                    className="w-full"
                    onClick={() => {
                      setDeleteError(null)
                      setStep('confirm')
                    }}
                  >
                    Delete account
                  </Button>
                </div>
              </div>
            )
          ) : (
            <div className="space-y-4">
              <form className="space-y-2" onSubmit={handleEmail}>
                <label htmlFor={emailId} className="text-ui-text block text-sm font-medium">
                  Email address
                </label>
                <input
                  id={emailId}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  className="ui-field min-h-11 px-3 text-base"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  className="w-full"
                  loading={busy === 'email'}
                >
                  Send sign-in link
                </Button>
              </form>
              <div className="flex items-center gap-3">
                <span className="bg-ui-border h-px flex-1" />
                <span className="text-ui-text-muted text-xs">or</span>
                <span className="bg-ui-border h-px flex-1" />
              </div>
              <Button
                variant="primary"
                className="w-full"
                onClick={handleGoogle}
                loading={busy === 'google'}
              >
                Continue with Google
              </Button>
              {linkSent && (
                <StatusBanner tone="success">Check your email for a sign-in link.</StatusBanner>
              )}
              {error && <StatusBanner tone="error">{error}</StatusBanner>}
            </div>
          )}
        </OverlayDialog>,
        document.body,
      )}
    </>
  )
}
