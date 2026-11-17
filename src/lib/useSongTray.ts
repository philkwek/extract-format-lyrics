import { useCallback, useMemo, useState } from 'react'
import type { SearchCandidate } from './api'
import { trackSongImport } from './analytics'
import { importSources, sourceFromCandidate, type ImportProgress } from './setlistImport'
import { SET_LINK_MAX_SONGS } from './setLinkSync'
import { usePendingRemoval } from './usePendingRemoval'
import type { Session } from './sessionStore'

export const TRAY_MAX_SONGS = SET_LINK_MAX_SONGS

export function useSongTray() {
  // `stored` still holds a song that is waiting out its undo window; `items` hides it.
  const [stored, setStored] = useState<SearchCandidate[]>([])
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set())
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dropStored = useCallback((url: string) => {
    setStored((prev) => prev.filter((item) => item.url !== url))
    setFailedUrls((prev) => {
      if (!prev.has(url)) return prev
      const next = new Set(prev)
      next.delete(url)
      return next
    })
  }, [])

  const {
    pending,
    start: startRemoval,
    undo: undoRemoval,
  } = usePendingRemoval<SearchCandidate>({ onCommit: (candidate) => dropStored(candidate.url) })

  const items = useMemo(
    () => (pending ? stored.filter((item) => item.url !== pending.url) : stored),
    [stored, pending],
  )
  const urls = useMemo(() => new Set(items.map((item) => item.url)), [items])
  const isFull = items.length >= TRAY_MAX_SONGS

  const add = useCallback(
    (candidate: SearchCandidate) => {
      // Picking the song that was just removed is the same as pressing Undo.
      if (pending?.url === candidate.url) {
        undoRemoval()
        return
      }
      setStored((prev) => {
        const shown = pending ? prev.filter((item) => item.url !== pending.url) : prev
        return shown.length >= TRAY_MAX_SONGS || prev.some((item) => item.url === candidate.url)
          ? prev
          : [...prev, candidate]
      })
    },
    [pending, undoRemoval],
  )

  const remove = useCallback(
    (url: string) => {
      const candidate = stored.find((item) => item.url === url)
      if (candidate) startRemoval(candidate)
    },
    [stored, startRemoval],
  )

  // Any reorder makes the pending removal final: the order is built from what is on screen.
  const settleOrder = useCallback(
    (next: SearchCandidate[]) => {
      setStored(next)
      if (pending) {
        undoRemoval()
        setFailedUrls((prev) => {
          if (!prev.has(pending.url)) return prev
          const copy = new Set(prev)
          copy.delete(pending.url)
          return copy
        })
      }
    },
    [pending, undoRemoval],
  )

  const move = useCallback(
    (from: number, to: number) => {
      if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return
      const next = [...items]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      settleOrder(next)
    },
    [items, settleOrder],
  )

  /** Takes the order from a drag, but only if it holds exactly the songs on screen. */
  const setOrder = useCallback(
    (next: SearchCandidate[]) => {
      if (
        next.length === items.length &&
        next.every((item) => items.some((p) => p.url === item.url))
      ) {
        settleOrder(next)
      }
    },
    [items, settleOrder],
  )

  const undoNote = useMemo(
    () => (pending ? { text: 'Song removed', action: { label: 'Undo', run: undoRemoval } } : null),
    [pending, undoRemoval],
  )

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

  return {
    items,
    urls,
    isFull,
    failedUrls,
    isCreating,
    error,
    add,
    remove,
    move,
    setOrder,
    create,
    undoNote,
    undoKey: pending?.url,
  }
}
