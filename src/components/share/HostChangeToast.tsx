import { Radio } from 'lucide-react'
import ChangeToast, { type ChangeNote } from './ChangeToast'

export type HostNote = ChangeNote

interface Props {
  note: HostNote | null
  onDismiss: () => void
  durationMs?: number
}

/** Tells someone following a live set what the host just changed. */
export default function HostChangeToast(props: Props) {
  return (
    <ChangeToast
      {...props}
      label="Host"
      icon={<Radio size={16} className="text-emerald-700 dark:text-emerald-400" />}
    />
  )
}
