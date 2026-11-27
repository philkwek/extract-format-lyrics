import type { ReactNode } from 'react'
import { WifiOff } from 'lucide-react'
import { StatusBanner } from './ui'
import { NEUTRAL_NOTICE } from '../lib/noticeSurface'
import { OFFLINE_MESSAGE } from '../lib/offlineCopy'

/** One quiet line wherever a network action is unavailable. */
export default function OfflineNotice({
  online,
  children,
}: {
  online: boolean
  children?: ReactNode
}) {
  if (online) return null
  return (
    <StatusBanner
      tone={null}
      icon={<WifiOff size={15} />}
      className={NEUTRAL_NOTICE}
      title={children ? OFFLINE_MESSAGE : undefined}
    >
      {children ?? OFFLINE_MESSAGE}
    </StatusBanner>
  )
}
