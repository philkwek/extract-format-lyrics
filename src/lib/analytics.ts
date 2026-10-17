import type { Analytics } from 'firebase/analytics'

type Outcome = 'success' | 'partial' | 'error'
type ImportMethod = 'search' | 'pasted_link' | 'upload'
interface Events {
  song_search: { entry_page: 'home' | 'search'; outcome: 'success' | 'error'; result_count: number }
  song_import: { method: ImportMethod; outcome: Outcome; imported_count: number }
  set_shared: { song_count: number }
  shared_set_imported: { outcome: 'success' | 'error'; imported_count: number }
  lyrics_published: {
    operation: 'create' | 'update'
    outcome: 'success' | 'error'
    song_count: number
  }
}

const preferenceKey = 'usage-tracking-disabled'
const titles: Record<string, string> = {
  '/': 'Library',
  '/search': 'Find songs',
  '/session': 'Setlist',
  '/s': 'Import shared set',
  '/lyrics': 'Shared lyrics',
  '/privacy': 'Privacy',
  '/other': 'Other page',
}
const measurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || ''
let disabled = false
let generation = 0
let initialization: Promise<Analytics | null> | undefined
let sdk: typeof import('firebase/analytics') | undefined
let lastPage: string | undefined
let previousPage: string | undefined
let activeContext: ReturnType<typeof pageContext> | undefined

export function pageGroup(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0]
  if (pathname === '/') return '/'
  const group = `/${pathname.split('/')[1]}`
  return group in titles && group !== '/other' ? group : '/other'
}

export function trackingEnabled(): boolean {
  try {
    return !disabled && localStorage.getItem(preferenceKey) !== 'true'
  } catch {
    return !disabled
  }
}

function allowedEnvironment(): boolean {
  const hosts = (import.meta.env.VITE_ANALYTICS_HOSTNAMES || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean)
  return (
    import.meta.env.PROD &&
    import.meta.env.VITE_ANALYTICS_ENABLED === 'true' &&
    hosts.includes(window.location.hostname) &&
    /^G-[A-Z0-9]+$/.test(measurementId) &&
    !!import.meta.env.VITE_FIREBASE_API_KEY &&
    !!import.meta.env.VITE_FIREBASE_APP_ID &&
    !!import.meta.env.VITE_FIREBASE_PROJECT_ID
  )
}

function safeReferrer(raw: string): string {
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    return url.origin === window.location.origin
      ? `${url.origin}${pageGroup(url.pathname)}`
      : url.origin
  } catch {
    return ''
  }
}

function pageContext(path = window.location.pathname) {
  const group = pageGroup(path)
  return {
    page_location: `${window.location.origin}${group}`,
    page_title: titles[group],
    page_referrer: previousPage || safeReferrer(document.referrer),
  }
}

function googleWindow() {
  return window as unknown as Record<string, unknown> & { gtag?: (...args: unknown[]) => void }
}

function applyContext(context: ReturnType<typeof pageContext>) {
  // Config-level overrides protect automatic events too; global defaults alone
  // cannot override a value already set on the measurement destination.
  sdk?.setDefaultEventParameters(context)
  googleWindow().gtag?.('config', measurementId, {
    ...context,
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    update: true,
  })
}

async function getAnalytics(context = pageContext()): Promise<Analytics | null> {
  if (!trackingEnabled() || !allowedEnvironment()) return null
  if (!initialization) {
    initialization = (async () => {
      const analyticsSdk = await import('firebase/analytics')
      if (!(await analyticsSdk.isSupported()) || !trackingEnabled()) return null
      const { initializeApp, getApps } = await import('firebase/app')
      if (!trackingEnabled()) return null
      sdk = analyticsSdk
      sdk.setDefaultEventParameters(context)
      const app =
        getApps().find((app) => app.name === 'usage-analytics') ||
        initializeApp(
          {
            apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
            appId: import.meta.env.VITE_FIREBASE_APP_ID,
            projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
            measurementId,
          },
          'usage-analytics',
        )
      return sdk.initializeAnalytics(app, {
        config: {
          ...context,
          send_page_view: false,
          allow_google_signals: false,
          allow_ad_personalization_signals: false,
        },
      })
    })().catch(() => null)
  }
  const pending = initialization
  return pending.then((analytics) => {
    if (!analytics && initialization === pending) initialization = undefined
    return analytics
  })
}

function send(
  name: string,
  params: Record<string, string | number>,
  context = activeContext || pageContext(),
) {
  const version = generation
  if (!trackingEnabled()) return
  void getAnalytics(context)
    .then((analytics) => {
      if (!analytics || !trackingEnabled() || version !== generation) return
      try {
        sdk?.logEvent(analytics, name, { ...params, ...context })
      } catch {
        /* Analytics is optional. */
      }
    })
    .catch(() => {
      /* Analytics is optional. */
    })
}

// Runtime allowlists supplement TypeScript so extra properties never reach GA.
export function trackEvent<K extends keyof Events>(name: K, params: Events[K]): void {
  const clean: Record<string, string | number> = {}
  const enumerations: Record<string, readonly string[]> = {
    entry_page: ['home', 'search'],
    outcome: ['success', 'partial', 'error'],
    method: ['search', 'pasted_link', 'upload'],
    operation: ['create', 'update'],
  }
  const fields: Record<keyof Events, string[]> = {
    song_search: ['entry_page', 'outcome', 'result_count'],
    song_import: ['method', 'outcome', 'imported_count'],
    set_shared: ['song_count'],
    shared_set_imported: ['outcome', 'imported_count'],
    lyrics_published: ['operation', 'outcome', 'song_count'],
  }
  if (!Object.hasOwn(fields, name)) return
  for (const key of fields[name]) {
    const value = (params as Record<string, unknown>)[key]
    if (enumerations[key]) {
      if (typeof value !== 'string' || !enumerations[key].includes(value)) return
      clean[key] = value
    } else {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return
      clean[key] = value
    }
  }
  send(name, clean)
}

export function trackPage(path: string): void {
  const group = pageGroup(path)
  if (group === lastPage || !trackingEnabled()) return
  const context = pageContext(path)
  lastPage = group
  activeContext = context
  previousPage = context.page_location
  const version = generation
  void getAnalytics(context)
    .then((analytics) => {
      if (!analytics || !trackingEnabled() || version !== generation) return
      try {
        applyContext(context)
        sdk?.logEvent(analytics, 'page_view', context)
      } catch {
        /* Analytics is optional. */
      }
    })
    .catch(() => {})
}

export function setTrackingEnabled(enabled: boolean): void {
  disabled = !enabled
  generation++
  try {
    localStorage.setItem(preferenceKey, String(!enabled))
  } catch {
    /* Keep in memory when storage is blocked. */
  }
  googleWindow()[`ga-disable-${measurementId}`] = !enabled
  if (initialization) {
    void initialization
      .then((analytics) => {
        if (analytics) sdk?.setAnalyticsCollectionEnabled(analytics, trackingEnabled())
      })
      .catch(() => {})
  }
  lastPage = undefined
  previousPage = undefined
  activeContext = undefined
  if (enabled) trackPage(window.location.pathname)
  window.dispatchEvent(new Event('usage-tracking-changed'))
}

export function importOutcome(imported: number, attempted: number): Outcome {
  return imported === 0 ? 'error' : imported < attempted ? 'partial' : 'success'
}

export function trackSongImport(method: ImportMethod, imported: number, attempted: number): void {
  trackEvent('song_import', {
    method,
    outcome: importOutcome(imported, attempted),
    imported_count: imported,
  })
}
