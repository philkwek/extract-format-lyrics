import { Share } from 'lucide-react'
import { Button } from './ui'
import OverlayDialog from './ui/OverlayDialog'

interface InstallStepsDialogProps {
  isOpen: boolean
  onClose: () => void
}

/** iOS and iPadOS have no install API, so the steps are all we can offer. */
export default function InstallStepsDialog({ isOpen, onClose }: InstallStepsDialogProps) {
  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Install Sets & Sheets"
      size="sm"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <ol className="space-y-4 text-sm leading-6 text-[var(--ui-text)]">
        <li className="flex gap-3">
          <span className="bg-ui-accent/10 text-ui-accent-strong flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold">
            1
          </span>
          <span className="flex-1">
            Tap <Share size={14} className="inline align-[-2px]" /> <strong>Share</strong> in the
            Safari toolbar.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="bg-ui-accent/10 text-ui-accent-strong flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold">
            2
          </span>
          <span className="flex-1">
            Scroll down and tap <strong>Add to Home Screen</strong>.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="bg-ui-accent/10 text-ui-accent-strong flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold">
            3
          </span>
          <span className="flex-1">
            Tap <strong>Add</strong>. Sets &amp; Sheets opens from your home screen.
          </span>
        </li>
      </ol>
    </OverlayDialog>
  )
}
