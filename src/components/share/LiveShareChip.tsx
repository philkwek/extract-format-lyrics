import { useEffect, useState } from 'react'
import { AlertTriangle, Radio } from 'lucide-react'
import {
  getLiveShare,
  subscribeLiveShare,
  subscribeLiveShareStatus,
  type LiveShareStatus,
} from '../../lib/liveShareSync'

export default function LiveShareChip({ sessionId }: { sessionId: string }) {
  const [isLive, setIsLive] = useState(false)
  const [status, setStatus] = useState<LiveShareStatus>('ok')

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      getLiveShare(sessionId).then((url) => {
        if (cancelled) return
        setIsLive(Boolean(url))
        if (!url) setStatus('ok')
      })
    }
    refresh()
    const stopLive = subscribeLiveShare(sessionId, refresh)
    const stopStatus = subscribeLiveShareStatus(sessionId, setStatus)
    return () => {
      cancelled = true
      stopLive()
      stopStatus()
    }
  }, [sessionId])

  if (!isLive) return null
  const failing = status === 'failing'
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        failing
          ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300'
          : 'border-[var(--ui-border)] bg-[var(--ui-surface-muted)] text-[var(--ui-text-muted)]'
      }`}
    >
      {failing ? <AlertTriangle size={11} aria-hidden="true" /> : <Radio size={11} aria-hidden="true" />}
      {failing ? 'Not updating' : 'Live'}
    </span>
  )
}
