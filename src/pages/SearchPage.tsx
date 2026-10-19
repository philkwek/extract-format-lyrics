import { trackEvent, trackSongImport } from '../lib/analytics'
import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Link2, Search } from 'lucide-react'
import { searchApi, type SearchCandidate } from '../lib/api'
import { sessionStore, type Session } from '../lib/sessionStore'
import {
  importSources,
  parsePastedSources,
  sourceFromCandidate,
  type ImportProgress,
} from '../lib/setlistImport'
import { splitUrls } from '../../functions/src/urls'
import ImportProgressList from '../components/import/ImportProgressList'
import PasteUrlForm from '../components/import/PasteUrlForm'
import SearchForm from '../components/import/SearchForm'
import SearchResults from '../components/import/SearchResults'
import { Button, SegmentedControl, Surface } from '../components/ui'

export default function SearchPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const targetSessionId = searchParams.get('session')
  const [targetSession, setTargetSession] = useState<Session | null>(null)

  const [mode, setMode] = useState<'search' | 'paste'>('search')

  // Search mode state
  const [query, setQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState<SearchCandidate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set())
  const [addingUrls, setAddingUrls] = useState<Set<string>>(new Set())

  // Paste mode state
  const [pasteText, setPasteText] = useState('')
  const [isProcessingPaste, setIsProcessingPaste] = useState(false)
  const [pasteStatuses, setPasteStatuses] = useState<ImportProgress[]>([])
  const [pasteError, setPasteError] = useState<string | null>(null)

  useEffect(() => {
    if (targetSessionId) {
      sessionStore.getSession(targetSessionId).then(setTargetSession)
    }
  }, [targetSessionId])

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!query.trim()) return

    setIsSearching(true)
    setError(null)
    setHasSearched(true)

    try {
      const candidates = await searchApi(query.trim())
      setResults(candidates)
      trackEvent('song_search', { entry_page: 'search', outcome: 'success', result_count: candidates.length })
    } catch (err) {
      setError((err as Error).message || 'Failed to search songs')
      setResults([])
      trackEvent('song_search', { entry_page: 'search', outcome: 'error', result_count: 0 })
    } finally {
      setIsSearching(false)
    }
  }

  const handleAddCandidate = async (candidate: SearchCandidate) => {
    if (addedUrls.has(candidate.url) || addingUrls.has(candidate.url)) return

    setAddingUrls((prev) => new Set(prev).add(candidate.url))

    try {
      const result = await importSources([sourceFromCandidate(candidate)], {
        targetSessionId: targetSessionId ?? undefined,
        requireAll: true,
      })
      trackSongImport('search', result.imported, 1)
      setAddedUrls((prev) => new Set(prev).add(candidate.url))
      navigate(
        targetSessionId
          ? `/session/${result.session.id}?song=${result.firstNewIndex}`
          : `/session/${result.session.id}`
      )
    } catch (err) {
      trackSongImport('search', 0, 1)
      alert(`Could not add song: ${(err as Error).message}`)
    } finally {
      setAddingUrls((prev) => {
        const next = new Set(prev)
        next.delete(candidate.url)
        return next
      })
    }
  }

  const handlePasteExtract = async () => {
    setPasteError(null)
    const { sources, invalid, tokenCount } = parsePastedSources(pasteText)
    if (tokenCount === 0) {
      setPasteError('Please paste at least one chord sheet URL.')
      return
    }

    if (sources.length === 0 && invalid.length > 0) {
      setPasteError(`No valid URLs found: ${invalid.map((i) => `${i.input} (${i.reason})`).join(', ')}`)
      return
    }

    setIsProcessingPaste(true)
    try {
      const result = await importSources(sources, {
        targetSessionId: targetSessionId ?? undefined,
        invalidInputs: invalid,
        onProgress: setPasteStatuses,
      })
      trackSongImport('pasted_link', result.imported, tokenCount)
      navigate(
        targetSessionId
          ? `/session/${result.session.id}?song=${result.firstNewIndex}`
          : `/session/${result.session.id}`
      )
    } catch {
      trackSongImport('pasted_link', 0, tokenCount)
      setPasteError('Could not save all imported songs. Please try again.')
    } finally {
      setIsProcessingPaste(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
        <Button
          variant="ghost"
          icon={<ArrowLeft size={15} />}
          onClick={() => {
            if (targetSessionId) {
              navigate(`/session/${targetSessionId}`)
            } else {
              navigate(-1)
            }
          }}
        >
          {targetSession ? `Back to ${targetSession.name}` : 'Back'}
        </Button>
        {targetSession && (
          <span className="rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-1.5 text-xs text-[var(--ui-text-muted)]">
            Adding to <strong className="text-[var(--ui-text)]">{targetSession.name}</strong>
          </span>
        )}
      </div>

      <Surface className="overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-[var(--ui-border)] p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#3368A0] dark:text-amber-400">Song library</p>
            <h1 className="mt-1 text-2xl font-bold tracking-[-0.03em] text-[var(--ui-text)]">Find the next chart</h1>
            <p className="mt-1 text-sm text-[var(--ui-text-muted)]">Search supported sites or bring a link you already trust.</p>
          </div>
          <SegmentedControl
            label="Import method"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'search', label: 'Search', icon: <Search size={14} /> },
              { value: 'paste', label: 'Paste links', icon: <Link2 size={14} /> },
            ]}
          />
        </div>

        <div className="p-4 sm:p-5">
        {mode === 'search' ? (
          <SearchForm
            query={query}
            onQueryChange={setQuery}
            onSubmit={handleSearch}
            isSearching={isSearching}
            error={error}
            description="Find chord sheets across Ultimate Guitar, PNW Chords, and Worship Together."
            placeholder="e.g. Goodness of God, Hallelujah, Holy Forever..."
          />
        ) : (
          <>
            <PasteUrlForm
              value={pasteText}
              onChange={setPasteText}
              onSubmit={handlePasteExtract}
              isProcessing={isProcessingPaste}
              error={pasteError}
              submitLabel={targetSessionId ? 'Add to setlist' : 'Extract and open'}
              linkCount={splitUrls(pasteText).length}
            />
            <ImportProgressList
              statuses={pasteStatuses}
              className="mt-5 border-t border-[var(--ui-border)] pt-4"
            />
          </>
        )}
        </div>
      </Surface>

      {/* Results (Only shown in search mode) */}
      {mode === 'search' && (
        <SearchResults
          results={results}
          isSearching={isSearching}
          hasSearched={hasSearched}
          hasError={Boolean(error)}
          emptyMessage="No matching songs found. Try a different query or paste links above."
          onSelect={handleAddCandidate}
          getActionState={(candidate) => ({
            label: addedUrls.has(candidate.url)
              ? 'Added ✓'
              : addingUrls.has(candidate.url)
                ? 'Adding...'
                : targetSessionId
                  ? 'Add to setlist'
                  : 'Extract and view',
            disabled: addingUrls.has(candidate.url) || addedUrls.has(candidate.url),
            loading: addingUrls.has(candidate.url),
          })}
        />
      )}
    </div>
  )
}
