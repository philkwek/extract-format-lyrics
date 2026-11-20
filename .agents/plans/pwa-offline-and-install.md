# PWA: offline reading, offline-aware search, and an install prompt

Status: decided · 2026-11-20 · issue #78

## Goal

1. **Offline.** A service worker so a saved set opens with no connection, edits still save
   locally, and the app says plainly that search and new imports need a network.
2. **Install.** A notice on the home page that installs in one tap on Chromium and shows the
   three steps on iOS.

Read-only for anything remote. Local edits keep working.

## Decisions (settled, don't reopen)

| # | Decision |
| --- | --- |
| D1 | Offline edits are allowed. Every write stays local, and pending set links, live shares and shared lyrics flush on reconnect. |
| D2 | One `online` listener re-runs pending shares immediately instead of waiting for the next open. |
| D3 | Updates use a waiting worker and the existing banner. Never swap under an open tab. |
| D4 | Install notice: an in-flow card directly above **New session** on the home page. Offline card replaces it while offline; one slot, never both. |
| D5 | Install card shows only when Chromium has fired `beforeinstallprompt`, or on iOS/iPadOS Safari with **Show me how!**. Nothing on desktop Safari or Firefox. Never in standalone. |
| D6 | One **Dismiss** on the card, permanent for that browser (`localStorage`). |
| D7 | iOS cannot detect an install done from another tab (separate storage, no API). Accepted; the dismiss covers it. |
| D8 | Offline copy on home, search (`You're currently offline`, submit disabled), `/s`, `/lyrics`, `/live`, and the session's uncached-song banner. |
| D9 | `LiveShareChip` reads **Offline** (amber) with "Followers get your changes when you're back online." in the share panel. |
| D10 | Pads: all 12 (~18 MB) prefetched only in the installed app, on a standalone launch, online, once, resumable, skipped under `saveData`. Browser tabs never prefetch. |
| D11 | Pad cache is versioned (`pads-v1`); bump the constant when the audio files are replaced. |
| D12 | **Clear library** is unchanged. It leaves pads alone. |
| D13 | `?sw=off` unregisters the worker, clears Cache Storage, reloads once. Never IndexedDB. |
| D14 | Keep `public/site.webmanifest`; add `id: "/"`, `start_url: "/"`, `scope: "/"`. `id` is frozen. |

## Design

### Service worker (`src/sw.ts`, `injectManifest`)

- Precache the built shell (`**/*.{js,css,html,svg,png,ico,webmanifest}`, minus `pads/**` and
  `og-image.png`), `cleanupOutdatedCaches()`.
- Navigation fallback to `/index.html`, deny `/api/**`.
- `/api/**` is `NetworkOnly`.
- Pads: `CacheFirst` in `pads-v1` with `RangeRequestsPlugin` so audio seeking works.
- Fonts: stylesheet `StaleWhileRevalidate`, `fonts.gstatic.com` `CacheFirst`.
- `message` handler:
  - `SKIP_WAITING` → `self.skipWaiting()` (only when the person taps **Reload**).
  - `WARM_PADS` → fill `pads-v1` from the given URL list, skipping what is already cached,
    two at a time.
- Every page checks `sw.js` on each load because hosting serves it `no-cache`.

### Update flow

`src/lib/serviceWorker.ts` registers `/sw.js` itself (no virtual module):
- a waiting worker or a newly installed worker while controlled → `onNeedRefresh`;
- `update()` posts `SKIP_WAITING` and reloads on `controllerchange`;
- `registration.update()` is called by the hourly timer in `useAppUpdate`.
- `/version.json` polling stays as the fallback when no registration exists.

### Offline

`src/lib/useOnlineStatus.ts` reads `navigator.onLine` and listens for `online` / `offline`.

`HomeNotice` chooses: offline card → install card → nothing. Both use the same neutral surface
and body text: the offline card reads **You're currently offline**; the install card carries
**Install app** or **Show me how!** plus the dismiss icon.

`/s/:id`, `/lyrics/:id`, `/live/:id`: an offline line above their existing states.

Session page: when offline and a song is not cached, copy becomes "This song sheet isn't saved on
this device." with no **Reload from source**; it returns when the connection does.

### Install

`src/lib/installPrompt.ts` is a small store created by `createInstallPromptStore({ window,
storage })`, so tests can build a fresh one:
- captures `beforeinstallprompt` (imported first in `main.tsx`), clears on `appinstalled`;
- `isStandalone()`: `display-mode: standalone` or `navigator.standalone`;
- `platformOf(ua, platform, touchPoints)`: `chromium | ios | other`;
- `promptInstall()` returns `accepted | dismissed | unavailable`;
- permanent dismissal in `localStorage['install-notice-dismissed']`.

The iOS steps reuse `OverlayDialog`: 1. Tap Share. 2. Add to Home Screen. 3. Tap Add.

### Pads

`src/lib/padKeys.ts` holds `PAD_KEYS`, `resolvePadKey`, `getPadAudioUrl`, `PAD_URLS` and
`PAD_CACHE_NAME`, so both the app and the worker share one list. `ambientPadPlayer` re-exports
the names it already exported.

`src/lib/prefetchPads.ts` runs on startup: standalone, online, not `saveData` → message the
active worker with `PAD_URLS`. Interrupted downloads resume because cached files are skipped.

### Manifest

`public/site.webmanifest` gains `id`, `start_url`, `scope`, `description`, `lang`, `short_name`.

## Tasks

1. Dependency + `padKeys` extraction.
2. `sw.ts`, Vite config, manifest.
3. Registration + update flow (`serviceWorker.ts`, `useAppUpdate`).
4. Offline hook, home notice, search/paste disabled, link pages, session copy.
5. Install store, `HomeNotice` install card, iOS dialog.
6. Pad prefetch.
7. Sync flush on `online`.
8. Tests, README, all checks, browser pass.

## Tests

- `useOnlineStatus`: online/offline events, listener cleanup.
- `installPrompt`: platform detection, event capture, `prompt()` result, permanent dismiss,
  standalone means never visible.
- `serviceWorker`: waiting worker prompts, `update()` posts `SKIP_WAITING` and reloads once.
- `useAppUpdate`: SW path, version fallback still works.
- `HomeNotice`: offline hides install; dismissed install hides; iOS shows **Show me how!**.
- `SearchForm` disabled prop; `LiveShareChip` offline label.
- `prefetchPads`: only standalone, only online, skips `saveData`.

## Out of scope

- Offline writes for anything remote (they stay local until reconnect).
- Push, background sync, live-share following offline.
- Play Store/TWA packaging.

## HUMAN steps

- `firebase deploy --only hosting`.
- Lighthouse installability on the deployed site.
- Install on a real iPhone and Android, open a saved set in airplane mode.
