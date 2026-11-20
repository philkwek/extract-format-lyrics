import { useCallback, useEffect, useRef, useState } from 'react'
import { APP_BUILD_ID, fetchLatestBuildId, hasNewBuild } from './appUpdate'
import {
  registerServiceWorker,
  serviceWorkerResetRequested,
  type ServiceWorkerClient,
} from './serviceWorker'

/** The first check waits for the page to settle, then runs hourly while visible. */
const FIRST_CHECK_MS = 30_000
const CHECK_EVERY_MS = 60 * 60 * 1000
/** Coming back to the tab should not hammer the server. */
const MIN_GAP_MS = 60_000

/**
 * Reports that a newer build is deployed. The waiting service worker is the main source; an
 * open page with a broken registration falls back to the build stamp in /version.json. It only
 * reports; reloading is always the person's choice.
 */
export function useAppUpdate(enabled = !import.meta.env.DEV) {
  const [found, setFound] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const client = useRef<ServiceWorkerClient | null>(null)
  const lastCheck = useRef(0)

  useEffect(() => {
    if (!enabled || serviceWorkerResetRequested(window.location.search)) return
    client.current = registerServiceWorker({ onNeedRefresh: () => setFound(true) })
    return () => {
      client.current = null
    }
  }, [enabled])

  const check = useCallback(async () => {
    if (hasNewBuild(APP_BUILD_ID, await fetchLatestBuildId())) setFound(true)
  }, [])

  useEffect(() => {
    if (!enabled || found) return
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      if (lastCheck.current && Date.now() - lastCheck.current < MIN_GAP_MS) return
      lastCheck.current = Date.now()
      if (client.current?.registration) client.current.check()
      else void check()
    }
    const first = setTimeout(tick, FIRST_CHECK_MS)
    const timer = setInterval(tick, CHECK_EVERY_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [check, enabled, found])

  const reload = useCallback(() => {
    if (client.current) client.current.update()
    else window.location.reload()
  }, [])
  const dismiss = useCallback(() => setDismissed(true), [])

  return { updateAvailable: found && !dismissed, reload, dismiss }
}
