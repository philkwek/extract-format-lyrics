import { useEffect, useState } from 'react'
import { Check, Copy, CopyPlus, Link2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  getLiveShare,
  startLiveShare,
  stopLiveShare,
  subscribeLiveShareStatus,
  type LiveShareStatus,
} from '../../lib/liveShareSync'
import { sessionPath, sessionStore, type Session } from '../../lib/sessionStore'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { Button, SegmentedControl, Switch } from '../ui'
import SendCopyRow from './SendCopyRow'

interface ShareSetPanelProps {
  session: Session
  canShareLive?: boolean
}

export default function ShareSetPanel({ session, canShareLive = true }: ShareSetPanelProps) {
  const [copied, setCopied] = useState(false)
  const [liveUrl, setLiveUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [status, setStatus] = useState<LiveShareStatus>('ok')
  const online = useOnlineStatus()
  const [busy, setBusy] = useState<'start' | 'stop' | 'create' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingLive, setPendingLive] = useState<boolean | null>(null)
  const [mode, setMode] = useState<'copy' | 'live'>('copy')
  const navigate = useNavigate()

  useEffect(() => {
    if (!canShareLive || session.liveSourceId) return
    let cancelled = false
    getLiveShare(session.id).then((share) => {
      if (cancelled || !share) return
      setLiveUrl(share.url)
      setExpiresAt(share.expiresAt ?? null)
    })
    const unsubscribe = subscribeLiveShareStatus(session.id, setStatus)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [session.id, session.liveSourceId, canShareLive])

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      window.prompt('Copy this share link:', text)
    }
  }

  const handleCreateCopy = async () => {
    if (busy) return
    setBusy('create')
    setError(null)
    try {
      const copy = await sessionStore.createSetCopy(session)
      navigate(sessionPath(copy))
    } catch (err) {
      setError((err as Error).message || 'Could not make a copy. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const handleStart = async () => {
    if (busy) return
    setBusy('start')
    setPendingLive(true)
    setError(null)
    try {
      const result = await startLiveShare(session.id)
      setLiveUrl(result.url)
      setExpiresAt(result.expiresAt)
    } catch (err) {
      setError((err as Error).message || 'Could not start the live share.')
    } finally {
      setBusy(null)
      setPendingLive(null)
    }
  }

  const handleStop = async () => {
    if (busy) return
    setBusy('stop')
    setPendingLive(false)
    setError(null)
    try {
      await stopLiveShare(session.id)
      setLiveUrl(null)
      setExpiresAt(null)
      setStatus('ok')
    } catch (err) {
      setError((err as Error).message || 'Could not stop sharing. Try again.')
    } finally {
      setBusy(null)
      setPendingLive(null)
    }
  }

  const liveSourceUrl = session.liveSourceId
    ? `${window.location.origin}/live/${session.liveSourceId}`
    : null

  if (liveSourceUrl) {
    return (
      <div className="border-ui-border bg-ui-surface-raised rounded-xl border">
        <div className="space-y-3 p-3">
          <p className="text-ui-text-muted text-xs leading-5">
            This set follows someone else&rsquo;s live share.
          </p>
          <div className="space-y-2">
            <label
              htmlFor="share-source-live-url"
              className="text-ui-text-muted text-[11px] font-bold tracking-[0.12em] uppercase"
            >
              Live link
            </label>
            <input
              id="share-source-live-url"
              type="text"
              readOnly
              value={liveSourceUrl}
              className="ui-field px-3 py-2.5 font-mono text-xs select-all"
            />
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button
                variant="secondary"
                icon={copied ? <Check size={15} /> : <Copy size={15} />}
                onClick={() => copyText(liveSourceUrl)}
              >
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <Button
                variant="primary"
                icon={<CopyPlus size={15} />}
                onClick={handleCreateCopy}
                loading={busy === 'create'}
              >
                Create a copy
              </Button>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-[11px] text-red-600 dark:text-red-300">
              {error}
            </p>
          )}
        </div>
      </div>
    )
  }

  if (!canShareLive) {
    return <SendCopyRow session={session} canShareLive={false} />
  }

  return (
    <div className="space-y-3">
      <SegmentedControl
        label="Set sharing mode"
        value={mode}
        onChange={setMode}
        className="w-full"
        options={[
          { value: 'copy', label: 'Send a copy' },
          { value: 'live', label: 'Share live' },
        ]}
      />

      {mode === 'copy' ? (
        <SendCopyRow session={session} canShareLive={canShareLive} />
      ) : (
        <div className="space-y-2.5">
          <div className="flex min-h-[44px] items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-ui-text text-sm font-bold">Share live</p>
              <p className="text-ui-text-muted text-xs leading-5">
                {liveUrl
                  ? 'On. People with the link see your changes as you make them.'
                  : 'They see your changes as you make them.'}
              </p>
            </div>
            <Switch
              label="Share live"
              checked={pendingLive ?? Boolean(liveUrl)}
              busy={busy === 'start' || busy === 'stop'}
              onChange={(next) => (next ? handleStart() : handleStop())}
            />
          </div>

          {liveUrl && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Link2
                    size={15}
                    className="text-ui-text-muted pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    readOnly
                    aria-label="Live share link"
                    value={liveUrl.replace(/^https?:\/\//, '')}
                    className="ui-field truncate py-2 pr-3 pl-9 font-mono text-xs select-all"
                  />
                </div>
                <Button
                  variant="primary"
                  className="shrink-0"
                  icon={copied ? <Check size={15} /> : <Copy size={15} />}
                  onClick={() => copyText(liveUrl)}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              {expiresAt && (
                <p className="text-ui-text-muted text-xs leading-5">
                  Link works until {new Date(expiresAt).toLocaleDateString()}
                </p>
              )}
              {status === 'failing' && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  {online
                    ? 'Not updating. People can’t see your latest changes yet.'
                    : 'Offline. Followers get your changes when you’re back online.'}
                </p>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="text-[11px] text-red-600 dark:text-red-300">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
