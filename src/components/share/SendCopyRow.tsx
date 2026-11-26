import { useState } from 'react'
import { Check, Copy, Link2 } from 'lucide-react'
import { ensureSetLinkFresh } from '../../lib/setLinkSync'
import { sessionPath, type Session } from '../../lib/sessionStore'
import { Button } from '../ui'

type LinkErrorReason = 'empty' | 'too_many' | 'failed'

function linkErrorMessage(reason: LinkErrorReason): string {
  if (reason === 'empty') return 'Add a song before you share this set.'
  if (reason === 'too_many') return 'A set link holds up to 30 songs. Remove some and try again.'
  return 'Could not make the link. Check your connection and try again.'
}

interface SendCopyRowProps {
  session: Session
  canShareLive: boolean
}

export default function SendCopyRow({ session, canShareLive }: SendCopyRowProps) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    setBusy(true)
    setError(null)
    const result = await ensureSetLinkFresh(session)
    setBusy(false)
    if (!result.ok) {
      setError(linkErrorMessage(result.reason))
      return
    }
    await copyText(`${window.location.origin}${sessionPath(session)}`)
  }

  const hasUploads = session.songs.some((item) => item.url?.startsWith('upload://'))
  const path = sessionPath(session)
  const displayUrl = `${window.location.host}${path}`

  return (
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
            aria-label="Set copy link"
            value={displayUrl}
            className="ui-field truncate py-2 pr-3 pl-9 font-mono text-xs select-all"
          />
        </div>
        <Button
          variant="primary"
          className="shrink-0"
          icon={copied ? <Check size={15} /> : <Copy size={15} />}
          onClick={handleCopyCopy}
          loading={busy}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="text-ui-text-muted text-xs leading-5">
        They get their own copy. Your chord changes stay with you.
      </p>
      {hasUploads && canShareLive && (
        <p className="text-ui-text-muted text-xs leading-5">
          Uploaded sheets aren&rsquo;t included. Use <strong>Share live</strong> to send them.
        </p>
      )}
      {error && (
        <p role="alert" className="text-[11px] text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  )
}
