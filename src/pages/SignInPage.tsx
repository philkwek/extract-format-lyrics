import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, StatusBanner, Surface } from '../components/ui'
import { completeEmailLink, type EmailLinkResult } from '../lib/auth'
import { trackEvent } from '../lib/analytics'
import { useSeo } from '../lib/useSeo'

export default function SignInPage() {
  useSeo({ title: 'Sign in · Sets & Sheets', noindex: true })
  const navigate = useNavigate()
  const [href] = useState(window.location.href)
  const [needsEmail, setNeedsEmail] = useState(false)
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const emailId = useId()

  const applyResult = useCallback(
    (result: EmailLinkResult) => {
      if (result.status === 'signed-in') {
        trackEvent('account_signed_in', { method: 'email_link' })
        navigate('/', { replace: true })
        return
      }
      if (result.status === 'email-needed') {
        setNeedsEmail(true)
        setBusy(false)
        return
      }
      setMessage(result.status === 'invalid' ? "This isn't a sign-in link." : result.message)
      setBusy(false)
    },
    [navigate],
  )

  useEffect(() => {
    let cancelled = false
    completeEmailLink(href)
      .then((result) => {
        if (!cancelled) applyResult(result)
      })
      .catch(() => {
        if (cancelled) return
        setMessage('Something went wrong. Try again.')
        setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [href, applyResult])

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      applyResult(await completeEmailLink(href, email))
    } catch {
      setMessage('Something went wrong. Try again.')
      setBusy(false)
    }
  }

  if (busy && !needsEmail) {
    return (
      <Surface className="mx-auto max-w-md space-y-2 p-5 text-center sm:p-8">
        <p role="status" className="text-sm">
          Signing you in...
        </p>
      </Surface>
    )
  }

  if (needsEmail) {
    return (
      <Surface className="mx-auto max-w-md space-y-4 p-5 sm:p-8">
        <h1 className="text-ui-text text-2xl font-bold">Finish signing in</h1>
        <p className="text-ui-text-muted text-sm">
          Enter the email address you used. This device doesn't have it saved.
        </p>
        <form className="space-y-2" onSubmit={submitEmail}>
          <label htmlFor={emailId} className="text-ui-text block text-sm font-medium">
            Email address
          </label>
          <input
            id={emailId}
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            autoFocus
            className="ui-field min-h-11 px-3 text-base"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            Finish signing in
          </Button>
        </form>
        {message && <StatusBanner tone="error">{message}</StatusBanner>}
      </Surface>
    )
  }

  return (
    <Surface className="mx-auto max-w-md space-y-4 p-5 text-center sm:p-8">
      <h1 className="text-ui-text text-2xl font-bold">Sign in</h1>
      <StatusBanner tone="info">{message ?? "This isn't a sign-in link."}</StatusBanner>
      <Button variant="secondary" onClick={() => navigate('/')}>
        Go back
      </Button>
    </Surface>
  )
}
