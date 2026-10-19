import type { ImportProgress } from '../../lib/setlistImport'
import { classes } from '../../lib/classes'

interface ImportProgressListProps {
  statuses: ImportProgress[]
  heading?: string
  className?: string
}

function statusLabel(status: ImportProgress): string {
  switch (status.status) {
    case 'cached':
      return 'Cached ✓'
    case 'done':
      return 'Extracted ✓'
    case 'fetching':
      return 'Fetching...'
    case 'pending':
      return 'Waiting...'
    case 'error':
      return status.message || 'Failed'
  }
}

export default function ImportProgressList({
  statuses,
  heading = 'Import Progress',
  className,
}: ImportProgressListProps) {
  if (statuses.length === 0) return null

  return (
    <div className={classes('space-y-2', className)}>
      <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ui-text-muted)]">
        {heading}
      </h3>
      {statuses.map((status, index) => (
        <div
          key={`${status.url}-${index}`}
          className="flex items-center justify-between gap-3 rounded-lg bg-[var(--ui-surface-muted)] px-3 py-2 text-xs"
        >
          <span className="max-w-[70%] truncate font-mono text-[var(--ui-text)]">{status.url}</span>
          <span
            className={
              status.status === 'done' || status.status === 'cached'
                ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                : status.status === 'error'
                  ? 'text-red-600 dark:text-red-400 font-medium'
                  : 'text-[#255283] dark:text-amber-400 animate-pulse font-medium'
            }
          >
            {statusLabel(status)}
          </span>
        </div>
      ))}
    </div>
  )
}
