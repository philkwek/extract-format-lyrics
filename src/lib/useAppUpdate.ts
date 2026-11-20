import { useCallback, useEffect, useRef, useState } from 'react'
import { APP_BUILD_ID, fetchLatestBuildId, hasNewBuild } from './appUpdate'

/** The first check waits for the page to settle, then runs hourly while visible. */
const FIRST_CHECK_MS = 30_000
const CHECK_EVERY_MS = 60 * 60 * 1000
/** Coming back to the tab should not hammer the server. */
const MIN_GAP_MS = 60_000

/**
 * Notices a deploy while the app is still open, which installed apps and background tabs
 * often are. It only reports; reloading is always the person's choice.
 */
export function useAppUpdate(enabled = !import.meta.env.DEV) {
  const [found, setFound] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const lastCheck = useRef(0)
  const busy = useRef(false)

  const check = useCallback(async () => {
    if (busy.current) return
    if (lastCheck.current && Date.now() - lastCheck.current < MIN_GAP_MS) return
    busy.current = true
    lastCheck.current = Date.now()
    try {
      // A failed or missing version file must not take back a prompt already shown.
      if (hasNewBuild(APP_BUILD_ID, await fetchLatestBuildId())) setFound(true)
    } finally {
      busy.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled || found) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    const first = setTimeout(() => void check(), FIRST_CHECK_MS)
    const timer = setInterval(onVisible, CHECK_EVERY_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [check, enabled, found])

  const reload = useCallback(() => window.location.reload(), [])
  const dismiss = useCallback(() => setDismissed(true), [])

  return { updateAvailable: found && !dismissed, reload, dismiss }
}
