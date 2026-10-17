import { trackEvent, trackSongImport } from '../lib/analytics'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  ExternalLink,
  FileText,
  FileUp,
  Lightbulb,
  Link2,
  ListMusic,
  Pencil,
  Search,
  Share2,
  Trash2,
} from 'lucide-react'
import { splitUrls, validateUrls } from '../../functions/src/urls'
import { songCache } from '../lib/songCache'
import { scrapeApi, searchApi, type SearchCandidate } from '../lib/api'
import { sessionStore, type Session, type SessionSongItem } from '../lib/sessionStore'
import {
  getRecentSharedLyrics,
  removeRecentSharedLyrics,
  clearRecentSharedLyrics,
  type RecentSharedLyrics,
} from '../lib/recentLyricsStore'
import ShareModal from '../components/ShareModal'
import UploadSheetModal from '../components/UploadSheetModal'
import { buildSharedSetSnapshot, ShareSnapshotError } from '../lib/shareSnapshot'
import type { SharedSetSnapshot, Song } from '../types/song'
import { Button, IconButton, SegmentedControl, StatusBanner, Surface } from '../components/ui'

interface ImportStatus {
  url: string
  status: 'pending' | 'cached' | 'fetching' | 'done' | 'error'
  message?: string
}

const HOME_TIPS = [
  'Use Edit chords to move, change, or delete chords.',
  'Share a setlist so everyone gets the same songs and song order.',
  'Use Arrange setlist to put your songs in the right order.',
  'Search by song title or artist if you do not have a link.',
  'Use the key menu near the song title to change the song key.',
  'If a lyric line is too long, open Edit chords and split it where you want.',
] as const

