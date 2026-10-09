import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { searchApi, type SearchCandidate, scrapeApi } from '../lib/api'
import { songCache } from '../lib/songCache'
import { sessionStore } from '../lib/sessionStore'

export default function SearchPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const targetSessionId = searchParams.get('session')

  const [query, setQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState<SearchCandidate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set())
  const [addingUrls, setAddingUrls] = useState<Set<string>>(new Set())

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
      const songItem = {
        url: candidate.url,
        title: candidate.title,
        artist: candidate.artist,
        status: 'ok' as const,
      }

      let activeSessionId = targetSessionId
      if (activeSessionId) {
        await sessionStore.addSongToSession(activeSessionId, songItem)
      } else {
        const newSession = await sessionStore.createSession([songItem])
        activeSessionId = newSession.id
      }

      setAddedUrls((prev) => new Set(prev).add(candidate.url))
      // Navigate to the session after brief feedback
      navigate(`/session/${activeSessionId}`)
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

  return (
    <div className="space-y-6">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 shadow-sm">
        <h2 className="text-xl font-bold mb-1">Search Chords & Lyrics</h2>
        <p className="text-sm text-neutral-400 mb-4">
          Find chord sheets across Ultimate Guitar, PNW Chords, and Worship Together.
        </p>

        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Goodness of God, Hallelujah, Holy Forever..."
            className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500 font-sans"
          />
          <button
            type="submit"
            disabled={isSearching || !query.trim()}
            className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-neutral-800 disabled:text-neutral-600 font-semibold text-black rounded-lg transition-colors cursor-pointer text-sm"
          >
            {isSearching ? 'Searching...' : 'Search'}
          </button>
        </form>

        {error && (
          <div className="mt-3 p-3 bg-red-950/40 border border-red-800/80 rounded text-red-200 text-xs">
            {error}
          </div>
        )}
      </div>

      {/* Results */}
      {isSearching ? (
        <div className="py-12 text-center text-xs text-neutral-400 animate-pulse">
          Searching supported chord sites...
        </div>
      ) : results.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-xs uppercase tracking-wider font-semibold text-neutral-400">
            Search Results ({results.length})
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {results.map((item, idx) => (
              <div
                key={idx}
                className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col justify-between hover:border-neutral-700 transition-colors"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-bold text-neutral-100 text-sm leading-snug">{item.title}</h4>
                    <span className="text-[10px] bg-neutral-800 text-neutral-400 px-2 py-0.5 rounded uppercase font-medium">
                      {item.site}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-400 mt-0.5">{item.artist}</p>

                  <div className="flex items-center gap-2 mt-2 text-[11px] text-neutral-500">
                    {item.versionLabel && <span>{item.versionLabel}</span>}
                    {item.rating && <span>★ {item.rating.toFixed(1)}</span>}
                    {item.type && <span>• {item.type}</span>}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-neutral-800/80 flex items-center justify-between">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-neutral-500 hover:text-neutral-300 underline"
                  >
                    View source ↗
                  </a>
                  <button
                    onClick={() => handleAddCandidate(item)}
                    disabled={addingUrls.has(item.url) || addedUrls.has(item.url)}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:bg-neutral-800 disabled:text-neutral-400 text-black text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    {addedUrls.has(item.url)
                      ? 'Added ✓'
                      : addingUrls.has(item.url)
                        ? 'Adding...'
                        : '+ Add to Setlist'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : hasSearched ? (
        <div className="py-12 text-center text-sm text-neutral-500 italic">
          No matching songs found. Try a different query or paste links on the home page.
        </div>
      ) : null}
    </div>
  )
}
