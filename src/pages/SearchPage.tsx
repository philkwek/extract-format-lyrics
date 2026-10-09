import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { searchApi, type SearchCandidate, scrapeApi } from '../lib/api'
import { songCache } from '../lib/songCache'
import { sessionStore, type Session, type SessionSongItem } from '../lib/sessionStore'
import { splitUrls, validateUrls } from '../../functions/src/urls'

interface ImportStatus {
  url: string
  status: 'pending' | 'cached' | 'fetching' | 'done' | 'error'
  message?: string
}

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
  const [pasteStatuses, setPasteStatuses] = useState<ImportStatus[]>([])
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
    } catch (err) {
      setError((err as Error).message || 'Failed to search songs')
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const handleAddCandidate = async (candidate: SearchCandidate) => {
    if (addedUrls.has(candidate.url) || addingUrls.has(candidate.url)) return

    setAddingUrls((prev) => new Set(prev).add(candidate.url))

    try {
      // 1. Check or scrape the song
      let song = await songCache.getSong(candidate.url)
      if (!song) {
        const scrapeRes = await scrapeApi([candidate.url])
        const first = scrapeRes.results[0]
        if (first && first.status === 'ok' && first.song) {
          song = first.song
          await songCache.saveSong(song)
        }
      }

      // 2. Add to target session or create a new one
      const songItem: SessionSongItem = {
        url: candidate.url,
        title: candidate.title,
        artist: candidate.artist,
        status: 'ok',
      }

      let activeSessionId = targetSessionId
      if (activeSessionId) {
        const updated = await sessionStore.addSongToSession(activeSessionId, songItem)
        const newIndex = updated ? updated.songs.length - 1 : 0
        setAddedUrls((prev) => new Set(prev).add(candidate.url))
        navigate(`/session/${activeSessionId}?song=${newIndex}`)
      } else {
        const newSession = await sessionStore.createSession([songItem])
        activeSessionId = newSession.id
        setAddedUrls((prev) => new Set(prev).add(candidate.url))
        navigate(`/session/${activeSessionId}`)
      }
    } catch (err) {
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
    const rawTokens = splitUrls(pasteText)
    if (rawTokens.length === 0) {
      setPasteError('Please paste at least one chord sheet URL.')
      return
    }

    const { valid, invalid } = validateUrls(rawTokens)
    if (valid.length === 0 && invalid.length > 0) {
      setPasteError(`No valid URLs found: ${invalid.map((i) => `${i.input} (${i.reason})`).join(', ')}`)
      return
    }

    setIsProcessingPaste(true)
    const initialStatuses: ImportStatus[] = [
      ...valid.map((v) => ({ url: v.url, status: 'pending' as const })),
      ...invalid.map((i) => ({ url: i.input, status: 'error' as const, message: i.reason })),
    ]
    setPasteStatuses(initialStatuses)

    const sessionSongs: SessionSongItem[] = []
    const uncachedUrls: string[] = []

    // 1. Check IndexedDB cache first
    for (const { url } of valid) {
      const cached = await songCache.getSong(url)
      if (cached) {
        sessionSongs.push({
          url,
          title: cached.title,
          artist: cached.artist,
          status: 'ok',
        })
        setPasteStatuses((prev) =>
          prev.map((s) => (s.url === url ? { ...s, status: 'cached', message: 'Loaded from cache' } : s))
        )
      } else {
        uncachedUrls.push(url)
      }
    }

    // 2. Fetch uncached URLs in chunks
    const CHUNK_SIZE = 5
    for (let i = 0; i < uncachedUrls.length; i += CHUNK_SIZE) {
      const chunk = uncachedUrls.slice(i, i + CHUNK_SIZE)
      setPasteStatuses((prev) =>
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
            setPasteStatuses((prev) =>
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
            setPasteStatuses((prev) =>
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
          setPasteStatuses((prev) =>
            prev.map((s) => (s.url === u ? { ...s, status: 'error', message: msg } : s))
          )
        }
      }
    }

    // Include invalid inputs
    for (const inv of invalid) {
      sessionSongs.push({
        url: inv.input,
        status: 'error',
        errorMessage: inv.reason,
      })
    }

    // 3. Add to target session or create a new session
    if (targetSessionId) {
      let updated: Session | null = null
      for (const song of sessionSongs) {
        updated = await sessionStore.addSongToSession(targetSessionId, song)
      }
      setIsProcessingPaste(false)
      const targetIndex = updated ? updated.songs.length - sessionSongs.length : 0
      navigate(`/session/${targetSessionId}?song=${Math.max(0, targetIndex)}`)
    } else {
      const newSession = await sessionStore.createSession(sessionSongs)
      setIsProcessingPaste(false)
      navigate(`/session/${newSession.id}`)
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Navigation & Back Button */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            if (targetSessionId) {
              navigate(`/session/${targetSessionId}`)
            } else {
              navigate(-1)
            }
          }}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-700 dark:text-[#e5e5e5] hover:text-amber-600 dark:hover:text-amber-400 bg-neutral-200/80 hover:bg-neutral-300 dark:bg-[#1a1a1a] dark:hover:bg-[#252525] border border-neutral-300 dark:border-[#282828] px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
        >
          ← {targetSession ? `Back to ${targetSession.name}` : 'Back'}
        </button>
        {targetSession && (
          <span className="text-xs text-neutral-500 dark:text-[#999999]">
            Adding to setlist: <strong className="text-neutral-900 dark:text-[#e5e5e5]">{targetSession.name}</strong>
          </span>
        )}
      </div>

      <div className="bg-white dark:bg-[#1a1a1a] border border-neutral-200 dark:border-[#282828] rounded-xl p-5 shadow-xs">
        <div className="flex gap-2 border-b border-neutral-200 dark:border-[#282828] pb-3 mb-4">
          <button
            type="button"
            onClick={() => setMode('search')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              mode === 'search'
                ? 'bg-amber-500 text-black shadow-xs'
                : 'bg-neutral-100 dark:bg-[#101010] text-neutral-600 dark:text-[#999999] hover:text-neutral-900 dark:hover:text-[#e5e5e5]'
            }`}
          >
            🔍 Search Chords
          </button>
          <button
            type="button"
            onClick={() => setMode('paste')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              mode === 'paste'
                ? 'bg-amber-500 text-black shadow-xs'
                : 'bg-neutral-100 dark:bg-[#101010] text-neutral-600 dark:text-[#999999] hover:text-neutral-900 dark:hover:text-[#e5e5e5]'
            }`}
          >
            🔗 Paste Link(s)
          </button>
        </div>

        {mode === 'search' ? (
          <div>
            <h2 className="text-xl font-bold mb-1 text-neutral-900 dark:text-[#e5e5e5]">Search Chords & Lyrics</h2>
            <p className="text-sm text-neutral-600 dark:text-[#999999] mb-4">
              Find chord sheets across Ultimate Guitar, PNW Chords, and Worship Together.
            </p>

            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. Goodness of God, Hallelujah, Holy Forever..."
                className="flex-1 bg-neutral-50 dark:bg-[#101010] border border-neutral-300 dark:border-[#282828] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500 font-sans text-neutral-900 dark:text-[#e5e5e5] placeholder:text-neutral-400 dark:placeholder:text-[#666666]"
              />
              <button
                type="submit"
                disabled={isSearching || !query.trim()}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-neutral-200 disabled:text-neutral-400 dark:disabled:bg-[#282828] dark:disabled:text-[#666666] font-semibold text-black rounded-lg transition-colors cursor-pointer text-sm"
              >
                {isSearching ? 'Searching...' : 'Search'}
              </button>
            </form>

            {error && (
              <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/80 rounded text-red-700 dark:text-red-200 text-xs">
                {error}
              </div>
            )}
          </div>
        ) : (
          <div>
            <h2 className="text-xl font-bold mb-1 text-neutral-900 dark:text-[#e5e5e5]">Paste Chord Sheet Link(s)</h2>
            <p className="text-sm text-neutral-600 dark:text-[#999999] mb-4">
              Paste one or more chord sheet URLs (Ultimate Guitar, PNW Chords, Worship Chords, Worship Together).
            </p>

            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              disabled={isProcessingPaste}
              placeholder="https://tabs.ultimate-guitar.com/...&#10;https://pnwchords.com/..."
              rows={4}
              className="w-full bg-neutral-50 dark:bg-[#101010] border border-neutral-300 dark:border-[#282828] rounded-lg p-3 text-sm focus:outline-none focus:border-amber-500 font-mono resize-y text-neutral-900 dark:text-[#e5e5e5] placeholder:text-neutral-400 dark:placeholder:text-[#666666]"
            />

            {pasteError && (
              <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/80 rounded text-red-700 dark:text-red-200 text-xs">
                {pasteError}
              </div>
            )}

            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-neutral-500 dark:text-[#999999]">
                {splitUrls(pasteText).length} link(s) entered
              </span>
              <button
                type="button"
                onClick={handlePasteExtract}
                disabled={isProcessingPaste || !pasteText.trim()}
                className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-neutral-200 disabled:text-neutral-400 dark:disabled:bg-[#282828] dark:disabled:text-[#666666] font-semibold text-black rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed text-xs"
              >
                {isProcessingPaste ? 'Extracting...' : targetSessionId ? '+ Add to Setlist' : 'Extract & Open'}
              </button>
            </div>

            {pasteStatuses.length > 0 && (
              <div className="mt-5 border-t border-neutral-200 dark:border-[#282828] pt-3 space-y-2">
                <h3 className="text-xs font-semibold text-neutral-600 dark:text-[#999999] uppercase tracking-wider">
                  Import Progress
                </h3>
                {pasteStatuses.map((s, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs py-1">
                    <span className="truncate max-w-[70%] font-mono text-neutral-700 dark:text-[#d4d4d4]">{s.url}</span>
                    <span
                      className={
                        s.status === 'done' || s.status === 'cached'
                          ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                          : s.status === 'error'
                            ? 'text-red-600 dark:text-red-400 font-medium'
                            : 'text-amber-600 dark:text-amber-400 animate-pulse'
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
        )}
      </div>

      {/* Results (Only shown in search mode) */}
      {mode === 'search' && (
        <>
          {isSearching ? (
            <div className="py-12 text-center text-xs text-neutral-500 dark:text-[#999999] animate-pulse">
              Searching supported chord sites...
            </div>
          ) : results.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-xs uppercase tracking-wider font-semibold text-neutral-600 dark:text-[#999999]">
                Search Results ({results.length})
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {results.map((item, idx) => (
                  <div
                    key={idx}
                    className="bg-white dark:bg-[#1a1a1a] border border-neutral-200 dark:border-[#282828] rounded-xl p-4 flex flex-col justify-between hover:border-neutral-300 dark:hover:border-[#383838] transition-colors shadow-xs"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-bold text-neutral-900 dark:text-[#e5e5e5] text-sm leading-snug">{item.title}</h4>
                        <span className="text-[10px] bg-neutral-100 dark:bg-[#282828] text-neutral-600 dark:text-[#999999] px-2 py-0.5 rounded uppercase font-medium">
                          {item.site}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-600 dark:text-[#999999] mt-0.5">{item.artist}</p>

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
                        onClick={() => handleAddCandidate(item)}
                        disabled={addingUrls.has(item.url) || addedUrls.has(item.url)}
                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:bg-neutral-200 disabled:text-neutral-400 dark:disabled:bg-[#282828] dark:disabled:text-[#666666] text-black text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                      >
                        {addedUrls.has(item.url)
                          ? 'Added ✓'
                          : addingUrls.has(item.url)
                            ? 'Adding...'
                            : targetSessionId
                              ? '+ Add to Setlist'
                              : 'Extract & View'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : hasSearched ? (
            <div className="py-12 text-center text-sm text-neutral-500 dark:text-[#999999] italic">
              No matching songs found. Try a different query or paste links above.
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
