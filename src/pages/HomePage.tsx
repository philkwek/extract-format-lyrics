import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { splitUrls, validateUrls } from '../../functions/src/urls'
import { songCache } from '../lib/songCache'
import { scrapeApi } from '../lib/api'
import { sessionStore, type Session, type SessionSongItem } from '../lib/sessionStore'

interface ImportStatus {
  url: string
  status: 'pending' | 'cached' | 'fetching' | 'done' | 'error'
  message?: string
}

export default function HomePage() {
  const navigate = useNavigate()
  const [inputText, setInputText] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [statuses, setStatuses] = useState<ImportStatus[]>([])
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])

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

  return (
    <div className="space-y-8">
      {/* Paste & Import Form */}
      <section className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 shadow-xs">
        <h2 className="text-xl font-bold mb-1 text-neutral-900 dark:text-neutral-100">New Song Session</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
          Paste one or more chord sheet URLs (Ultimate Guitar, PNW Chords, Worship Chords, Worship Together).
        </p>

        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={isProcessing}
          placeholder="https://tabs.ultimate-guitar.com/...&#10;https://pnwchords.com/..."
          rows={5}
          className="w-full bg-neutral-50 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 rounded-lg p-3 text-sm focus:outline-none focus:border-amber-500 font-mono resize-y text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400"
        />

        {generalError && (
          <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/80 rounded text-red-700 dark:text-red-200 text-sm">
            {generalError}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {splitUrls(inputText).length} link(s) entered
          </span>
          <button
            onClick={handleExtract}
            disabled={isProcessing || !inputText.trim()}
            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-neutral-200 disabled:text-neutral-400 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-600 font-semibold text-black rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed text-sm"
          >
            {isProcessing ? 'Extracting Songs...' : 'Extract & Open Session'}
          </button>
        </div>

        {statuses.length > 0 && (
          <div className="mt-6 border-t border-neutral-200 dark:border-neutral-800 pt-4 space-y-2">
            <h3 className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 uppercase tracking-wider">
              Import Progress
            </h3>
            {statuses.map((s, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs py-1">
                <span className="truncate max-w-[70%] font-mono text-neutral-700 dark:text-neutral-300">{s.url}</span>
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
      </section>

      {/* Recent Sessions */}
      <section className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">Recent Sessions</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Stored locally in your browser.</p>
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
          <p className="text-sm text-neutral-500 dark:text-neutral-400 py-3 italic">
            No saved sessions yet. Paste links above to start one!
          </p>
        ) : (
          <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => navigate(`/session/${session.id}`)}
                className="py-3 flex items-center justify-between hover:bg-neutral-100 dark:hover:bg-neutral-800/40 px-2 rounded -mx-2 transition-colors cursor-pointer group"
              >
                <div className="flex-1 mr-2">
                  <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                    {session.name}
                  </h3>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {session.songs.length} song(s) · {new Date(session.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="flex items-center gap-1">
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
                    className="text-xs text-neutral-400 hover:text-amber-500 dark:text-neutral-500 dark:hover:text-amber-400 p-2 transition-colors cursor-pointer"
                  >
                    ✎
                  </button>
                  <button
                    onClick={(e) => handleDeleteSession(session.id, e)}
                    title="Delete session"
                    className="text-xs text-neutral-400 hover:text-red-500 dark:text-neutral-500 dark:hover:text-red-400 p-2 transition-colors cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
