import { trackEvent, trackSongImport } from '../lib/analytics'
import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, ExternalLink, Link2, Search } from 'lucide-react'
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
import { Button, SegmentedControl, StatusBanner, Surface } from '../components/ui'

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
          <div className="space-y-4">
            <p className="text-sm leading-6 text-[var(--ui-text-muted)]">
              Find chord sheets across Ultimate Guitar, PNW Chords, and Worship Together.
            </p>

            <form onSubmit={handleSearch} className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. Goodness of God, Hallelujah, Holy Forever..."
                className="ui-field flex-1 px-3.5 py-2.5 text-sm"
              />
              <Button
                type="submit"
                variant="primary"
                icon={<Search size={15} />}
                disabled={isSearching || !query.trim()}
                loading={isSearching}
              >
                Search
              </Button>
            </form>

            {error && (
              <StatusBanner tone="error" icon={<AlertCircle size={16} />}>
                {error}
              </StatusBanner>
            )}
          </div>
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
        <>
          {isSearching ? (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-[var(--ui-text-muted)]" role="status">
              <span className="ui-spinner" /> Searching supported chord sites
            </div>
          ) : results.length > 0 ? (
            <div className="space-y-3">
              <h3 className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ui-text-muted)]">
                Search results · {results.length}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {results.map((item, idx) => (
                  <div
                    key={idx}
                    className="ui-surface flex min-h-40 flex-col justify-between p-4 transition hover:-translate-y-0.5 hover:border-[var(--ui-border-strong)]"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-sm font-bold leading-snug tracking-[-0.01em] text-[var(--ui-text)]">{item.title}</h4>
                        <span className="rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--ui-text-muted)]">
                          {item.site}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--ui-text-muted)]">{item.artist}</p>

                      <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--ui-text-muted)]">
                        {item.versionLabel && <span>{item.versionLabel}</span>}
                        {item.rating && <span>★ {item.rating.toFixed(1)}</span>}
                        {item.type && <span>• {item.type}</span>}
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-[var(--ui-border)] pt-3">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]"
                      >
                        View source <ExternalLink size={12} />
                      </a>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => handleAddCandidate(item)}
                        disabled={addingUrls.has(item.url) || addedUrls.has(item.url)}
                        loading={addingUrls.has(item.url)}
                      >
                        {addedUrls.has(item.url)
                          ? 'Added ✓'
                          : addingUrls.has(item.url)
                            ? 'Adding...'
                            : targetSessionId
                              ? 'Add to setlist'
                              : 'Extract and view'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : hasSearched ? (
            <div className="py-12 text-center text-sm text-[var(--ui-text-muted)]">
              No matching songs found. Try a different query or paste links above.
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
