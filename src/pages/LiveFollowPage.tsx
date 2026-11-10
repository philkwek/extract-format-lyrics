import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, Clock3, Radio } from 'lucide-react'
import { trackEvent } from '../lib/analytics'
import { openLiveShareOnce } from '../lib/liveFollow'
import { sessionPath } from '../lib/sessionStore'
import { useSeo } from '../lib/useSeo'
import { Button, Surface } from '../components/ui'

type ViewState = 'loading' | 'expired' | 'missing' | 'stopped' | 'error'

const messages: Record<Exclude<ViewState, 'loading'>, { title: string; body: string }> = {
  expired: {
    title: 'This live share has expired',
    body: 'Ask the person sharing to open the set and send the link again.',
  },
  missing: {
    title: 'This live share isn’t available',
    body: 'The link may be wrong or may have expired. Ask the person sharing for a new link.',
  },
  stopped: {
    title: 'This live share was stopped',
    body: 'This live share was stopped. Ask the person sharing for a new link.',
  },
  error: {
    title: 'Could not open the live set',
    body: 'Something went wrong while loading this set. Check your connection and try again.',
  },
}

/** Opens a live share link: fetches the host's set, then goes to the local copy. */
export default function LiveFollowPage() {
  useSeo({ title: 'Live Set | Sets & Sheets', noindex: true })
  const { liveId } = useParams<{ liveId: string }>()
  const navigate = useNavigate()
  const [state, setState] = useState<ViewState>('loading')

  useEffect(() => {
    let cancelled = false
    if (!liveId) return
    openLiveShareOnce(liveId)
      .then((result) => {
        if (result.kind === 'opened' || result.kind === 'reused') {
          trackEvent('live_share_followed', { outcome: result.kind })
          // Navigate even if cancelled (StrictMode remount): the session now exists locally.
          navigate(sessionPath(result.session), { replace: true })
          return
        }
        trackEvent('live_share_followed', { outcome: result.kind })
        if (!cancelled) setState(result.kind)
      })
      .catch(() => {
        trackEvent('live_share_followed', { outcome: 'error' })
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [liveId, navigate])

  if (state === 'loading') {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <Surface elevated className="space-y-4 p-8">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-ui-accent/10 text-ui-accent-strong">
            <Radio className="animate-pulse" size={23} />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-[-0.025em] text-[var(--ui-text)]">Opening the live set</h1>
            <p className="mt-2 text-sm text-[var(--ui-text-muted)]" role="status">Retrieving the set...</p>
          </div>
        </Surface>
      </div>
    )
  }

  const { title, body } = messages[state]
  const calm = state === 'expired' || state === 'stopped'

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <Surface elevated className="space-y-4 p-8">
        <span className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl ${calm ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
          {calm ? <Clock3 size={23} /> : <AlertTriangle size={23} />}
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-[-0.025em] text-[var(--ui-text)]">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--ui-text-muted)]">{body}</p>
        </div>
        <Button variant="primary" onClick={() => navigate('/')}>Return home</Button>
      </Surface>
    </div>
  )
}
