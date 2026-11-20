import { WifiOff } from 'lucide-react'
import { StatusBanner } from './ui'
import { classes } from '../lib/classes'
import { OFFLINE_MESSAGE } from '../lib/offlineCopy'
import { useOnlineStatus } from '../lib/useOnlineStatus'

/** One quiet line wherever a network action is unavailable. */
export default function OfflineNotice({ className }: { className?: string }) {
  const online = useOnlineStatus()
  if (online) return null
  return (
    <StatusBanner
      tone={null}
      icon={<WifiOff size={15} />}
      className={classes(
        'border-[var(--ui-border)] bg-[var(--ui-surface-muted)] text-[var(--ui-text)]',
        className,
      )}
    >
      {OFFLINE_MESSAGE}
    </StatusBanner>
  )
}
