import { useEffect, useState } from 'react'
import { Check, Copy, Radio } from 'lucide-react'
import { ensureSetLinkFresh } from '../../lib/setLinkSync'
import {
  getLiveShare,
  startLiveShare,
  stopLiveShare,
  subscribeLiveShareStatus,
  type LiveShareStatus,
} from '../../lib/liveShareSync'
import { sessionPath, type Session } from '../../lib/sessionStore'
import { Button, SegmentedControl } from '../ui'

interface ShareSetPanelProps {
  session: Session
  canShareLive?: boolean
}

type ShareMode = 'copy' | 'live'

export default function ShareSetPanel({ session, canShareLive = true }: ShareSetPanelProps) {
  const [mode, setMode] = useState<ShareMode>('copy')
  const [copied, setCopied] = useState(false)
  const [liveUrl, setLiveUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [status, setStatus] = useState<LiveShareStatus>('ok')
  const [busy, setBusy] = useState<'copy' | 'start' | 'stop' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!canShareLive) return
    let cancelled = false
    getLiveShare(session.id).then((url) => {
      if (cancelled || !url) return
      setLiveUrl(url)
      setMode('live')
    })
    const unsubscribe = subscribeLiveShareStatus(session.id, setStatus)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [session.id, canShareLive])

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      window.prompt('Copy this share link:', text)
    }
  }

  const handleCopyCopy = async () => {
    if (busy) return
    setBusy('copy')
    setError(null)
    await ensureSetLinkFresh(session)
    setBusy(null)
    await copyText(`${window.location.origin}${sessionPath(session)}`)
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

  const hasUploads = session.songs.some((item) => item.url?.startsWith('upload://'))
  const showLive = canShareLive && mode === 'live'

  return (
    <div className="space-y-3">
      {canShareLive && (
        <SegmentedControl
          label="How to share this set"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'copy', label: 'Send a copy' },
            { value: 'live', label: 'Share live' },
          ]}
        />
      )}

      {!showLive ? (
        <div className="space-y-3">
          <p className="text-xs leading-5 text-[var(--ui-text-muted)]">
            People get their own copy of the songs and keys as they are now. Your chord and
            section edits aren&rsquo;t included, and later changes won&rsquo;t reach them.
          </p>
          {hasUploads && (
            <p className="text-xs leading-5 text-[var(--ui-text-muted)]">
              Uploaded sheets aren&rsquo;t included. Use <strong>Share live</strong> to send them.
            </p>
          )}
          <p className="text-xs text-[var(--ui-text-muted)]">
            This is the same as copying this page&rsquo;s address.
          </p>
          <Button
            variant="primary"
            icon={copied ? <Check size={15} /> : <Copy size={15} />}
            onClick={handleCopyCopy}
            loading={busy === 'copy'}
          >
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs leading-5 text-[var(--ui-text-muted)]">
            People see your chord edits, sections and changes as you make them. They can turn on{' '}
            <strong>Follow Host Edits</strong> to keep up. The link stops working 7 days after your
            last change.
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
                  Not updating. Your latest changes haven&rsquo;t reached people following this set.
                </p>
              )}
              {expiresAt && (
                <p className="text-[11px] text-[var(--ui-text-muted)]">
                  Expires {new Date(expiresAt).toLocaleString()}
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
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
            <Button
              variant="primary"
              icon={<Radio size={15} />}
              onClick={handleStart}
              loading={busy === 'start'}
            >
              Start live share
            </Button>
          )}
        </div>
      )}

      {error && <p className="text-[11px] text-red-600 dark:text-red-300">{error}</p>}
    </div>
  )
}
