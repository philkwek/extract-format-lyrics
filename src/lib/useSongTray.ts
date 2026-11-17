import { useCallback, useMemo, useState } from 'react'
import type { SearchCandidate } from './api'
import { trackSongImport } from './analytics'
import { importSources, sourceFromCandidate, type ImportProgress } from './setlistImport'
import { SET_LINK_MAX_SONGS } from './setLinkSync'
import type { Session } from './sessionStore'

export const TRAY_MAX_SONGS = SET_LINK_MAX_SONGS

export function useSongTray() {
  const [items, setItems] = useState<SearchCandidate[]>([])
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set())
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const urls = useMemo(() => new Set(items.map((item) => item.url)), [items])
  const isFull = items.length >= TRAY_MAX_SONGS

  const add = useCallback((candidate: SearchCandidate) => {
    setItems((prev) =>
      prev.length >= TRAY_MAX_SONGS || prev.some((item) => item.url === candidate.url)
        ? prev
        : [...prev, candidate],
    )
  }, [])

  const remove = useCallback((url: string) => {
    setItems((prev) => prev.filter((item) => item.url !== url))
    setFailedUrls((prev) => {
      if (!prev.has(url)) return prev
      const next = new Set(prev)
      next.delete(url)
      return next
    })
  }, [])

  const move = useCallback((from: number, to: number) => {
    setItems((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }, [])

  /** Imports every picked song into one new set. Returns the set, or null if it failed. */
  const create = useCallback(async (): Promise<Session | null> => {
    if (items.length === 0 || isCreating) return null
    setIsCreating(true)
    setError(null)
    setFailedUrls(new Set())
    let latest: ImportProgress[] = []
    try {
      const result = await importSources(items.map(sourceFromCandidate), {
        requireAll: true,
        onProgress: (statuses) => {
          latest = statuses
        },
      })
      trackSongImport('search', result.imported, items.length)
      return result.session
    } catch (err) {
      trackSongImport('search', 0, items.length)
      setFailedUrls(
        new Set(latest.filter((status) => status.status === 'error').map((status) => status.url)),
      )
      setError((err as Error).message || 'Could not create the set')
      return null
    } finally {
      setIsCreating(false)
    }
  }, [items, isCreating])

  return { items, urls, isFull, failedUrls, isCreating, error, add, remove, move, create }
}