export default function HomePage() {
  const navigate = useNavigate()
  const [homeTip] = useState(() => HOME_TIPS[Math.floor(Math.random() * HOME_TIPS.length)])
  const [createMode, setCreateMode] = useState<'paste' | 'search'>('paste')

  // Paste mode state
  const [inputText, setInputText] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [statuses, setStatuses] = useState<ImportStatus[]>([])
  const [generalError, setGeneralError] = useState<string | null>(null)

  // Search mode state
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchCandidate[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [creatingFromUrl, setCreatingFromUrl] = useState<string | null>(null)

  const [sessions, setSessions] = useState<Session[]>([])
  const [recentLyrics, setRecentLyrics] = useState<RecentSharedLyrics[]>([])
  const [currentTime] = useState(() => Date.now())
  const [sharingSnapshot, setSharingSnapshot] = useState<SharedSetSnapshot | null>(null)
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)

  const handleImportUploadedSongs = async (songs: Song[]) => {
    for (const song of songs) {
      await songCache.saveSong(song)
    }
    const sessionSongs: SessionSongItem[] = songs.map((s) => ({
      url: s.sourceUrl,
      title: s.title,
      artist: s.artist,
      status: 'ok',
    }))
    const newSession = await sessionStore.createSession(sessionSongs)
    trackSongImport('upload', songs.length, songs.length)
    navigate(`/session/${newSession.id}`)
  }

  useEffect(() => {
    sessionStore.getAllSessions().then(setSessions)
    getRecentSharedLyrics().then(setRecentLyrics)
  }, [])

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await sessionStore.deleteSession(id)
    const updated = await sessionStore.getAllSessions()
    setSessions(updated)
  }

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

  const handleShareSession = async (session: Session) => {
    try {
      setSharingSnapshot(await buildSharedSetSnapshot(session))
    } catch (err) {
      const message = err instanceof ShareSnapshotError ? err.message : 'Unable to prepare this set for sharing.'
      window.alert(message)
    }
  }

  const handleExtract = async () => {
    setGeneralError(null)
    const rawTokens = splitUrls(inputText)
    if (rawTokens.length === 0) {
      setGeneralError('Please paste at least one chord sheet URL.')
      return
    }

    const { valid, invalid } = validateUrls(rawTokens)
    if (valid.length === 0 && invalid.length > 0) {
      setGeneralError(`No valid URLs found: ${invalid.map((i) => `${i.input} (${i.reason})`).join(', ')}`)
      return
    }

    setIsProcessing(true)
    let savedCount = 0
    try {
      const initialStatuses: ImportStatus[] = [
        ...valid.map((v) => ({ url: v.url, status: 'pending' as const })),
        ...invalid.map((i) => ({ url: i.input, status: 'error' as const, message: i.reason })),
      ]
      setStatuses(initialStatuses)

      const sessionSongs: SessionSongItem[] = []
      const uncachedUrls: string[] = []

      // 1. Check client-side IndexedDB cache first
      for (const { url } of valid) {
        const cached = await songCache.getSong(url)
        if (cached) {
          sessionSongs.push({
            url,
            title: cached.title,
            artist: cached.artist,
            status: 'ok',
          })
          setStatuses((prev) =>
            prev.map((s) => (s.url === url ? { ...s, status: 'cached', message: 'Loaded from cache' } : s))
          )
        } else {
          uncachedUrls.push(url)
        }
      }

      // 2. Fetch uncached URLs in chunks of <= 5
      const CHUNK_SIZE = 5
      for (let i = 0; i < uncachedUrls.length; i += CHUNK_SIZE) {
        const chunk = uncachedUrls.slice(i, i + CHUNK_SIZE)
        setStatuses((prev) =>
          prev.map((s) => (chunk.includes(s.url) ? { ...s, status: 'fetching' } : s))
        )

        try {
          const response = await scrapeApi(chunk)
          for (const res of response.results) {
            if (res.status === 'ok' && res.song) {
              await songCache.saveSong(res.song)
              sessionSongs.push({
                url: res.url,
                title: res.song.title,
                artist: res.song.artist,
                status: 'ok',
              })
              setStatuses((prev) =>
                prev.map((s) => (s.url === res.url ? { ...s, status: 'done' } : s))
              )
            } else {
              const reason = res.message || 'Scrape failed'
              await songCache.recordFailed(res.url, reason)
              sessionSongs.push({
                url: res.url,
                status: 'error',
                errorMessage: reason,
              })
              setStatuses((prev) =>
                prev.map((s) => (s.url === res.url ? { ...s, status: 'error', message: reason } : s))
              )
            }
          }
        } catch (err) {
          const msg = (err as Error).message || 'Network error'
          for (const u of chunk) {
            sessionSongs.push({
              url: u,
              status: 'error',
              errorMessage: msg,
            })
            setStatuses((prev) =>
              prev.map((s) => (s.url === u ? { ...s, status: 'error', message: msg } : s))
            )
          }
        }
      }

      // Include invalid inputs in the session as error items so user can see and fix them
      for (const inv of invalid) {
        sessionSongs.push({
          url: inv.input,
          status: 'error',
          errorMessage: inv.reason,
        })
      }

      // 3. Create session and navigate
      const newSession = await sessionStore.createSession(sessionSongs)
      savedCount = sessionSongs.filter((song) => song.status === 'ok').length
      trackSongImport('pasted_link', sessionSongs.filter((song) => song.status === 'ok').length, rawTokens.length)
      setIsProcessing(false)
      navigate(`/session/${newSession.id}`)
    } catch {
      trackSongImport('pasted_link', savedCount, rawTokens.length)
      setGeneralError('Could not save all imported songs. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!searchQuery.trim()) return

    setIsSearching(true)
    setSearchError(null)
    setHasSearched(true)

    try {
      const candidates = await searchApi(searchQuery.trim())
      setSearchResults(candidates)
      trackEvent('song_search', { entry_page: 'home', outcome: 'success', result_count: candidates.length })
    } catch (err) {
      setSearchError((err as Error).message || 'Failed to search songs')
      setSearchResults([])
      trackEvent('song_search', { entry_page: 'home', outcome: 'error', result_count: 0 })
    } finally {
      setIsSearching(false)
    }
  }

  const handleCreateFromSearch = async (candidate: SearchCandidate) => {
    if (creatingFromUrl) return
    setCreatingFromUrl(candidate.url)

    try {
      // 1. Check local cache or scrape
      let song = await songCache.getSong(candidate.url)
      if (!song) {
        const scrapeRes = await scrapeApi([candidate.url])
        const first = scrapeRes.results[0]
        if (first && first.status === 'ok' && first.song) {
          song = first.song
          await songCache.saveSong(song)
        }
      }

      if (!song) throw new Error('Could not load song')

      const songItem: SessionSongItem = {
        url: candidate.url,
        title: candidate.title,
        artist: candidate.artist,
        status: 'ok',
      }

      // 2. Create new session with this song
      const newSession = await sessionStore.createSession([songItem])
      trackSongImport('search', 1, 1)
      navigate(`/session/${newSession.id}`)
    } catch (err) {
      trackSongImport('search', 0, 1)
      alert(`Could not create setlist: ${(err as Error).message}`)
      setCreatingFromUrl(null)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <div className="px-1 pt-2 sm:pt-4">
        <div className="flex items-start gap-3 rounded-2xl border border-[#3368A0]/20 bg-white/70 px-4 py-3 text-sm leading-6 text-neutral-700 shadow-sm backdrop-blur-sm dark:border-amber-400/20 dark:bg-[#1a1a1a]/80 dark:text-[#d4d4d0]">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#3368A0]/10 text-[#3368A0] dark:bg-amber-400/10 dark:text-amber-400" aria-hidden="true"><Lightbulb size={14} /></span>
          <p><span className="mr-1 font-bold text-[#255283] dark:text-amber-300">Tip:</span>{homeTip}</p>
        </div>
      </div>

      <Surface className="overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-[var(--ui-border)] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h2 className="text-lg font-bold tracking-[-0.02em] text-[var(--ui-text)]">New session</h2>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SegmentedControl
              label="Session source"
              value={createMode}
              onChange={setCreateMode}
              options={[
                { value: 'paste', label: 'Paste links', icon: <Link2 size={14} /> },
                { value: 'search', label: 'Search', icon: <Search size={14} /> },
              ]}
            />
            <Button variant="secondary" icon={<FileUp size={15} />} onClick={() => setIsUploadModalOpen(true)}>
              Upload chart
            </Button>
          </div>
        </div>

        <div className="p-4 sm:p-5">

        {createMode === 'paste' ? (
          <div className="space-y-4">
            <p className="text-sm leading-6 text-[var(--ui-text-muted)]">
              Paste one or more chord sheet URLs (Ultimate Guitar, PNW Chords, Worship Chords, Worship Together).
            </p>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isProcessing}
              placeholder="https://tabs.ultimate-guitar.com/...&#10;https://pnwchords.com/..."
              rows={5}
              className="ui-field min-h-36 resize-y p-3.5 font-mono text-sm leading-6"
            />
            {generalError && (
              <StatusBanner tone="error" icon={<AlertCircle size={16} />}>
                {generalError}
              </StatusBanner>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs font-medium text-[var(--ui-text-muted)]">
                {splitUrls(inputText).length} link(s) entered
              </span>
              <Button
                variant="primary"
                onClick={handleExtract}
                disabled={isProcessing || !inputText.trim()}
                loading={isProcessing}
              >
                {isProcessing ? 'Extracting songs' : 'Extract and open session'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm leading-6 text-[var(--ui-text-muted)]">
              Search by title or artist across Ultimate Guitar, PNW Chords, and Worship Together.
            </p>
            <form onSubmit={handleSearch} className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="e.g. Goodness of God, Way Maker, Phil Wickham, Bethel..."
                className="ui-field flex-1 px-3.5 py-2.5 text-sm"
              />
              <Button
                type="submit"
                variant="primary"
                icon={<Search size={15} />}
                disabled={isSearching || !searchQuery.trim()}
                loading={isSearching}
              >
                Search
              </Button>
            </form>
            {searchError && (
              <StatusBanner tone="error" icon={<AlertCircle size={16} />}>
                {searchError}
              </StatusBanner>
            )}
            {isSearching ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-[var(--ui-text-muted)]" role="status">
                <span className="ui-spinner" /> Searching supported chord sites
              </div>
            ) : searchResults.length > 0 ? (
              <div className="space-y-3">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ui-text-muted)]">
                  Search results · {searchResults.length}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {searchResults.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex min-h-40 flex-col justify-between rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] p-4 transition hover:border-[var(--ui-border-strong)]"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-bold leading-snug tracking-[-0.01em] text-[var(--ui-text)]">
                            {item.title}
                          </h4>
                          <span className="shrink-0 rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface-raised)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--ui-text-muted)]">
                            {item.site}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--ui-text-muted)]">
                          {item.artist}
                        </p>

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
                          onClick={() => handleCreateFromSearch(item)}
                          disabled={creatingFromUrl === item.url}
                          loading={creatingFromUrl === item.url}
                        >
                          Start setlist
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : hasSearched ? (
              <div className="py-8 text-center text-xs text-[var(--ui-text-muted)]">
                No matching chord sheets found. Try a different title or artist name.
              </div>
            ) : null}
          </div>
        )}

        {statuses.length > 0 && (
          <div className="mt-6 space-y-2 border-t border-[var(--ui-border)] pt-4">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ui-text-muted)]">
              Import Progress
            </h3>
            {statuses.map((s, idx) => (
              <div key={idx} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--ui-surface-muted)] px-3 py-2 text-xs">
                <span className="max-w-[70%] truncate font-mono text-[var(--ui-text)]">{s.url}</span>
                <span
                  className={
                    s.status === 'done' || s.status === 'cached'
                      ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                      : s.status === 'error'
                        ? 'text-red-600 dark:text-red-400 font-medium'
                        : 'text-[#255283] dark:text-amber-400 animate-pulse font-medium'
                  }
                >
                  {s.status === 'cached' && 'Cached ✓'}
                  {s.status === 'done' && 'Extracted ✓'}
                  {s.status === 'fetching' && 'Fetching...'}
                  {s.status === 'pending' && 'Waiting...'}
                  {s.status === 'error' && (s.message || 'Failed')}
                </span>
              </div>
            ))}
          </div>
        )}
        </div>
      </Surface>

      <Surface className="p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-[-0.02em] text-[var(--ui-text)]">Recent sessions</h2>
            <p className="mt-1 text-xs text-[var(--ui-text-muted)]">Sessions are saved locally within your browser.</p>
          </div>
          {(sessions.length > 0 || recentLyrics.length > 0) && (
            <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={handleClearLibrary}>Clear library</Button>
          )}
        </div>

        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--ui-border)] bg-[var(--ui-surface-muted)] px-5 py-10 text-center">
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#3368A0]/10 text-[#3368A0] dark:bg-amber-400/10 dark:text-amber-400"><ListMusic size={19} /></span>
            <p className="text-sm font-semibold text-[var(--ui-text)]">No saved sessions yet</p>
            <p className="mt-1 text-xs text-[var(--ui-text-muted)]">Your next setlist will appear here.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.map((session) => (
              <article
                key={session.id}
                onClick={() => navigate(`/session/${session.id}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') navigate(`/session/${session.id}`)
                }}
                role="link"
                tabIndex={0}
                className="group flex min-h-32 cursor-pointer flex-col justify-between rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] p-4 outline-none transition hover:-translate-y-0.5 hover:border-[var(--ui-border-strong)] hover:shadow-md focus-visible:ring-3 focus-visible:ring-[var(--ui-focus)]"
              >
                <div>
                  <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-[#3368A0]/10 text-[#3368A0] dark:bg-amber-400/10 dark:text-amber-400"><ListMusic size={16} /></span>
                  <h3 className="truncate text-sm font-bold text-[var(--ui-text)] transition-colors group-hover:text-[#3368A0] dark:group-hover:text-amber-400">
                    {session.name}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--ui-text-muted)]">
                    {session.songs.length} song(s) · {new Date(session.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="mt-4 flex items-center justify-end gap-1 border-t border-[var(--ui-border)] pt-2">
                  <IconButton
                    label="Share setlist"
                    variant="ghost"
                    onClick={async (e) => {
                      e.stopPropagation()
                      await handleShareSession(session)
                    }}
                  >
                    <Share2 size={15} />
                  </IconButton>
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
                  <IconButton
                    label="Delete session"
                    variant="danger"
                    onClick={(e) => handleDeleteSession(session.id, e)}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </div>
              </article>
            ))}
          </div>
        )}
      </Surface>

      {/* Recent Shared Lyrics */}
      {recentLyrics.length > 0 && (
        <Surface className="p-4 sm:p-5">
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
                    if (event.key === 'Enter' || event.key === ' ') navigate(`/lyrics/${item.id}`)
                  }}
                  role="link"
                  tabIndex={0}
                  className="group flex min-h-32 cursor-pointer flex-col justify-between rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] p-4 outline-none transition hover:-translate-y-0.5 hover:border-[var(--ui-border-strong)] hover:shadow-md focus-visible:ring-3 focus-visible:ring-[var(--ui-focus)]"
                >
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#3368A0]/10 text-[#3368A0] dark:bg-amber-400/10 dark:text-amber-400">
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
                    <h3 className="truncate text-sm font-bold text-[var(--ui-text)] transition-colors group-hover:text-[#3368A0] dark:group-hover:text-amber-400">
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
        </Surface>
      )}

      {/* Share Modal */}
      {sharingSnapshot && (
        <ShareModal
          snapshot={sharingSnapshot}
          isOpen={Boolean(sharingSnapshot)}
          onClose={() => setSharingSnapshot(null)}
        />
      )}

      {/* Upload SongSelect Sheet Modal */}
      <UploadSheetModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onImport={handleImportUploadedSongs}
      />
    </div>
  )
}
