import { trackEvent } from '../lib/analytics'
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AlertTriangle, Clock3, DownloadCloud } from 'lucide-react'
import { getShareApi, ShareApiError } from '../lib/api'
import { sessionStore } from '../lib/sessionStore'
import { songCache } from '../lib/songCache'
import { sessionSongsFromSnapshot } from '../lib/shareSnapshot'
import { Button, Surface } from '../components/ui'

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

        if (isCancelled) return
        trackEvent('shared_set_imported', { outcome: 'success', imported_count: sessionSongs.length })

        // Navigate to imported session
        navigate(`/session/${newSession.id}`, { replace: true })
      } catch (err) {
        if (!isCancelled) {
          trackEvent('shared_set_imported', { outcome: 'error', imported_count: 0 })
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
    <div className="mx-auto max-w-lg py-16 text-center">
      {loading ? (
        <Surface elevated className="space-y-4 p-8">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#3368A0]/10 text-[#3368A0] dark:bg-amber-400/10 dark:text-amber-400">
            <DownloadCloud className="animate-pulse" size={23} />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-[-0.025em] text-[var(--ui-text)]">Bringing in the shared setlist</h1>
            <p className="mt-2 text-sm text-[var(--ui-text-muted)]" role="status">{progressMsg}</p>
          </div>
          <div className="mx-auto h-1.5 max-w-48 overflow-hidden rounded-full bg-[#3368A0]/10 dark:bg-amber-400/10">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-[#3368A0] dark:bg-amber-400" />
          </div>
        </Surface>
      ) : expired ? (
        <Surface elevated className="space-y-4 p-8">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-400"><Clock3 size={23} /></span>
          <div>
            <h1 className="text-xl font-bold tracking-[-0.025em] text-[var(--ui-text)]">This sharing link has expired</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--ui-text-muted)]">Ask the sender to create a fresh link, then open it here again.</p>
          </div>
          <Button variant="primary" onClick={() => navigate('/')}>Return home</Button>
        </Surface>
      ) : (
        <Surface elevated className="space-y-4 p-8">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400"><AlertTriangle size={23} /></span>
          <div>
            <h1 className="text-xl font-bold tracking-[-0.025em] text-[var(--ui-text)]">Could not import the setlist</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--ui-text-muted)]">{error}</p>
          </div>
          <Button variant="primary" onClick={() => navigate('/')}>Return home</Button>
        </Surface>
      )}
    </div>
  )
}
