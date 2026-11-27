/**
 * The app's service worker. Written by hand (injectManifest) because it owns three things the
 * generated one cannot: the pad warm-up, skip-on-demand updates, and the pad cache name.
 */
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { RangeRequestsPlugin } from 'workbox-range-requests'
import { PAD_CACHE_NAME, PAD_URLS } from './lib/padKeys'

declare const self: Window & {
  __WB_MANIFEST: Array<{ revision: string | null; url: string }>
  skipWaiting(): Promise<void>
}

type MessageEventWithWait = MessageEvent<{ type?: unknown; urls?: unknown }> & {
  waitUntil(promise: Promise<unknown>): void
}

const DAY = 60 * 60 * 24

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Every route renders the one shell; API calls and Firebase Hosting auth handlers never do.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/__\//],
  }),
)

// A stale search, live set, or auth redirect is worse than an error.
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/__/'),
  new NetworkOnly(),
)

registerRoute(
  ({ url }) => url.pathname.startsWith('/pads/'),
  new CacheFirst({
    cacheName: PAD_CACHE_NAME,
    plugins: [new RangeRequestsPlugin()],
  }),
)

registerRoute(
  ({ url }) => url.hostname === 'fonts.googleapis.com',
  new StaleWhileRevalidate({ cacheName: 'font-css' }),
)

registerRoute(
  ({ url }) => url.hostname === 'fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'fonts',
    plugins: [new ExpirationPlugin({ maxEntries: 12, maxAgeSeconds: 365 * DAY })],
  }),
)

/** Fills the pad cache, skipping what is already there, so a closed tab resumes next launch. */
async function warmPads(urls: readonly string[]): Promise<void> {
  const cache = await caches.open(PAD_CACHE_NAME)
  const queue = [...urls]
  const fill = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const absolute = new URL(url, self.location.origin).toString()
      if (await cache.match(absolute)) continue
      try {
        const response = await fetch(absolute, { cache: 'no-store' })
        if (response.ok) await cache.put(absolute, response)
      } catch {
        // Offline mid-download: the next launch asks again and picks up the rest.
      }
    }
  }
  await Promise.all([fill(), fill()])
}

self.addEventListener('message', (event) => {
  const data = (event as MessageEventWithWait).data
  if (data?.type === 'SKIP_WAITING') {
    void self.skipWaiting()
    return
  }
  if (data?.type === 'WARM_PADS') {
    const urls = Array.isArray(data.urls)
      ? data.urls.filter((url): url is string => typeof url === 'string')
      : PAD_URLS
    ;(event as MessageEventWithWait).waitUntil(warmPads(urls))
  }
})
