# Plan: Firestore emulator for local end-to-end testing

## Goal

`npm run dev:all` gives a complete local site: Share lyrics, set links, live sets (host and
follower), and every cache work against a local Firestore. Nothing touches the live project.

## What exists today

- `npm run dev:backend` starts only the **functions** emulator (`--project demo-chords`).
  `firebase.json` has no `firestore` emulator entry, so every Firestore call from the
  functions fails or hits real credentials.
- All server Firestore access goes through `database()` in `functions/src/firestore.ts`
  (Admin SDK, `initializeApp()` with no options). Stores: `chartCache`, `chartSimplification`,
  `search/searchCache`, `setLinkStore`, `shareStore`, `sharedLyricsStore`, `liveSetStore`.
- The browser reads Firestore directly in one place: `src/lib/liveFollow.ts`
  (`liveSets/{id}` listener, `liveSetSongs/{id}_{hash}` get). It only turns on when
  `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_APP_ID` and `VITE_FIREBASE_PROJECT_ID` are set;
  otherwise followers fall back to polling `/api`.
- `firestore.rules` is only exercised in production. Nothing tests it.
- Unit tests in `functions/srcTest` use fakes; none run against a real Firestore.
- Java and the cached Firestore emulator jar (`~/.cache/firebase/emulators`) are already on
  this machine.

## Decisions to make (owner)

1. **Add `firebase-tools` as a dev dependency?** Today it's a global install. Pinning it makes
   CI and other machines work the same. Recommended: yes, root `devDependencies`.
2. **Add an emulator CI job?** Needs Java on the runner. Recommended: yes, but as a separate
   step after this lands.
3. **Commit target:** `main` or a new branch? (Currently on `feat/live-set-sharing`.)

## Tasks

### 1. Turn on the emulator (backend only)

- `firebase.json` → `emulators`: add `"firestore": { "port": 8080 }`.
- `package.json` → `dev:backend`: `--only functions,firestore`. Also add
  `--import .firebase/emulator-data --export-on-exit` so local sets survive a restart.
- No code change in `functions/`. Running under `firebase emulators:start` sets
  `FIRESTORE_EMULATOR_HOST`, and the Admin SDK picks it up by itself.
- Check `.firebase/` is gitignored (the saved data goes there).
- **Done when:** with `dev:all` running, **Share lyrics** and a set link create documents,
  and they show in the emulator (`curl 127.0.0.1:8080` or the UI on port 4000 if enabled),
  not in the real project.

### 2. Point the browser at the emulator

- `src/lib/liveFollow.ts` `loadFirestore()`: after `getFirestore(app)`, if
  `import.meta.env.VITE_FIRESTORE_EMULATOR_HOST` is set (`host:port`), call
  `connectFirestoreEmulator(db, host, port)`. It has to run before the first read, so it
  goes inside the same once-only block.
- Add to `.env.example` (commented, local only):
  ```
  # Local emulator: copy these into .env.local
  VITE_FIREBASE_PROJECT_ID=demo-chords
  VITE_FIREBASE_API_KEY=demo-key
  VITE_FIREBASE_APP_ID=demo-app
  VITE_FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
  ```
- **Gotcha:** the project id must be `demo-chords` in the browser too. The emulator keeps a
  separate database per project id, so any other id reads an empty database and followers
  see "missing".
- The `demo-` prefix makes the Firebase tools refuse real network calls, so a typo can't
  reach production. Analytics stays off (it needs `PROD` and the hostname list).
- **Test:** unit test in `srcTest/lib` that, with the env set, the emulator connect is called
  once and not when unset.
- **Done when:** two browser windows (host and follower) show a live change within a second,
  and following still works with the three `VITE_FIREBASE_*` vars unset (polling).

### 3. Test the security rules

- Add `@firebase/rules-unit-testing` to `functions` devDependencies (or root; owner's call).
- `functions/srcTest/rules/firestore.rules.test.ts`:
  - `liveSets/{id}` and `liveSetSongs/{id}`: `get` allowed when `expiresAt` is in the
    future, denied when past; `list`, `create`, `update`, `delete` denied.
  - Every other collection (`shares`, `setLinks`, caches) denied for read and write.
- Separate config `functions/vitest.emulator.config.ts` (includes only `srcTest/emulator/**`
  and `srcTest/rules/**`), so plain `npm run test:functions` stays fast and needs no Java.
- Script `test:emulator`: `firebase emulators:exec --only firestore --project demo-chords
  "vitest run --config vitest.emulator.config.ts"`.

### 4. Test the stores against a real Firestore

Fakes can't catch transaction, batch, `orderBy` or query mistakes. Add emulator tests in
`functions/srcTest/emulator/` for:

- `shareStore` and `sharedLyricsStore`: write, read back, songs ordered by `index`, obsolete
  song docs removed on update.
- `setLinkStore`: create, update, the 7-day expiry sliding, the write throttle.
- `liveSetStore`: publish, rev bump, per-song content by hash, stop (the transactional
  delete), expired share reads as gone.
- Caches: `chartCache`, `chartSimplification`, `searchCache` round trip.
- Each test clears its data first (`DELETE http://127.0.0.1:8080/emulator/v1/projects/demo-chords/databases/(default)/documents`).
- Bug-fix rule from AGENTS.md still applies: any real bug these find gets a test that
  fails on the old code.

### 5. One full-flow check through the API

- `functions/srcTest/emulator/api.flow.test.ts`: call the exported `api` handler with fake
  `req`/`res` (same style as `index.setLink.test.ts`) against the emulator. Cover publish and
  fetch of a share, a set link, and a live set, including the rate limiter's Firestore use
  if it persists anything.

### 6. Docs

- `README.md` (the "Sharing also needs a Firestore connection" paragraph): replace with the
  new `dev:all` behaviour, the `.env.local` lines, the Java requirement, and the reset
  command (`rm -rf .firebase/emulator-data`).
- `docs/architecture-deep.html` line ~1431 and `docs/architecture-summarised.html`: same
  correction.
- `AGENTS.md` "Tests and checks": add `npm run test:emulator` as an extra check for changes to
  `functions/src/*Store.ts`, `*Cache.ts` or `firestore.rules`. Keep it out of the default
  must-run line so people without Java aren't blocked.

### 7. CI (separate follow-up, after decision 2)

- New step in the PR workflow: Java 21 (`actions/setup-java`), then `npm run test:emulator`.
  Cache `~/.cache/firebase/emulators`.

## What the emulator will not cover

- **TTL deletion.** Firestore TTL policies don't run locally. Expiry works only where code or
  rules compare `expiresAt`; old documents just stay until the data folder is wiped.
- **Real indexes.** The emulator doesn't enforce composite indexes, so a query that needs one
  passes locally and fails in production. Today's queries are single-field, but check any new
  query by hand against the console.
- **Gemini and chord sites.** Extraction from images or PDFs still needs `GEMINI_API_KEY`;
  search and scraping still hit the real internet. These aren't Firestore, so they're left
  as they are.
- **Hosting rewrites.** Vite's proxy stands in for them, as now.

## Order and size

1 → 2 → 6 first (about three small files plus docs): a working local site. Then 3, 4, 5
(tests) as one commit each. 7 later. Suggested commits: `chore: run the Firestore emulator
locally`, `feat(share): connect the browser to the Firestore emulator`, `test(functions):
test rules and stores against the emulator`, `docs: local Firestore setup`.

## HUMAN steps

- Install Java 21+ if missing (this machine has Java 25 and the emulator jar already cached).
- Copy the `.env.example` emulator lines into `.env.local` (I won't read or write `.env` files).
- Approve the commit target and any new dependency.
