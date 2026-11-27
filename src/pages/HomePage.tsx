import { trackEvent, trackSearchTiming, trackSongImport } from '../lib/analytics'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  FileText,
  Link2,
  ListMusic,
  Pencil,
  Radio,
  Search,
  Share2,
  Trash2,
} from 'lucide-react'
import { splitUrls } from '../../functions/src/urls'
import { songCache } from '../lib/songCache'
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
import {
  getRecentSharedLyrics,
  removeRecentSharedLyrics,
  clearRecentSharedLyrics,
  type RecentSharedLyrics,
} from '../lib/recentLyricsStore'
import ShareModal from '../components/ShareModal'
import ImportProgressList from '../components/import/ImportProgressList'
import PasteUrlForm from '../components/import/PasteUrlForm'
import SearchForm from '../components/import/SearchForm'
import SearchResults from '../components/import/SearchResults'
import SongTray from '../components/import/SongTray'
import HomeNotice from '../components/HomeNotice'
import LiveShareChip from '../components/share/LiveShareChip'
import ChangeToast, { type ChangeNote } from '../components/share/ChangeToast'
import { Button, IconButton, LivePill, SegmentedControl, StatusBanner } from '../components/ui'
import OverlayDialog from '../components/ui/OverlayDialog'
import { useSeo } from '../lib/useSeo'
import { songCount } from '../lib/plural'
import { UNDO_WINDOW_MS, usePendingRemoval } from '../lib/usePendingRemoval'
import { useSongTray } from '../lib/useSongTray'
import { useOnlineStatus } from '../lib/useOnlineStatus'
import { useSyncState } from '../lib/useSyncState'
import { OFFLINE_MESSAGE } from '../lib/offlineCopy'

