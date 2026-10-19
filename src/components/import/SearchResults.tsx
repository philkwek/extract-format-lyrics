import type { SearchCandidate, SearchSourceStatus } from '../../lib/api'
import { classes } from '../../lib/classes'
import {
  allSearchSourcesFailed,
  failedSearchSources,
  sourceLabel,
} from '../../lib/searchResults'
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
  sources?: SearchSourceStatus[]
  partial?: boolean
  emptyMessage: string
  onSelect: (candidate: SearchCandidate) => void
  getActionState: (candidate: SearchCandidate) => SearchActionState
  className?: string
}

function SourceStatus({ source }: { source: SearchSourceStatus }) {
  const label = sourceLabel(source.site)
  const detail =
    source.status === 'failed'
      ? 'Unavailable'
      : source.status === 'empty'
        ? 'No matches'
        : `${source.count} result${source.count === 1 ? '' : 's'}`
  return (
    <span
      className={classes(
        'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold',
        source.status === 'failed'
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
          : 'border-[var(--ui-border)] bg-[var(--ui-surface-muted)] text-[var(--ui-text-muted)]'
      )}
      title={source.message}
    >
      {label}: {detail}
    </span>
  )
}

export default function SearchResults({
  results,
  isSearching,
  hasSearched,
  hasError = false,
  sources = [],
  partial = false,
  emptyMessage,
  onSelect,
  getActionState,
  className,
}: SearchResultsProps) {
  const allFailed = allSearchSourcesFailed(sources)
  const failed = failedSearchSources(sources)

  if (isSearching && results.length === 0) {
    return (
      <div className={classes('space-y-3', className)}>
        <div
          className="flex items-center justify-center gap-2 py-10 text-xs text-[var(--ui-text-muted)]"
          role="status"
        >
          <span className="ui-spinner" /> Searching supported chord sites
        </div>
        {sources.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5">
            {sources.map((source) => <SourceStatus key={source.site} source={source} />)}
          </div>
        )}
      </div>
    )
  }

  if (results.length > 0) {
    return (
      <div className={classes('space-y-3', className)}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ui-text-muted)]">
            Search results · {results.length}
            {isSearching ? ' · more sources pending' : ''}
          </h3>
          {isSearching && (
            <span className="flex items-center gap-1.5 text-[10px] text-[var(--ui-text-muted)]" role="status">
              <span className="ui-spinner" /> Checking remaining sources
            </span>
          )}
        </div>

        {sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {sources.map((source) => <SourceStatus key={source.site} source={source} />)}
          </div>
        )}

        {partial && !allFailed && (
          <p className="px-1 text-xs text-amber-700 dark:text-amber-400" role="status">
            Some sources are unavailable right now. Showing results from the rest.
          </p>
        )}

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

  if (hasSearched && !hasError && !isSearching) {
    if (allFailed) {
      return (
        <div className={classes('space-y-2 py-10 text-center text-sm text-[var(--ui-text-muted)]', className)}>
          <p>Search sources are unavailable right now. Try again in a moment.</p>
          <p className="text-xs">
            {failed.map((source) => `${sourceLabel(source.site)}: unavailable`).join(' · ')}
          </p>
        </div>
      )
    }
    return (
      <div className={classes('space-y-2 py-10 text-center text-sm text-[var(--ui-text-muted)]', className)}>
        <p>{emptyMessage}</p>
        {partial && failed.length > 0 && (
          <p className="text-xs">
            Unavailable: {failed.map((source) => sourceLabel(source.site)).join(', ')}
          </p>
        )}
      </div>
    )
  }

  return null
}
