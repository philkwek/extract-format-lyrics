import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Clock3, DownloadCloud } from 'lucide-react'
import { trackEvent } from '../lib/analytics'
import { importFromSetLinkOnce } from '../lib/setLinkImport'
import { sessionPath } from '../lib/sessionStore'
import { Button, Surface } from './ui'

type ViewState = 'loading' | 'expired' | 'missing' | 'empty' | 'error'

export interface SetLinkNavState {
  fromSetLink: { name: string; reused: boolean }
}

/** Shown when a set-link URL has no local copy yet: imports it, then opens the copy. */
export default function SetLinkImportView({ linkId }: { linkId: string }) {
  const navigate = useNavigate()
  const [state, setState] = useState<ViewState>('loading')
  const [progress, setProgress] = useState('Retrieving the set...')

  useEffect(() => {
    let cancelled = false
    importFromSetLinkOnce(linkId, { onProgress: (m) => { if (!cancelled) setProgress(m) } })
      .then((result) => {
        if (result.kind === 'expired' || result.kind === 'missing' || result.kind === 'empty') {
          trackEvent('set_link_opened', { outcome: result.kind, song_count: 0 })
          if (!cancelled) setState(result.kind)
          return
        }
        const reused = result.kind === 'reused'
        trackEvent('set_link_opened', {
          outcome: reused ? 'reused' : 'imported',
          song_count: result.session.songs.length,
        })
        const nav: SetLinkNavState = {
          fromSetLink: { name: result.session.name, reused },
        }
        // Navigate even if cancelled (StrictMode remount): the session now exists locally.
        navigate(sessionPath(result.session), { replace: true, state: nav })
      })
      .catch(() => {
        trackEvent('set_link_opened', { outcome: 'error', song_count: 0 })
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [linkId, navigate])

  if (state === 'loading') {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <Surface elevated className="space-y-4 p-8">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-ui-accent/10 text-ui-accent-strong">
            <DownloadCloud className="animate-pulse" size={23} />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-[-0.025em] text-[var(--ui-text)]">Opening the shared set</h1>
            <p className="mt-2 text-sm text-[var(--ui-text-muted)]" role="status">{progress}</p>
          </div>
        </Surface>
      </div>
    )
  }

  const expired = state === 'expired'
  const title = expired
    ? 'This set link has expired'
    : state === 'missing'
      ? 'This set isn’t available'
      : state === 'empty'
        ? 'None of the songs could be loaded'
        : 'Could not open the set'
  const body = expired
    ? 'Ask the sender to open the set and send the link again.'
    : state === 'missing'
      ? 'This set isn’t available. The link may have expired, or the set hasn’t synced yet. Ask the sender to open the set and send the link again.'
      : state === 'empty'
        ? 'None of the chord sites for this set responded, so no copy was made. Try again later.'
        : 'Something went wrong while loading this set. Check your connection and try again.'

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <Surface elevated className="space-y-4 p-8">
        <span className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl ${expired ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
          {expired ? <Clock3 size={23} /> : <AlertTriangle size={23} />}
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
