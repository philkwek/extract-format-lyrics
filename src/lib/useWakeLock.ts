import { useEffect } from 'react'

/** Keeps the screen awake while `enabled`; browsers drop the lock when the tab hides. */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return

    let cancelled = false
    let pending = false
    let sentinel: WakeLockSentinel | null = null

    const request = async () => {
      if (pending || cancelled) return
      pending = true
      try {
        const next = await navigator.wakeLock.request('screen')
        if (cancelled) {
          void next.release().catch(() => {})
          return
        }
        sentinel = next
      } catch {
        // Refused on battery saver or without user intent; the set still works.
      } finally {
        pending = false
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      if (sentinel && !sentinel.released) return
      sentinel = null
      void request()
    }

    void request()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => {})
      sentinel = null
    }
  }, [enabled])
}
