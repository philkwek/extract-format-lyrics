import { useEffect, useRef, useState } from 'react'
import { trackEvent, trackSearchTiming, trackSongImport } from '../../lib/analytics'
import {
  searchApiStream,
  type SearchCandidate,
  type SearchSourceStatus,
} from '../../lib/api'
import {
  mergeFinalSearchCandidates,
  mergePartialSearchCandidates,
  upsertSearchSource,
} from '../../lib/searchResults'
import { importSources, sourceFromCandidate } from '../../lib/setlistImport'
import type { Session } from '../../lib/sessionStore'
import SearchForm from '../import/SearchForm'
import SearchResults from '../import/SearchResults'

interface AddSongSearchPanelProps {
  sessionId: string
  onSessionUpdated: (session: Session, firstNewIndex: number) => void | Promise<void>
}

export default function AddSongSearchPanel({
  sessionId,
  onSessionUpdated,
}: AddSongSearchPanelProps) {
  const [query, setQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState<SearchCandidate[]>([])
  const [sources, setSources] = useState<SearchSourceStatus[]>([])
  const [partial, setPartial] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set())
  const [addingUrls, setAddingUrls] = useState<Set<string>>(new Set())
  const searchAbortRef = useRef<AbortController | null>(null)
  const searchGenerationRef = useRef(0)

  useEffect(() => () => searchAbortRef.current?.abort(), [])

  const handleSearch = async (event?: React.FormEvent) => {
    if (event) event.preventDefault()
    if (!query.trim()) return

    const startedAt = Date.now()
    searchAbortRef.current?.abort()
    const controller = new AbortController()
    searchAbortRef.current = controller
    const generation = ++searchGenerationRef.current
    setIsSearching(true)
    setError(null)
    setHasSearched(true)
    setResults([])
    setSources([])
    setPartial(false)

    try {
      const response = await searchApiStream(query.trim(), {
        signal: controller.signal,
        onSource: (source) => {
          if (generation !== searchGenerationRef.current) return
          setSources((previous) => upsertSearchSource(previous, source))
          setResults((previous) =>
            mergePartialSearchCandidates(previous, source.candidates)
          )
        },
      })
      if (generation !== searchGenerationRef.current) return

      setResults((previous) => mergeFinalSearchCandidates(previous, response.results))
      setSources(response.sources ?? [])
      setPartial(Boolean(response.partial))
      trackEvent('song_search', {
        entry_page: 'search',
        outcome: 'success',
        result_count: response.results.length,
      })
      trackSearchTiming('search', Date.now() - startedAt, 'success', response.results.length)
    } catch (err) {
      if (generation !== searchGenerationRef.current || controller.signal.aborted) return
      setError((err as Error).message || 'Failed to search songs')
      setResults([])
      setSources([])
      trackEvent('song_search', { entry_page: 'search', outcome: 'error', result_count: 0 })
      trackSearchTiming('search', Date.now() - startedAt, 'error', 0)
    } finally {
      if (generation === searchGenerationRef.current) setIsSearching(false)
    }
  }

  const handleAddCandidate = async (candidate: SearchCandidate) => {
    if (addedUrls.has(candidate.url) || addingUrls.has(candidate.url)) return

    setAddingUrls((previous) => new Set(previous).add(candidate.url))

    try {
      const result = await importSources([sourceFromCandidate(candidate)], {
        targetSessionId: sessionId,
        requireAll: true,
      })
      trackSongImport('search', result.imported, 1)
      setAddedUrls((previous) => new Set(previous).add(candidate.url))
      await onSessionUpdated(result.session, result.firstNewIndex)
    } catch (err) {
      trackSongImport('search', 0, 1)
      alert(`Could not add song: ${(err as Error).message}`)
    } finally {
      setAddingUrls((previous) => {
        const next = new Set(previous)
        next.delete(candidate.url)
        return next
      })
    }
  }

  return (
    <div className="space-y-4">
      <SearchForm
        query={query}
        onQueryChange={setQuery}
        onSubmit={handleSearch}
        isSearching={isSearching}
        error={error}
        description="Search by title or artist across Ultimate Guitar, PNW Chords, Worship Together and WorshipChords.net"
        placeholder="e.g. Goodness of God, Way Maker, Phil Wickham, Bethel..."
      />
      <SearchResults
        results={results}
        isSearching={isSearching}
        hasSearched={hasSearched}
        hasError={Boolean(error)}
        sources={sources}
        partial={partial}
        emptyMessage="No matching chord sheets found. Try a different title or artist name."
        onSelect={handleAddCandidate}
        getActionState={(candidate) => ({
          label: addedUrls.has(candidate.url)
            ? 'Added ✓'
            : addingUrls.has(candidate.url)
              ? 'Adding...'
              : 'Add to setlist',
          disabled: addingUrls.has(candidate.url) || addedUrls.has(candidate.url),
          loading: addingUrls.has(candidate.url),
        })}
      />
    </div>
  )
}
