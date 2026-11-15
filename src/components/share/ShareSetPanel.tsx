import { useEffect, useRef, useState } from 'react'
import { Check, Copy, CopyPlus, Radio } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  getLiveShare,
  startLiveShare,
  stopLiveShare,
  subscribeLiveShareStatus,
  type LiveShareStatus,
} from '../../lib/liveShareSync'
import { sessionPath, sessionStore, type Session } from '../../lib/sessionStore'
import { Button } from '../ui'

interface ShareSetPanelProps {
  session: Session
  canShareLive?: boolean
  onActiveChange?: (active: boolean) => void
}

export default function ShareSetPanel({
  session,
  canShareLive = true,
  onActiveChange,
}: ShareSetPanelProps) {
  const [copied, setCopied] = useState(false)
  const [liveUrl, setLiveUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [status, setStatus] = useState<LiveShareStatus>('ok')
  const [busy, setBusy] = useState<'start' | 'stop' | 'create' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const onActiveChangeRef = useRef(onActiveChange)

  useEffect(() => {
    onActiveChangeRef.current = onActiveChange
  }, [onActiveChange])

  useEffect(() => {
    onActiveChangeRef.current?.(Boolean(liveUrl))
  }, [liveUrl])

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
    setError(null)
    try {
      const result = await startLiveShare(session.id)
      setLiveUrl(result.url)
      setExpiresAt(result.expiresAt)
    } catch (err) {
      setError((err as Error).message || 'Could not start the live share.')
    } finally {
      setBusy(null)
    }
  }

  const handleStop = async () => {
    if (busy) return
    setBusy('stop')
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
    }
  }

  const liveSourceUrl = session.liveSourceId
    ? `${window.location.origin}/live/${session.liveSourceId}`
    : null

  if (liveSourceUrl) {
    return (
      <div className="space-y-3 flex flex-col">
        <p className="text-xs leading-5 text-[var(--ui-text-muted)]">
          This set comes from someone else&rsquo;s live share. Your own copy is yours to edit and
          share.
        </p>
        <div className="space-y-2">
          <label
            htmlFor="share-source-live-url"
            className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ui-text-muted)]"
          >
            Live link
          </label>
          <input
            id="share-source-live-url"
            type="text"
            readOnly
            value={liveSourceUrl}
            className="ui-field select-all px-3 py-2.5 font-mono text-xs"
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
    )
  }

  if (!canShareLive) return null

  return (
    <div className="space-y-3 flex flex-col">
      <div className="space-y-3">
        <p className="text-xs leading-5 text-[var(--ui-text-muted)]">
          They see your changes until they edit the set themselves. The link works for 7 days after
          your last change.
        </p>
        {liveUrl ? (
          <div className="space-y-2">
            <label
              htmlFor="share-live-url"
              className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ui-text-muted)]"
            >
              Live link
            </label>
            <input
              id="share-live-url"
              type="text"
              readOnly
              value={liveUrl}
              className="ui-field select-all px-3 py-2.5 font-mono text-xs"
            />
            {status === 'failing' && (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                Not updating. People can&rsquo;t see your latest changes yet.
              </p>
            )}
            {expiresAt && (
              <p className="text-[11px] text-[var(--ui-text-muted)]">
                Expires {new Date(expiresAt).toLocaleString()}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button
                variant="primary"
                icon={copied ? <Check size={15} /> : <Copy size={15} />}
                onClick={() => copyText(liveUrl)}
              >
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <Button variant="secondary" onClick={handleStop} loading={busy === 'stop'}>
                Stop sharing
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button
              variant="primary"
              icon={<Radio size={15} />}
              onClick={handleStart}
              loading={busy === 'start'}
            >
              Start live share
            </Button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-[11px] text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  )
}
