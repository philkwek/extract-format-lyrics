import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getShareApi, ShareApiError } from '../lib/api'
import { sessionStore } from '../lib/sessionStore'
import { songCache } from '../lib/songCache'
import { sessionSongsFromSnapshot } from '../lib/shareSnapshot'

export default function ShareImportPage() {
  const { shortId } = useParams<{ shortId?: string }>()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [progressMsg, setProgressMsg] = useState('Reading share payload...')

  useEffect(() => {
    let isCancelled = false

    async function loadAndImport() {
      try {
        if (!shortId) throw new Error('This sharing link is unavailable.')
        setProgressMsg('Retrieving shared setlist...')
        const snapshot = await getShareApi(shortId)

        if (isCancelled) return

        setProgressMsg(`Importing "${snapshot.name}" (${snapshot.songs.length} song(s))...`)
        for (const entry of snapshot.songs) await songCache.saveSong(entry.song)
        const sessionSongs = sessionSongsFromSnapshot(snapshot)

        if (isCancelled) return

        // Create new session in local IndexedDB
        const newSession = await sessionStore.createSession(sessionSongs, snapshot.name)

        // Navigate to imported session
        navigate(`/session/${newSession.id}`, { replace: true })
      } catch (err) {
        if (!isCancelled) {
          if (err instanceof ShareApiError && err.code === 'EXPIRED') setExpired(true)
          setError((err as Error).message || 'Failed to load shared setlist')
          setLoading(false)
        }
      }
    }

    loadAndImport()

    return () => {
      isCancelled = true
    }
  }, [shortId, navigate])

  return (
    <div className="py-16 max-w-lg mx-auto text-center space-y-4">
      {loading ? (
        <div className="bg-white dark:bg-[#1a1a1a] border border-neutral-200 dark:border-[#282828] rounded-xl p-8 space-y-3 shadow-xs">
          <div className="text-3xl animate-spin inline-block">⏳</div>
          <h2 className="text-lg font-bold text-neutral-900 dark:text-[#e5e5e5]">Loading Shared Setlist</h2>
          <p className="text-xs text-neutral-600 dark:text-[#999999]">{progressMsg}</p>
        </div>
      ) : expired ? (
        <div className="bg-white dark:bg-[#1a1a1a] border border-amber-200 dark:border-amber-900/40 rounded-xl p-8 space-y-4 shadow-xs">
          <div className="text-3xl">⌛</div>
          <h2 className="text-lg font-bold text-amber-700 dark:text-amber-400">Sharing Link Expired</h2>
          <p className="text-xs text-neutral-600 dark:text-[#999999]">This sharing link has expired. Ask the sender to create a new one.</p>
          <button onClick={() => navigate('/')} className="px-4 py-2 bg-[#3368A0] hover:bg-[#255283] text-white dark:bg-amber-500 dark:text-black text-xs font-semibold rounded-lg transition-colors cursor-pointer">Return to Home</button>
        </div>
      ) : (
        <div className="bg-white dark:bg-[#1a1a1a] border border-red-200 dark:border-red-900/40 rounded-xl p-8 space-y-4 shadow-xs">
          <div className="text-3xl">⚠️</div>
          <h2 className="text-lg font-bold text-red-600 dark:text-red-400">Could Not Import Setlist</h2>
          <p className="text-xs text-neutral-600 dark:text-[#999999]">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-[#3368A0] hover:bg-[#255283] text-white dark:bg-amber-500 dark:hover:bg-amber-600 dark:text-black text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Return to Home
          </button>
        </div>
      )}
    </div>
  )
}
