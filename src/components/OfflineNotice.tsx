import { WifiOff } from 'lucide-react'
import { StatusBanner } from './ui'
import { classes } from '../lib/classes'
import { NEUTRAL_NOTICE } from '../lib/noticeSurface'
import { OFFLINE_MESSAGE } from '../lib/offlineCopy'

/** One quiet line wherever a network action is unavailable. */
export default function OfflineNotice({
  online,
  className,
}: {
  online: boolean
  className?: string
}) {
  if (online) return null
  return (
    <StatusBanner
      tone={null}
      icon={<WifiOff size={15} />}
      className={classes(NEUTRAL_NOTICE, className)}
    >
      {OFFLINE_MESSAGE}
    </StatusBanner>
  )
}
