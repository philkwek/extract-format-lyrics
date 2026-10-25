import { ExternalLink } from 'lucide-react'
import type { SearchCandidate } from '../../lib/api'
import { sourceLabel } from '../../lib/searchResults'
import { Button } from '../ui'

interface SearchResultCardProps {
  candidate: SearchCandidate
  actionLabel: string
  actionDisabled?: boolean
  actionLoading?: boolean
  onAction: () => void
}

export default function SearchResultCard({
  candidate,
  actionLabel,
  actionDisabled = false,
  actionLoading = false,
  onAction,
}: SearchResultCardProps) {
  return (
    <div className="ui-surface flex min-h-40 flex-col justify-between p-4 transition hover:-translate-y-0.5 hover:border-[var(--ui-border-strong)]">
      <div>
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-bold leading-snug tracking-[-0.01em] text-[var(--ui-text)]">
            {candidate.title}
          </h4>
          <span className="shrink-0 rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--ui-text-muted)]">
            {sourceLabel(candidate.site)}
          </span>
        </div>
        <p className="mt-1 text-xs text-[var(--ui-text-muted)]">{candidate.artist}</p>

        <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--ui-text-muted)]">
          {candidate.versionLabel && <span>{candidate.versionLabel}</span>}
          {candidate.rating && <span>★ {candidate.rating.toFixed(1)}</span>}
          {candidate.type && <span>• {candidate.type}</span>}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-[var(--ui-border)] pt-3">
        <a
          href={candidate.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]"
        >
          View source <ExternalLink size={12} />
        </a>
        <Button
          size="sm"
          variant="primary"
          onClick={onAction}
          disabled={actionDisabled}
          loading={actionLoading}
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  )
}
