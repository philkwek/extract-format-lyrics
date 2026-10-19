import type { SearchCandidate } from '../../lib/api'
import { classes } from '../../lib/classes'
import SearchResultCard from './SearchResultCard'

interface SearchActionState {
  label: string
  disabled?: boolean
  loading?: boolean
}

interface SearchResultsProps {
  results: SearchCandidate[]
  isSearching: boolean
  hasSearched: boolean
  hasError?: boolean
  emptyMessage: string
  onSelect: (candidate: SearchCandidate) => void
  getActionState: (candidate: SearchCandidate) => SearchActionState
  className?: string
}

export default function SearchResults({
  results,
  isSearching,
  hasSearched,
  hasError = false,
  emptyMessage,
  onSelect,
  getActionState,
  className,
}: SearchResultsProps) {
  if (isSearching) {
    return (
      <div
        className={classes(
          'flex items-center justify-center gap-2 py-10 text-xs text-[var(--ui-text-muted)]',
          className
        )}
        role="status"
      >
        <span className="ui-spinner" /> Searching supported chord sites
      </div>
    )
  }

  if (results.length > 0) {
    return (
      <div className={classes('space-y-3', className)}>
        <h3 className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ui-text-muted)]">
          Search results · {results.length}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {results.map((candidate) => {
            const action = getActionState(candidate)
            return (
              <SearchResultCard
                key={candidate.url}
                candidate={candidate}
                actionLabel={action.label}
                actionDisabled={action.disabled}
                actionLoading={action.loading}
                onAction={() => onSelect(candidate)}
              />
            )
          })}
        </div>
      </div>
    )
  }

  if (hasSearched && !hasError) {
    return (
      <div className={classes('py-10 text-center text-sm text-[var(--ui-text-muted)]', className)}>
        {emptyMessage}
      </div>
    )
  }

  return null
}
