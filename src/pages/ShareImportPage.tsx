import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { decodeSharePayload, parseHashPayload } from '../lib/shareLink'
import { getShortLinkApi, scrapeApi } from '../lib/api'
import { sessionStore, type SessionSongItem } from '../lib/sessionStore'
import { songCache } from '../lib/songCache'
import { getSongPrefs, saveSongPrefs } from '../lib/songPrefs'
import type { SharePayload } from '../types/song'

export default function ShareImportPage() {
  const { shortId } = useParams<{ shortId?: string }>()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [progressMsg, setProgressMsg] = useState('Reading share payload...')

  useEffect(() => {
    let isCancelled = false

    async function loadAndImport() {
      try {
        let payload: SharePayload | null = null

        // 1. If shortId provided in route (/s/:shortId), fetch from backend shortlink store
        if (shortId) {
          setProgressMsg('Retrieving setlist link...')
          try {
            payload = await getShortLinkApi(shortId)
          } catch (fetchErr) {
            // Check if fallback payload is present in the hash fragment
            const fallbackStr = parseHashPayload(window.location.hash)
            if (fallbackStr) {
              payload = decodeSharePayload(fallbackStr)
            }
            if (!payload) {
              throw fetchErr
            }
          }
        } else {
          // 2. Otherwise read from hash fragment (#... or #share=...)
          const shareStr = parseHashPayload(window.location.hash)

          if (!shareStr) {
            throw new Error('No setlist data found in share link.')
          }

          payload = decodeSharePayload(shareStr)
        }

        if (!payload || !payload.name || !Array.isArray(payload.songs) || payload.songs.length === 0) {
          throw new Error('Invalid or corrupted setlist data in link.')
        }

        if (isCancelled) return

        setProgressMsg(`Importing "${payload.name}" (${payload.songs.length} song(s))...`)

        const sessionSongs: SessionSongItem[] = []
        const uncachedUrls: string[] = []

        // Check local cache
        for (const item of payload.songs) {
          const cached = await songCache.getSong(item.url)
          if (cached) {
            sessionSongs.push({
              url: item.url,
              title: item.title || cached.title,
              artist: item.artist || cached.artist,
              status: 'ok',
              customSections: item.customSections,
              customSimplifiedSections: item.customSimplifiedSections,
            })
            // Save prefs like simplified
            if (item.simplified !== undefined) {
              const current = getSongPrefs(cached.id)
              saveSongPrefs(cached.id, { ...current, simplified: item.simplified })
            }
          } else {
            uncachedUrls.push(item.url)
          }
        }

        // Scrape remaining uncached songs in chunks
        const CHUNK_SIZE = 5
        for (let i = 0; i < uncachedUrls.length; i += CHUNK_SIZE) {
          const chunk = uncachedUrls.slice(i, i + CHUNK_SIZE)
          setProgressMsg(`Extracting chord sheets (${i + 1}/${uncachedUrls.length})...`)

          try {
            const res = await scrapeApi(chunk)
            for (const r of res.results) {
              const matchedPayloadSong = payload.songs.find((s) => s.url === r.url)
              if (r.status === 'ok' && r.song) {
                await songCache.saveSong(r.song)
                sessionSongs.push({
                  url: r.url,
                  title: matchedPayloadSong?.title || r.song.title,
                  artist: matchedPayloadSong?.artist || r.song.artist,
                  status: 'ok',
                  customSections: matchedPayloadSong?.customSections,
                  customSimplifiedSections: matchedPayloadSong?.customSimplifiedSections,
                })
                if (matchedPayloadSong?.simplified !== undefined) {
                  const current = getSongPrefs(r.song.id)
                  saveSongPrefs(r.song.id, { ...current, simplified: matchedPayloadSong.simplified })
                }
              } else {
                sessionSongs.push({
                  url: r.url,
                  title: matchedPayloadSong?.title,
                  artist: matchedPayloadSong?.artist,
                  status: 'error',
                  errorMessage: r.message || 'Scrape failed',
                })
              }
            }
          } catch (err) {
            for (const u of chunk) {
              const matchedPayloadSong = payload.songs.find((s) => s.url === u)
              sessionSongs.push({
                url: u,
                title: matchedPayloadSong?.title,
                artist: matchedPayloadSong?.artist,
                status: 'error',
                errorMessage: (err as Error).message || 'Network error',
              })
            }
          }
        }

        if (isCancelled) return

        // Create new session in local IndexedDB
        const newSession = await sessionStore.createSession(sessionSongs, `${payload.name} (Shared)`)

        // Navigate to imported session
        navigate(`/session/${newSession.id}`, { replace: true })
      } catch (err) {
        if (!isCancelled) {
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
      ) : (
        <div className="bg-white dark:bg-[#1a1a1a] border border-red-200 dark:border-red-900/40 rounded-xl p-8 space-y-4 shadow-xs">
          <div className="text-3xl">⚠️</div>
          <h2 className="text-lg font-bold text-red-600 dark:text-red-400">Could Not Import Setlist</h2>
          <p className="text-xs text-neutral-600 dark:text-[#999999]">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Return to Home
          </button>
        </div>
      )}
    </div>
  )
}
