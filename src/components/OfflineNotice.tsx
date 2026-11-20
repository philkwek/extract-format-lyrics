import { WifiOff } from 'lucide-react'
import { StatusBanner } from './ui'
import { NEUTRAL_NOTICE } from '../lib/noticeSurface'
import { OFFLINE_MESSAGE } from '../lib/offlineCopy'

/** One quiet line wherever a network action is unavailable. */
export default function OfflineNotice({ online }: { online: boolean }) {
  if (online) return null
  return (
    <StatusBanner tone={null} icon={<WifiOff size={15} />} className={NEUTRAL_NOTICE}>
      {OFFLINE_MESSAGE}
    </StatusBanner>
  )
}