export default function HomePage() {
  useSeo({
    title: 'Sets & Sheets – Chord sheets, transposing and worship set lists',
    description:
      'Import chord sheets from Ultimate Guitar, PNW Chords, Worship Together and more. Transpose keys, simplify chords, play pads and share set lists. Free, no account needed.',
    path: '/',
  })
  const navigate = useNavigate()
  const tray = useSongTray()
  const online = useOnlineStatus()
  const [createMode, setCreateMode] = useState<'paste' | 'search'>('search')

  // Paste mode state
  const [inputText, setInputText] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [statuses, setStatuses] = useState<ImportProgress[]>([])
  const [generalError, setGeneralError] = useState<string | null>(null)

  // Search mode state
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchCandidate[]>([])
  const [searchSources, setSearchSources] = useState<SearchSourceStatus[]>([])
  const [searchPartial, setSearchPartial] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [creatingFromUrl, setCreatingFromUrl] = useState<string | null>(null)
  const searchAbortRef = useRef<AbortController | null>(null)
  const searchGenerationRef = useRef(0)

  const [sessions, setSessions] = useState<Session[]>([])
  const syncState = useSyncState()
  const [recentLyrics, setRecentLyrics] = useState<RecentSharedLyrics[]>([])
  const [currentTime] = useState(() => Date.now())
  const [sharingSession, setSharingSession] = useState<Session | null>(null)
  const [deletingSession, setDeletingSession] = useState<Session | null>(null)
  useEffect(() => {
    sessionStore.getAllSessions().then(setSessions)
    getRecentSharedLyrics().then(setRecentLyrics)
  }, [])

  useEffect(() => () => searchAbortRef.current?.abort(), [])

  const [deleteError, setDeleteError] = useState<Session | null>(null)

  const commitSetRemoval = useCallback(async (target: Session) => {
    await sessionStore.deleteSession(target.id)
    setSessions(await sessionStore.getAllSessions())
    setDeleteError(null)
  }, [])

  const {
    pending: pendingSetRemoval,
    start: startSetRemoval,
    undo: undoSetRemoval,
  } = usePendingRemoval<Session>({ onCommit: commitSetRemoval, onError: setDeleteError })

  const visibleSessions = pendingSetRemoval
    ? sessions.filter((session) => session.id !== pendingSetRemoval.id)
    : sessions
  const conflictSessions = visibleSessions.filter((session) => syncState.conflicts.has(session.id))

  const undoNote = useMemo<ChangeNote | null>(
    () =>
      pendingSetRemoval
        ? {
            text: 'Set deleted',
            action: { label: 'Undo', run: undoSetRemoval },
          }
        : null,
    [pendingSetRemoval, undoSetRemoval],
  )
  const dismissUndoToast = useCallback(() => undefined, [])

  const handleDeleteRecentLyrics = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await removeRecentSharedLyrics(id)
    const updated = await getRecentSharedLyrics()
    setRecentLyrics(updated)
  }

  const handleClearLibrary = async () => {
    if (window.confirm('Clear all cached songs, sessions, and recent lyrics?')) {
      await songCache.clearAll()
      const all = await sessionStore.getAllSessions()
      for (const s of all) {
        await sessionStore.deleteSession(s.id)
      }
      setSessions([])
      await clearRecentSharedLyrics()
      setRecentLyrics([])
    }
  }

  const handleExtract = async () => {
    setGeneralError(null)
    if (!online) {
      setGeneralError(OFFLINE_MESSAGE)
      return
    }
    const { sources, invalid, tokenCount } = parsePastedSources(inputText)
    if (tokenCount === 0) {
      setGeneralError('Please paste at least one chord sheet URL.')
      return
    }

    if (sources.length === 0 && invalid.length > 0) {
      setGeneralError(
        `No valid URLs found: ${invalid.map((i) => `${i.input} (${i.reason})`).join(', ')}`,
      )
      return
    }

    setIsProcessing(true)
    try {
      const result = await importSources(sources, {
        invalidInputs: invalid,
        onProgress: setStatuses,
      })
      trackSongImport('pasted_link', result.imported, tokenCount)
      if (!result.session) {
        setGeneralError('None of these links could be added. Check the details below.')
        return
      }
      navigate(sessionPath(result.session))
    } catch {
      trackSongImport('pasted_link', 0, tokenCount)
      setGeneralError('Could not save all imported songs. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!searchQuery.trim()) return
    if (!online) {
      setSearchError(OFFLINE_MESSAGE)
      return
    }

    const startedAt = Date.now()
    searchAbortRef.current?.abort()
    const controller = new AbortController()
    searchAbortRef.current = controller
    const generation = ++searchGenerationRef.current
    setIsSearching(true)
    setSearchError(null)
    setHasSearched(true)
    setSearchResults([])
    setSearchSources([])
    setSearchPartial(false)

    try {
      const response = await searchApiStream(searchQuery.trim(), {
        signal: controller.signal,
        onSource: (source) => {
          if (generation !== searchGenerationRef.current) return
          setSearchSources((prev) => upsertSearchSource(prev, source))
          setSearchResults((prev) => mergePartialSearchCandidates(prev, source.candidates))
        },
      })
      if (generation !== searchGenerationRef.current) return

      // Apply the backend's balanced final selection while keeping visible
      // cards in place where possible.
      setSearchResults((prev) => mergeFinalSearchCandidates(prev, response.results))
      setSearchSources(response.sources ?? [])
      setSearchPartial(Boolean(response.partial))
      trackEvent('song_search', {
        entry_page: 'home',
        outcome: 'success',
        result_count: response.results.length,
      })
      trackSearchTiming('home', Date.now() - startedAt, 'success', response.results.length)
    } catch (err) {
      if (generation !== searchGenerationRef.current || controller.signal.aborted) return
      setSearchError((err as Error).message || 'Failed to search songs')
      setSearchResults([])
      setSearchSources([])
      trackEvent('song_search', { entry_page: 'home', outcome: 'error', result_count: 0 })
      trackSearchTiming('home', Date.now() - startedAt, 'error', 0)
    } finally {
      if (generation === searchGenerationRef.current) setIsSearching(false)
    }
  }

  const handleCreateFromSearch = async (candidate: SearchCandidate) => {
    if (creatingFromUrl) return
    setCreatingFromUrl(candidate.url)

    try {
      const result = await importSources([sourceFromCandidate(candidate)], { requireAll: true })
      trackSongImport('search', result.imported, 1)
      if (result.session) {
        navigate(sessionPath(result.session))
        return
      }
      setCreatingFromUrl(null)
    } catch (err) {
      trackSongImport('search', 0, 1)
      alert(`Could not create setlist: ${(err as Error).message}`)
      setCreatingFromUrl(null)
    }
  }

  const handleCreateFromTray = async () => {
    const session = await tray.create()
    if (session) navigate(sessionPath(session))
  }

  return (
    <div
      className={`mx-auto max-w-6xl space-y-7 px-[3%] ${tray.items.length > 0 ? 'pb-24 lg:pb-0' : ''}`}
    >
      <HomeNotice />
      <div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-[-0.02em] text-[var(--ui-text)]">
              Start a new session
            </h2>
          </div>
          <div className="[&_.ui-segmented__thumb]:bg-ui-accent/10! flex flex-col gap-2 sm:flex-row sm:items-center [&_.ui-segmented]:bg-[var(--ui-surface-flat)]!">
            <SegmentedControl
              label="Session source"
              value={createMode}
              onChange={setCreateMode}
              options={[
                { value: 'search', label: 'Search', icon: <Search size={14} /> },
                { value: 'paste', label: 'Paste links', icon: <Link2 size={14} /> },
              ]}
            />
          </div>
        </div>

        <div className="mt-4">
          {createMode === 'paste' ? (
            <PasteUrlForm
              value={inputText}
              onChange={setInputText}
              onSubmit={handleExtract}
              isProcessing={isProcessing}
              disabled={!online}
              error={generalError}
              submitLabel="Extract and open session"
              processingLabel="Extracting songs"
              linkCount={splitUrls(inputText).length}
              className="[&_.ui-field]:bg-[var(--ui-surface-flat)]!"
            />
          ) : (
            <div
              className={
                tray.items.length > 0
                  ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-5'
                  : ''
              }
            >
              <div className="min-w-0 space-y-4">
                <SearchForm
                  query={searchQuery}
                  onQueryChange={setSearchQuery}
                  onSubmit={handleSearch}
                  isSearching={isSearching}
                  disabled={!online}
                  error={searchError}
                  description="Search by title or artist across Ultimate Guitar, PNW Chords, Essential Worship, Worship Together and WorshipChords"
                  placeholder="e.g. Goodness of God, Way Maker, Phil Wickham, Bethel..."
                  className="[&_.ui-field]:bg-[var(--ui-surface-flat)]!"
                />
                <SearchResults
                  results={searchResults}
                  isSearching={isSearching}
                  hasSearched={hasSearched}
                  hasError={Boolean(searchError)}
                  sources={searchSources}
                  partial={searchPartial}
                  emptyMessage="No matching chord sheets found. Try a different title or artist name."
                  onSelect={tray.add}
                  getActionState={(candidate) => {
                    const inTray = tray.urls.has(candidate.url)
                    const starting = creatingFromUrl === candidate.url
                    return {
                      label: inTray
                        ? 'Added'
                        : tray.isFull
                          ? 'Limit reached'
                          : tray.items.length === 0
                            ? 'Add multiple songs'
                            : 'Add to set',
                      disabled:
                        inTray || tray.isFull || tray.isCreating || Boolean(creatingFromUrl),
                      quick:
                        tray.items.length === 0
                          ? {
                              label: 'Start now',
                              disabled: starting || Boolean(creatingFromUrl),
                              loading: starting,
                              onSelect: () => handleCreateFromSearch(candidate),
                            }
                          : undefined,
                    }
                  }}
                />
              </div>
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
            </div>
          )}

          <ImportProgressList
            statuses={statuses}
            className="mt-6 border-t border-[var(--ui-border)] pt-4"
          />
        </div>
      </div>

      <div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-[-0.02em] text-[var(--ui-text)]">
              Recent sessions
            </h2>
            <p className="mt-1 text-xs text-[var(--ui-text-muted)]">
              Sessions are saved locally within your browser.
            </p>
          </div>
          {(visibleSessions.length > 0 || recentLyrics.length > 0) && (
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={handleClearLibrary}
            >
              Clear library
            </Button>
          )}
        </div>

        {conflictSessions.length > 0 && (
          <StatusBanner tone="warning" className="mb-4" icon={<AlertTriangle size={16} />}>
            <p>
              {conflictSessions.length === 1
                ? '1 set needs your choice.'
                : `${conflictSessions.length} sets need your choice.`}
            </p>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {conflictSessions.map((session) => (
                <li key={session.id}>
                  <Link
                    to={sessionPath(session)}
                    className="text-ui-accent-strong inline-flex min-h-8 items-center font-semibold underline underline-offset-2"
                  >
                    {session.name}
                  </Link>
                </li>
              ))}
            </ul>
          </StatusBanner>
        )}

        {deleteError && (
          <StatusBanner
            tone="error"
            className="mb-4"
            actions={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const target = deleteError
                  setDeleteError(null)
                  startSetRemoval(target)
                }}
              >
                Try again
              </Button>
            }
          >
            Couldn't delete "{deleteError.name}". Nothing was removed.
          </StatusBanner>
        )}

        {visibleSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--ui-border)] bg-[var(--ui-surface-muted)] px-5 py-10 text-center">
            <span className="bg-ui-accent/10 text-ui-accent-strong mb-3 flex h-10 w-10 items-center justify-center rounded-full">
              <ListMusic size={19} />
            </span>
            <p className="text-sm font-semibold text-[var(--ui-text)]">No saved sessions yet</p>
            <p className="mt-1 text-xs text-[var(--ui-text-muted)]">
              Your next setlist will appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleSessions.map((session) => (
              <article
                key={session.id}
                onClick={() => navigate(sessionPath(session))}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    navigate(sessionPath(session))
                  }
                }}
                role="link"
                tabIndex={0}
                className={`group flex min-h-32 cursor-pointer flex-col justify-between rounded-xl border bg-[var(--ui-surface-flat)] p-4 transition outline-none hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-3 focus-visible:ring-[var(--ui-focus)] ${
                  session.liveSourceId && !session.liveEnded
                    ? 'border-emerald-300 hover:border-emerald-600 dark:border-emerald-400/30 dark:hover:border-emerald-400'
                    : 'border-[var(--ui-border)] hover:border-[var(--ui-border-strong)]'
                }`}
              >
                <div>
                  {session.liveSourceId ? (
                    <span
                      className={`mb-3 flex h-8 w-8 items-center justify-center rounded-lg ${session.liveEnded ? 'bg-[var(--ui-surface-raised)] text-[var(--ui-text-muted)]' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-400'}`}
                    >
                      <Radio size={16} aria-hidden="true" />
                    </span>
                  ) : (
                    <span className="bg-ui-accent/10 text-ui-accent-strong mb-3 flex h-8 w-8 items-center justify-center rounded-lg">
                      <ListMusic size={16} />
                    </span>
                  )}
                  <h3 className="text-ui-text group-hover:text-ui-accent-strong truncate text-sm font-bold transition-colors">
                    {session.name}
                  </h3>
                  {session.liveSourceId ? (
                    <LivePill className="mt-1" tone={session.liveEnded ? 'ended' : 'live'}>
                      <Radio size={11} aria-hidden="true" />
                      {session.liveEnded ? 'Live set ended' : 'Live set'}
                    </LivePill>
                  ) : (
                    <LiveShareChip sessionId={session.id} className="mt-1" />
                  )}
                  <p className="mt-1 text-xs text-[var(--ui-text-muted)]">
                    {songCount(session.songs.length)} ·{' '}
                    {new Date(session.createdAt).toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <div className="mt-4 flex items-center justify-end gap-1 border-t border-[var(--ui-border)] pt-2">
                  <IconButton
                    label="Share setlist"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSharingSession(session)
                    }}
                  >
                    <Share2 size={15} />
                  </IconButton>
                  {!session.liveSourceId && (
                    <IconButton
                      label="Rename set"
                      variant="ghost"
                      onClick={async (e) => {
                        e.stopPropagation()
                        const newName = window.prompt('Rename set:', session.name)
                        if (newName && newName.trim()) {
                          await sessionStore.renameSession(session.id, newName.trim())
                          const updated = await sessionStore.getAllSessions()
                          setSessions(updated)
                        }
                      }}
                    >
                      <Pencil size={15} />
                    </IconButton>
                  )}
                  <IconButton
                    label="Delete session"
                    variant="danger"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeletingSession(session)
                    }}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {/* Recent Shared Lyrics */}
      {recentLyrics.length > 0 && (
        <div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold tracking-[-0.02em] text-[var(--ui-text)]">
                Recent shared lyrics
              </h2>
              <p className="mt-1 text-xs text-[var(--ui-text-muted)]">
                Shared lyrics sets opened on this device.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentLyrics.map((item) => {
              const isExpired = new Date(item.expiresAt).getTime() < currentTime
              return (
                <article
                  key={item.id}
                  onClick={() => navigate(`/lyrics/${item.id}`)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      navigate(`/lyrics/${item.id}`)
                    }
                  }}
                  role="link"
                  tabIndex={0}
                  className="group flex min-h-32 cursor-pointer flex-col justify-between rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-flat)] p-4 transition outline-none hover:-translate-y-0.5 hover:border-[var(--ui-border-strong)] hover:shadow-md focus-visible:ring-3 focus-visible:ring-[var(--ui-focus)]"
                >
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <span className="bg-ui-accent/10 text-ui-accent-strong flex h-8 w-8 items-center justify-center rounded-lg">
                        <FileText size={16} />
                      </span>
                      {isExpired ? (
                        <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                          Expired
                        </span>
                      ) : (
                        <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                          Shared Lyrics
                        </span>
                      )}
                    </div>
                    <h3 className="text-ui-text group-hover:text-ui-accent-strong truncate text-sm font-bold transition-colors">
                      {item.name}
                    </h3>
                    <p className="mt-1 text-xs text-[var(--ui-text-muted)]">
                      {item.songCount} song{item.songCount === 1 ? '' : 's'} · Opened{' '}
                      {new Date(item.openedAt).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <div className="mt-4 flex items-center justify-end gap-1 border-t border-[var(--ui-border)] pt-2">
                    <IconButton
                      label="Remove from recent lyrics"
                      variant="danger"
                      onClick={(e) => handleDeleteRecentLyrics(item.id, e)}
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      )}

      {/* Share Modal */}
      {sharingSession && (
        <ShareModal session={sharingSession} isOpen onClose={() => setSharingSession(null)} />
      )}

      <OverlayDialog
        isOpen={deletingSession !== null}
        onClose={() => setDeletingSession(null)}
        title="Delete this set?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeletingSession(null)}>
              Cancel
            </Button>
            <Button
              variant="danger-solid"
              onClick={() => {
                if (!deletingSession) return
                const target = deletingSession
                setDeletingSession(null)
                startSetRemoval(target)
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--ui-text)]">
          {deletingSession?.liveSourceId
            ? `"${deletingSession.name}" will be removed from this device. The live set itself is not changed. You can undo for 5 seconds.`
            : `"${deletingSession?.name}" will be deleted. You can undo for 5 seconds.`}
        </p>
      </OverlayDialog>

      <ChangeToast
        note={tray.undoNote ?? undoNote}
        onDismiss={dismissUndoToast}
        progressMs={UNDO_WINDOW_MS}
        progressKey={tray.undoKey ?? pendingSetRemoval?.id}
        pauseOnHover={false}
        dismissible={false}
      />
    </div>
  )
}
