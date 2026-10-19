import { AlertCircle } from 'lucide-react'
import { classes } from '../../lib/classes'
import { Button, StatusBanner } from '../ui'

interface PasteUrlFormProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  isProcessing: boolean
  error?: string | null
  submitLabel: string
  processingLabel?: string
  linkCount: number
  placeholder?: string
  rows?: number
  className?: string
}

const DEFAULT_PLACEHOLDER = 'https://tabs.ultimate-guitar.com/...\nhttps://pnwchords.com/...'

export default function PasteUrlForm({
  value,
  onChange,
  onSubmit,
  isProcessing,
  error,
  submitLabel,
  processingLabel,
  linkCount,
  placeholder = DEFAULT_PLACEHOLDER,
  rows = 4,
  className,
}: PasteUrlFormProps) {
  return (
    <div className={classes('space-y-4', className)}>
      <p className="text-sm leading-6 text-[var(--ui-text-muted)]">
        Paste one or more chord sheet URLs (Ultimate Guitar, PNW Chords, Worship Chords, Worship Together).
      </p>

      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={isProcessing}
        placeholder={placeholder}
        rows={rows}
        className="ui-field min-h-32 resize-y p-3.5 font-mono text-sm leading-6"
      />

      {error && (
        <StatusBanner tone="error" icon={<AlertCircle size={16} />}>
          {error}
        </StatusBanner>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs font-medium text-[var(--ui-text-muted)]">
          {linkCount} link(s) entered
        </span>
        <Button
          variant="primary"
          onClick={onSubmit}
          disabled={isProcessing || !value.trim()}
          loading={isProcessing}
        >
          {isProcessing ? processingLabel || submitLabel : submitLabel}
        </Button>
      </div>
    </div>
  )
}
