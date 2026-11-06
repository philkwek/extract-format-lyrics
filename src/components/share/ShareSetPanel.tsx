import { useEffect, useState } from 'react'
import { Check, Copy, CopyPlus, Radio } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ensureSetLinkFresh } from '../../lib/setLinkSync'
import {
  getLiveShare,
  startLiveShare,
  stopLiveShare,
  subscribeLiveShareStatus,
  type LiveShareStatus,
} from '../../lib/liveShareSync'
import { sessionPath, sessionStore, type Session } from '../../lib/sessionStore'
import { Button, SegmentedControl } from '../ui'

interface ShareSetPanelProps {
  session: Session
  canShareLive?: boolean
}

type ShareMode = 'copy' | 'live'
type LinkErrorReason = 'empty' | 'too_many' | 'failed'

function linkErrorMessage(reason: LinkErrorReason): string {
  if (reason === 'empty') return 'Add a song before you share this set.'
  if (reason === 'too_many') return 'A set link holds up to 30 songs. Remove some and try again.'
  return 'Could not make the link. Check your connection and try again.'
}

export default function ShareSetPanel({ session, canShareLive = true }: ShareSetPanelProps) {
  const [mode, setMode] = useState<ShareMode>('copy')
  const [copied, setCopied] = useState(false)
  const [liveUrl, setLiveUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [status, setStatus] = useState<LiveShareStatus>('ok')
  const [busy, setBusy] = useState<'copy' | 'start' | 'stop' | 'create' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!canShareLive || session.liveSourceId) return
    let cancelled = false
    getLiveShare(session.id).then((share) => {
      if (cancelled || !share) return
      setLiveUrl(share.url)
      setExpiresAt(share.expiresAt ?? null)
      setMode('live')
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

  const handleCopyCopy = async () => {
    if (busy) return
    setBusy('copy')
    setError(null)
    const result = await ensureSetLinkFresh(session)
    setBusy(null)
    if (!result.ok) {
      setError(linkErrorMessage(result.reason))
      return
    }
    await copyText(`${window.location.origin}${sessionPath(session)}`)
  }

  const handleCreateCopy = async () => {
    if (busy) return
    setBusy('create')
    setError(null)
    try {
      const copy = await sessionStore.createSession(structuredClone(session.songs), session.name)
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

  const hasUploads = session.songs.some((item) => item.url?.startsWith('upload://'))
  const showLive = canShareLive && mode === 'live'
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

  return (
    <div className="space-y-3 flex flex-col">
      {canShareLive && (
        <SegmentedControl
          label="How to share this set"
          value={mode}
          onChange={setMode}
          className="w-full self-center"
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
          {hasUploads && canShareLive && (
            <p className="text-xs leading-5 text-[var(--ui-text-muted)]">
              Uploaded sheets aren&rsquo;t included. Use <strong>Share live</strong> to send them.
            </p>
          )}
          <p className="text-xs text-[var(--ui-text-muted)]">
            This is the same as copying this page&rsquo;s address.
          </p>
          <div className="flex justify-end">
            <Button
              variant="primary"
              icon={copied ? <Check size={15} /> : <Copy size={15} />}
              onClick={handleCopyCopy}
              loading={busy === 'copy'}
            >
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs leading-5 text-[var(--ui-text-muted)]">
            People see your chord edits, sections and changes as you make them. They follow your
            edits until they change the set themselves. The link stops working 7 days after your
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
      )}

      {error && (
        <p role="alert" className="text-[11px] text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  )
}
