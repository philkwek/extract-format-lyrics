import { trackEvent, trackSearchTiming, trackSongImport } from '../lib/analytics'
import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Link2, Search } from 'lucide-react'
import { searchApiStream, type SearchCandidate, type SearchSourceStatus } from '../lib/api'
import {
  mergeFinalSearchCandidates,
  mergePartialSearchCandidates,
  upsertSearchSource,
} from '../lib/searchResults'
import { sessionStore, sessionPath, type Session } from '../lib/sessionStore'
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
import SongTray from '../components/import/SongTray'
import { Button, SegmentedControl, Surface } from '../components/ui'
import { useSeo } from '../lib/useSeo'
import { useSongTray } from '../lib/useSongTray'
import { UNDO_WINDOW_MS } from '../lib/usePendingRemoval'
import ChangeToast from '../components/share/ChangeToast'

export default function SearchPage() {
  useSeo({
    title: 'Find Chord Sheets | Sets & Sheets',
    description:
      'Search Ultimate Guitar, PNW Chords, Essential Worship, Worship Together and WorshipChords by song title or artist and add the chart to your set.',
    path: '/search',
  })
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const targetSessionId = searchParams.get('session')
  const [targetSession, setTargetSession] = useState<Session | null>(null)
  const tray = useSongTray()
  const useTray = !targetSessionId

  const [mode, setMode] = useState<'search' | 'paste'>('search')

  // Search mode state
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

  useEffect(() => () => searchAbortRef.current?.abort(), [])

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
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
          setSources((prev) => upsertSearchSource(prev, source))
          setResults((prev) => mergePartialSearchCandidates(prev, source.candidates))
        },
      })
      if (generation !== searchGenerationRef.current) return

      setResults((prev) => mergeFinalSearchCandidates(prev, response.results))
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

    setAddingUrls((prev) => new Set(prev).add(candidate.url))

    try {
      const result = await importSources([sourceFromCandidate(candidate)], {
        targetSessionId: targetSessionId ?? undefined,
        requireAll: true,
      })
      trackSongImport('search', result.imported, 1)
      setAddedUrls((prev) => new Set(prev).add(candidate.url))
      if (!result.session) return
      navigate(
        targetSessionId
          ? `${sessionPath(result.session)}?song=${result.firstNewIndex}`
          : sessionPath(result.session),
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

  const handleCreateFromTray = async () => {
    const session = await tray.create()
    if (session) navigate(sessionPath(session))
  }

  const handlePasteExtract = async () => {
    setPasteError(null)
    const { sources, invalid, tokenCount } = parsePastedSources(pasteText)
    if (tokenCount === 0) {
      setPasteError('Please paste at least one chord sheet URL.')
      return
    }

    if (sources.length === 0 && invalid.length > 0) {
      setPasteError(
        `No valid URLs found: ${invalid.map((i) => `${i.input} (${i.reason})`).join(', ')}`,
      )
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
      if (!result.session || result.imported === 0) {
        setPasteError('None of these links could be added. Check the details below.')
        return
      }
      navigate(
        targetSessionId
          ? `${sessionPath(result.session)}?song=${result.firstNewIndex}`
          : sessionPath(result.session),
      )
    } catch {
      trackSongImport('pasted_link', 0, tokenCount)
      setPasteError('Could not save all imported songs. Please try again.')
    } finally {
      setIsProcessingPaste(false)
    }
  }

  return (
    <div
      className={`mx-auto max-w-5xl space-y-5 ${useTray && tray.items.length > 0 ? 'pb-24 lg:pb-0' : ''}`}
    >
      <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
        <Button
          variant="ghost"
          icon={<ArrowLeft size={15} />}
          onClick={() => {
            if (targetSessionId) {
              navigate(targetSession ? sessionPath(targetSession) : `/session/${targetSessionId}`)
            } else {
              navigate(-1)
            }
          }}
        >
          {targetSession ? `Go back to ${targetSession.name}` : 'Go back'}
        </Button>
        {targetSession && (
          <span className="rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-1.5 text-xs text-[var(--ui-text-muted)]">
            Adding to <strong className="text-[var(--ui-text)]">{targetSession.name}</strong>
          </span>
        )}
      </div>

      <div
        className={
          mode === 'search' && useTray && tray.items.length > 0
            ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-5'
            : ''
        }
      >
        <div className="min-w-0 space-y-5">
          <Surface className="overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-[var(--ui-border)] p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
              <div>
                <p className="text-ui-accent-strong text-[11px] font-bold tracking-[0.15em] uppercase">
                  Song library
                </p>
                <h1 className="mt-1 text-2xl font-bold tracking-[-0.03em] text-[var(--ui-text)]">
                  Find and add to a new set
                </h1>
                <p className="mt-1 text-sm text-[var(--ui-text-muted)]">
                  Search supported sites or bring a link you already trust.
                </p>
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
                  description="Find chord sheets across Ultimate Guitar, PNW Chords, Essential Worship, Worship Together and WorshipChords"
                  placeholder="e.g. Goodness of God, Hallelujah, Holy Forever..."
                  className="[&_.ui-field]:bg-ui-surface-raised!"
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
              sources={sources}
              partial={partial}
              emptyMessage="No matching songs found. Try a different query or paste links above."
              onSelect={useTray ? tray.add : handleAddCandidate}
              getActionState={(candidate) => {
                if (!useTray) {
                  return {
                    label: addedUrls.has(candidate.url)
                      ? 'Added ✓'
                      : addingUrls.has(candidate.url)
                        ? 'Adding...'
                        : 'Add to setlist',
                    disabled: addingUrls.has(candidate.url) || addedUrls.has(candidate.url),
                    loading: addingUrls.has(candidate.url),
                  }
                }
                const inTray = tray.urls.has(candidate.url)
                const starting = addingUrls.has(candidate.url)
                return {
                  label: inTray
                    ? 'Added'
                    : tray.isFull
                      ? 'Limit reached'
                      : tray.items.length === 0
                        ? 'Add multiple songs'
                        : 'Add to set',
                  disabled: inTray || tray.isFull || tray.isCreating || addingUrls.size > 0,
                  quick:
                    tray.items.length === 0
                      ? {
                          label: 'Start now',
                          disabled: addingUrls.size > 0,
                          loading: starting,
                          onSelect: () => handleAddCandidate(candidate),
                        }
                      : undefined,
                }
              }}
            />
          )}
        </div>
        {mode === 'search' && useTray && (
          <SongTray
            items={tray.items}
            failedUrls={tray.failedUrls}
            isCreating={tray.isCreating}
            error={tray.error}
            onMove={tray.move}
            onReorder={tray.setOrder}
            onRemove={tray.remove}
            onCreate={handleCreateFromTray}
          />
        )}
      </div>
      {useTray && (
        <ChangeToast
          note={tray.undoNote}
          onDismiss={() => undefined}
          progressMs={UNDO_WINDOW_MS}
          progressKey={tray.undoKey}
          pauseOnHover={false}
          dismissible={false}
        />
      )}
    </div>
  )
}
