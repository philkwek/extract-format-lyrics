import { PAD_URLS } from './padKeys'
import { isStandalone } from './standalone'

interface PadPrefetchInput {
  standalone: boolean
  online: boolean
  saveData: boolean
}

/** Only the installed app downloads the pads, and never on a metered connection. */
export function shouldPrefetchPads({ standalone, online, saveData }: PadPrefetchInput): boolean {
  return standalone && online && !saveData
}

/**
 * Asks the worker to keep all 12 pads. It is a one-time download: the worker skips files it
 * already holds, so a closed tab resumes on the next launch.
 */
export async function prefetchPads(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } }
  if (
    !shouldPrefetchPads({
      standalone: isStandalone(window),
      online: nav.onLine,
      saveData: Boolean(nav.connection?.saveData),
    })
  ) {
    return
  }
  try {
    const registration = await nav.serviceWorker.ready
    registration.active?.postMessage({ type: 'WARM_PADS', urls: PAD_URLS })
  } catch {
    // No active worker yet; the next launch tries again.
  }
}
