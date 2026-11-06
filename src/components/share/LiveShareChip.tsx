import { useEffect, useState } from 'react'
import { AlertTriangle, Radio } from 'lucide-react'
import {
  getLiveShare,
  subscribeLiveShare,
  subscribeLiveShareStatus,
  type LiveShareStatus,
} from '../../lib/liveShareSync'
import { LivePill } from '../ui'

export default function LiveShareChip({
  sessionId,
  className,
}: {
  sessionId: string
  className?: string
}) {
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
  if (status === 'failing') {
    return (
      <LivePill tone="reconnecting" className={className}>
        <AlertTriangle size={11} aria-hidden="true" />
        Not updating
      </LivePill>
    )
  }
  return (
    <LivePill className={className}>
      <Radio size={11} aria-hidden="true" />
      Sharing live
    </LivePill>
  )
}
