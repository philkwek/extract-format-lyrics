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
  quick?: { label: string; disabled?: boolean; loading?: boolean; onSelect: () => void }
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

function SourceStatus({
  source,
  shownCount,
}: {
  source: SearchSourceStatus
  shownCount: number
}) {
  const label = sourceLabel(source.site)
  const detail =
    source.status === 'failed'
      ? 'Unavailable'
      : source.status === 'empty'
        ? 'No matches'
        : `${shownCount} result${shownCount === 1 ? '' : 's'}`
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] px-2 py-1 text-[10px] font-semibold text-[var(--ui-text-muted)]"
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
  const shownCountBySite = new Map<string, number>()
  for (const candidate of results) {
    shownCountBySite.set(candidate.site, (shownCountBySite.get(candidate.site) ?? 0) + 1)
  }

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
            {sources.map((source) => (
              <SourceStatus
                key={source.site}
                source={source}
                shownCount={shownCountBySite.get(source.site) ?? 0}
              />
            ))}
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
            {sources.map((source) => (
              <SourceStatus
                key={source.site}
                source={source}
                shownCount={shownCountBySite.get(source.site) ?? 0}
              />
            ))}
          </div>
        )}

        {partial && !allFailed && (
          <p className="px-1 text-xs text-[var(--ui-text-muted)]" role="status">
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
                quickAction={
                  action.quick && {
                    label: action.quick.label,
                    disabled: action.quick.disabled,
                    loading: action.quick.loading,
                    onClick: action.quick.onSelect,
                  }
                }
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
