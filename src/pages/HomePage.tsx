import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { splitUrls, validateUrls } from '../../functions/src/urls'
import { songCache } from '../lib/songCache'
import { scrapeApi, searchApi, type SearchCandidate } from '../lib/api'
import { sessionStore, type Session, type SessionSongItem } from '../lib/sessionStore'
import ShareModal from '../components/ShareModal'
import UploadSheetModal from '../components/UploadSheetModal'
import type { SharePayload, Song } from '../types/song'

interface ImportStatus {
  url: string
  status: 'pending' | 'cached' | 'fetching' | 'done' | 'error'
  message?: string
}

export default function HomePage() {
  const navigate = useNavigate()
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
  const [sharingPayload, setSharingPayload] = useState<SharePayload | null>(null)
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
    navigate(`/session/${newSession.id}`)
  }

  useEffect(() => {
    sessionStore.getAllSessions().then(setSessions)
  }, [])

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await sessionStore.deleteSession(id)
    const updated = await sessionStore.getAllSessions()
    setSessions(updated)
  }

  const handleClearLibrary = async () => {
    if (window.confirm('Clear all cached songs and sessions?')) {
      await songCache.clearAll()
      const all = await sessionStore.getAllSessions()
      for (const s of all) {
        await sessionStore.deleteSession(s.id)
      }
      setSessions([])
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
    setIsProcessing(false)
    navigate(`/session/${newSession.id}`)
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
    } catch (err) {
      setSearchError((err as Error).message || 'Failed to search songs')
      setSearchResults([])
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

      const songItem: SessionSongItem = {
        url: candidate.url,
        title: candidate.title,
        artist: candidate.artist,
        status: 'ok',
      }

      // 2. Create new session with this song
      const newSession = await sessionStore.createSession([songItem])
      navigate(`/session/${newSession.id}`)
    } catch (err) {
      alert(`Could not create setlist: ${(err as Error).message}`)
      setCreatingFromUrl(null)
    }
  }

  return (
    <div className="space-y-8">
      {/* Create Setlist / Session Section */}
      <section className="bg-white dark:bg-[#1a1a1a] rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#C8DFDB] dark:border-[#282828] pb-4">
          <div>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-[#e5e5e5]">New Song Session</h2>
            <p className="text-xs text-neutral-500 dark:text-[#999999] mt-0.5">
              Paste chord sheet links or search online to start a new setlist.
            </p>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="flex bg-neutral-100 dark:bg-[#101010] p-1 rounded-lg border border-neutral-200 dark:border-[#282828] self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setCreateMode('paste')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
                createMode === 'paste'
                  ? 'bg-[#3368A0] text-white shadow-xs dark:bg-amber-500 dark:text-black'
                  : 'text-neutral-600 dark:text-[#999999] hover:text-neutral-900 dark:hover:text-[#e5e5e5]'
              }`}
            >
              <span>📋</span>
              <span>Paste Links</span>
            </button>
            <button
              type="button"
              onClick={() => setCreateMode('search')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
                createMode === 'search'
                  ? 'bg-[#3368A0] text-white shadow-xs dark:bg-amber-500 dark:text-black'
                  : 'text-neutral-600 dark:text-[#999999] hover:text-neutral-900 dark:hover:text-[#e5e5e5]'
              }`}
            >
              <span>🔍</span>
              <span>Search Songs</span>
            </button>
            <button
              type="button"
              onClick={() => setIsUploadModalOpen(true)}
              className="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 bg-[#3368A0]/10 text-[#255283] hover:bg-[#3368A0]/20 border border-[#3368A0]/30 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20 dark:border-amber-500/30"
              title="Upload SongSelect chord chart PDF or PNG/JPG images"
            >
              <span>📄</span>
              <span>Upload PDF / Images</span>
            </button>
          </div>
        </div>

        {createMode === 'paste' ? (
          <div>
            <p className="text-sm text-neutral-600 dark:text-[#999999] mb-4">
              Paste one or more chord sheet URLs (Ultimate Guitar, PNW Chords, Worship Chords, Worship Together).
            </p>

            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isProcessing}
              placeholder="https://tabs.ultimate-guitar.com/...&#10;https://pnwchords.com/..."
              rows={5}
              className="w-full bg-neutral-50 dark:bg-[#101010] border border-neutral-300 dark:border-[#282828] rounded-lg p-3 text-sm focus:outline-none focus:border-[#3368A0] dark:focus:border-amber-500 font-mono resize-y text-neutral-900 dark:text-[#e5e5e5] placeholder:text-neutral-400 dark:placeholder:text-[#666666]"
            />

            {generalError && (
              <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/80 rounded text-red-700 dark:text-red-200 text-sm">
                {generalError}
              </div>
            )}

            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-neutral-500 dark:text-[#999999]">
                {splitUrls(inputText).length} link(s) entered
              </span>
              <button
                onClick={handleExtract}
                disabled={isProcessing || !inputText.trim()}
                className="px-5 py-2.5 bg-[#3368A0] hover:bg-[#255283] disabled:bg-neutral-200 disabled:text-neutral-400 dark:disabled:bg-[#282828] dark:disabled:text-[#666666] font-semibold text-white dark:text-black dark:bg-amber-500 dark:hover:bg-amber-600 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed text-sm"
              >
                {isProcessing ? 'Extracting Songs...' : 'Extract & Open Session'}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm text-neutral-600 dark:text-[#999999] mb-4">
              Search by title or artist across Ultimate Guitar, PNW Chords, and Worship Together.
            </p>

            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="e.g. Goodness of God, Way Maker, Phil Wickham, Bethel..."
                className="flex-1 bg-neutral-50 dark:bg-[#101010] border border-neutral-300 dark:border-[#282828] rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#3368A0] dark:focus:border-amber-500 font-sans text-neutral-900 dark:text-[#e5e5e5] placeholder:text-neutral-400 dark:placeholder:text-[#666666]"
              />
              <button
                type="submit"
                disabled={isSearching || !searchQuery.trim()}
                className="px-5 py-2.5 bg-[#3368A0] hover:bg-[#255283] disabled:bg-neutral-200 disabled:text-neutral-400 dark:disabled:bg-[#282828] dark:disabled:text-[#666666] font-semibold text-white dark:text-black dark:bg-amber-500 dark:hover:bg-amber-400 rounded-lg transition-colors cursor-pointer text-sm shrink-0"
              >
                {isSearching ? 'Searching...' : 'Search'}
              </button>
            </form>

            {searchError && (
              <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/80 rounded text-red-700 dark:text-red-200 text-xs">
                {searchError}
              </div>
            )}

            {isSearching ? (
              <div className="py-8 text-center text-xs text-neutral-500 dark:text-[#999999] animate-pulse">
                Searching supported chord sites...
              </div>
            ) : searchResults.length > 0 ? (
              <div className="mt-4 space-y-3">
                <h3 className="text-xs uppercase tracking-wider font-semibold text-neutral-600 dark:text-[#999999]">
                  Search Results ({searchResults.length}) — Click &ldquo;+ Start Setlist&rdquo; to create a session
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {searchResults.map((item, idx) => (
                    <div
                      key={idx}
                      className="bg-neutral-50 dark:bg-[#101010] border border-neutral-200 dark:border-[#282828] rounded-xl p-4 flex flex-col justify-between hover:border-neutral-300 dark:hover:border-[#383838] transition-colors"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-bold text-neutral-900 dark:text-[#e5e5e5] text-sm leading-snug">
                            {item.title}
                          </h4>
                          <span className="text-[10px] bg-neutral-200 dark:bg-[#282828] text-neutral-600 dark:text-[#999999] px-2 py-0.5 rounded uppercase font-medium shrink-0">
                            {item.site}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-600 dark:text-[#999999] mt-0.5">
                          {item.artist}
                        </p>

                        <div className="flex items-center gap-2 mt-2 text-[11px] text-neutral-500 dark:text-[#999999]">
                          {item.versionLabel && <span>{item.versionLabel}</span>}
                          {item.rating && <span>★ {item.rating.toFixed(1)}</span>}
                          {item.type && <span>• {item.type}</span>}
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-neutral-200 dark:border-[#282828] flex items-center justify-between">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-neutral-500 hover:text-neutral-800 dark:text-[#999999] dark:hover:text-[#e5e5e5] underline"
                        >
                          View source ↗
                        </a>
                        <button
                          type="button"
                          onClick={() => handleCreateFromSearch(item)}
                          disabled={creatingFromUrl === item.url}
                          className="px-3.5 py-1.5 bg-[#3368A0] hover:bg-[#255283] disabled:opacity-50 text-white dark:text-black dark:bg-amber-500 dark:hover:bg-amber-400 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                        >
                          {creatingFromUrl === item.url ? 'Creating...' : '+ Start Setlist'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : hasSearched ? (
              <div className="py-8 text-center text-xs text-neutral-500 dark:text-[#999999]">
                No matching chord sheets found. Try a different title or artist name.
              </div>
            ) : null}
          </div>
        )}

        {statuses.length > 0 && (
          <div className="mt-6 border-t border-[#C8DFDB] dark:border-[#282828] pt-4 space-y-2">
            <h3 className="text-xs font-semibold text-neutral-600 dark:text-[#999999] uppercase tracking-wider">
              Import Progress
            </h3>
            {statuses.map((s, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs py-1">
                <span className="truncate max-w-[70%] font-mono text-neutral-700 dark:text-[#d4d4d4]">{s.url}</span>
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
      </section>

      {/* Recent Sessions */}
      <section className="bg-white dark:bg-[#1a1a1a] rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-neutral-900 dark:text-[#e5e5e5]">Recent Sessions</h2>
            <p className="text-xs text-neutral-500 dark:text-[#999999]">Stored locally in your browser.</p>
          </div>
          {sessions.length > 0 && (
            <button
              onClick={handleClearLibrary}
              className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors cursor-pointer"
            >
              Clear Library
            </button>
          )}
        </div>

        {sessions.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-[#999999] py-3 italic">
            No saved sessions yet. Paste links above to start one!
          </p>
        ) : (
          <div className="divide-y divide-neutral-200 dark:divide-[#282828]">
            {sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => navigate(`/session/${session.id}`)}
                className="py-3 flex items-center justify-between hover:bg-[#C8DFDB]/20 dark:hover:bg-[#252525] px-2 rounded -mx-2 transition-colors cursor-pointer group"
              >
                <div className="flex-1 mr-2">
                  <h3 className="text-sm font-medium text-neutral-900 dark:text-[#e5e5e5] group-hover:text-[#3368A0] dark:group-hover:text-amber-400 transition-colors">
                    {session.name}
                  </h3>
                  <p className="text-xs text-neutral-500 dark:text-[#999999]">
                    {session.songs.length} song(s) · {new Date(session.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      const validSongs = session.songs
                        .filter((s) => s.status === 'ok')
                        .map((s) => ({
                          url: s.url,
                          title: s.title,
                          artist: s.artist,
                          customSections: s.customSections,
                          customSimplifiedSections: s.customSimplifiedSections,
                        }))
                      setSharingPayload({
                        v: 1,
                        name: session.name,
                        songs: validSongs,
                      })
                    }}
                    title="Share setlist"
                    className="text-xs text-neutral-400 hover:text-[#3368A0] dark:text-[#999999] dark:hover:text-amber-400 p-2 transition-colors cursor-pointer"
                  >
                    🔗
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation()
                      const newName = window.prompt('Rename set:', session.name)
                      if (newName && newName.trim()) {
                        await sessionStore.renameSession(session.id, newName.trim())
                        const updated = await sessionStore.getAllSessions()
                        setSessions(updated)
                      }
                    }}
                    title="Rename set"
                    className="text-xs text-neutral-400 hover:text-[#3368A0] dark:text-[#999999] dark:hover:text-amber-400 p-2 transition-colors cursor-pointer"
                  >
                    ✎
                  </button>
                  <button
                    onClick={(e) => handleDeleteSession(session.id, e)}
                    title="Delete session"
                    className="text-xs text-neutral-400 hover:text-red-500 dark:text-[#999999] dark:hover:text-red-400 p-2 transition-colors cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Share Modal */}
      {sharingPayload && (
        <ShareModal
          payload={sharingPayload}
          isOpen={Boolean(sharingPayload)}
          onClose={() => setSharingPayload(null)}
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
