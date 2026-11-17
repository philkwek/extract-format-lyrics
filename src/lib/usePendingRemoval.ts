import { useCallback, useEffect, useRef, useState } from 'react'

export const UNDO_WINDOW_MS = 5000

interface Options<T> {
  onCommit: (payload: T) => void | Promise<void>
  onError?: (payload: T) => void
}

interface PendingRemoval<T> {
  pending: T | null
  start: (payload: T) => void
  undo: () => void
}

/**
 * Hides one item for a short window, then commits its removal.
 * The item is never removed from stored state here; each screen subtracts `pending` at render.
 */
export function usePendingRemoval<T>({ onCommit, onError }: Options<T>): PendingRemoval<T> {
  const [pending, setPending] = useState<T | null>(null)
  const pendingRef = useRef<T | null>(null)
  const expiryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitRef = useRef(onCommit)
  const errorRef = useRef(onError)

  useEffect(() => {
    commitRef.current = onCommit
    errorRef.current = onError
  })

  const clearExpiry = useCallback(() => {
    if (expiryRef.current !== null) {
      clearTimeout(expiryRef.current)
      expiryRef.current = null
    }
  }, [])

  const settle = useCallback(async (payload: T) => {
    try {
      await commitRef.current(payload)
    } catch {
      errorRef.current?.(payload)
    }
  }, [])

  const release = useCallback(() => {
    pendingRef.current = null
    setPending(null)
  }, [])

  const start = useCallback(
    (payload: T) => {
      clearExpiry()
      const previous = pendingRef.current
      pendingRef.current = payload
      setPending(payload)
      if (previous !== null) void settle(previous)
      expiryRef.current = setTimeout(() => {
        expiryRef.current = null
        release()
        void settle(payload)
      }, UNDO_WINDOW_MS)
    },
    [clearExpiry, release, settle],
  )

  const undo = useCallback(() => {
    clearExpiry()
    release()
  }, [clearExpiry, release])

  // A real unmount was never awaited, so commit from a 0 ms timer that a StrictMode
  // remount can cancel before it runs.
  useEffect(() => {
    if (flushRef.current !== null) {
      clearTimeout(flushRef.current)
      flushRef.current = null
    }
    return () => {
      clearExpiry()
      flushRef.current = setTimeout(() => {
        flushRef.current = null
        const payload = pendingRef.current
        if (payload !== null) {
          pendingRef.current = null
          void settle(payload)
        }
      }, 0)
    }
  }, [clearExpiry, settle])

  return { pending, start, undo }
}
