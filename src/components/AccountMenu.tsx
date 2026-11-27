import { useEffect, useId, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { CircleUserRound } from 'lucide-react'
import { Button, StatusBanner } from './ui'
import OverlayDialog from './ui/OverlayDialog'
import { onUser, sendEmailLink, signInWithGoogle, signOut, type AccountUser } from '../lib/auth'
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
  const emailId = useId()

  useEffect(() => onUser(setUser), [])
  useEffect(() => subscribeSyncStatus(setStatus), [])

  function openMenu() {
    setError(null)
    setLinkSent(false)
    setOpen(true)
  }

  async function handleGoogle() {
    setBusy('google')
    setError(null)
    const result = await signInWithGoogle()
    setBusy(null)
    if (result.status === 'error') {
      setError(result.message)
    } else if (result.status !== 'cancelled') {
      setOpen(false)
    }
  }

  async function handleEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
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

  if (user === undefined) return null

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
          title={user ? 'Account' : 'Sign in'}
          description={user ? undefined : 'Sign in to keep your sets on every device.'}
          size="sm"
          footer={
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
          }
        >
          {user ? (
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
                <Button variant="ghost" className="w-full" disabled>
                  Delete account
                </Button>
                <p className="text-ui-text-muted text-center text-xs">
                  Delete account isn't available yet.
                </p>
              </div>
            </div>
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
