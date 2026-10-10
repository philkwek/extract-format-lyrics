# Chord & Lyrics Sheet Extractor SPA (v1.0.0)

A fast, clean, personal-use, mobile-first React Single Page Application with Firebase Cloud Functions for scraping, formatting, editing, transposing, and viewing chords and lyrics sheets without scrolling.

Designed specifically for musicians and worship leaders performing on tablets or laptops who need legible, scroll-free, and easily customizable chord charts without advertisements or cluttered layouts.

---

## Features

### 🔍 Instant Search & Multi-URL Import
- **Multi-URL Batch Scraping:** Paste multiple chord sheet URLs into a session at once to generate a full setlist in seconds.
- **In-App Search:** Search songs across supported chord sites directly from the homepage or within an active setlist, and add candidates with a single click.
- **Supported Providers:**
  - Ultimate Guitar (`tabs.ultimate-guitar.com`)
  - PNW Chords (`pnwchords.com`)
  - Worship Chords (`worshipchords.com`)
  - Worship Together (`worshiptogether.com`)
  - Generic `<pre>` fallback for other clean chord sheet sites.
- **Smart Deduplication:** Normalizes messy chord charts by removing contiguous duplicated lines and redundant repeated sections while strictly preserving repeated lyric phrases that have different chords attached.

### 📜 Performance-Ready Sheet Viewer
- **Fit to Screen Mode:** Dynamically calculates column count and scales font size (down to 11px) to fit the entire song onto your screen—eliminating the need to scroll during live performances.
- **Multi-Column Layouts:** Seamlessly toggle between 1, 2, or 3 columns with `break-inside: avoid-column` section styling to prevent awkward mid-verse splits.
- **Monospace Alignment:** Precision character-offset positioning (`pos`) places chords accurately above their corresponding lyrics.
- **Key Detection & Transposition:** Detects original keys and transposes across all 12 keys with enharmonic spelling and major/minor awareness. Shows relative signed pitch offset (e.g. `Key: A (original G, +2)`).
- **Simplify Chords:** One-tap toggle to switch between standard and simplified chords on sheets where a simplified chart is provided upstream (e.g. Ultimate Guitar).

### ✏️ Interactive Chord Editing & Deletion
- **"Edit Chords" Mode:** Click on any chord in the sheet to change it or delete it.
- **Custom Musical Keyboard:** Touch-friendly on-screen chord keyboard featuring:
  - **Simple Mode:** Quick access to root notes (A–G, sharps, flats) and standard qualities (Major, Minor, 7).
  - **Advanced Mode:** Extended chords, suspensions, additions, diminished/augmented qualities, and bass slash note options (e.g., `D/F#`, `Gsus4`, `Cmaj7`).
- **Full Persistence:** Chord edits and deletions are saved locally and travel with shared links.

### 🔀 Flexible Song & Section Reordering
- **Desktop Drag-and-Drop:**
  - Drag song tabs to rearrange setlist order.
  - Drag sections within a sheet with a top insertion line indicator to customize song arrangements (e.g. Verse-Chorus-Verse-Chorus-Bridge-Chorus).
- **Mobile Arrange Drawer:** Touch-friendly drawer interface with one-tap up/down step arrows to reorder songs and sections on phones and tablets where dragging is cumbersome.
- **Section Deletion & Restore:** Delete unneeded sections (intros, instrumentals, or repeated outros) with a confirmation dialog and a quick restore banner.

### 🔗 Seven-Day Set Sharing
- **Faithful server snapshots:** Share a complete immutable copy of a set, including song data, custom section/chord edits, transpose choices, simplified selections, and song order.
- **Seven-day capability links:** Anyone holding a link can import the set for seven days; no account is required. Links expire at the backend and Firestore TTL later removes the stored snapshot.
- **Personal display stays personal:** Column layout, font size, and theme are not shared.

### 📱 Eye-Friendly Design & Theming
- **Custom Low-Contrast Dark Mode:** Carefully tuned dark palette (`#101010` base, `#1a1a1a` cards, `#e5e5e5` soft text) designed to minimize glare and eye fatigue on dark stages or dimly lit rehearsal rooms.
- **Clean Light Mode:** High-contrast light palette for bright environments.
- **Instant Global Theme Toggle:** Switch themes anytime directly from the top navigation bar.

### 💾 Local Persistence & Caching
- **Offline Storage:** Scraped songs, edits, and setlists are cached in the browser via IndexedDB (`idb-keyval`). Previously opened songs load instantly offline.
- **Timestamped Setlist Titles:** New setlists automatically receive timestamped titles (e.g. `Setlist (Oct 9, 03:54 PM)`) to avoid name collisions, with full inline renaming support.

---

## Architecture & Security Safeguards

### Tech Stack
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, React Router v7, `idb-keyval`.
- **Backend:** Firebase Cloud Functions (2nd Gen, Node 22, TypeScript, Express, Cheerio).
- **Hosting:** Firebase Hosting with `/api/**` rewritten to the Cloud Function.

### Cost & Security Guardrails
- **Cloud Run Concurrency & Bounds:** `maxInstances: 3` and `minInstances: 0` to prevent runaway cloud costs. Under personal usage, costs stay safely within the free tier ($0/month).
- **Domain Allow-List:** Scraper strictly permits outbound requests to approved chord websites.
- **SSRF Protection:** Resolves target domain DNS and validates that IPs do not belong to private, loopback, link-local, or cloud metadata ranges.
- **Request Caps:** 10-second timeout, 2 MB payload size limit, and strict HTML content-type checking.
- **Rate Limiting & Circuit Breaker:** In-memory IP rate limiter (30 req/min, 300 req/day) and an automatic 10-minute circuit breaker on any host that returns 3 consecutive 403 or 429 status codes.

---

## Local Development

### Prerequisites
- **Node.js:** 22+
- **npm:** 10+
- **Firebase CLI:** Installed globally (`npm install -g firebase-tools`)
- **Firestore:** Create the project database in Native mode and configure a TTL policy on the `sharedSets` collection group’s `expiresAt` field. The deployed rules deny browser access; Cloud Functions use Admin credentials.

### Installation
```bash
git clone https://github.com/<your-username>/extract-format-lyrics.git
cd extract-format-lyrics
npm install
cd functions && npm install && cd ..
```

### Running Locally
To run both the Cloud Functions emulator and the Vite dev server with one command:
```bash
npm run dev:all
```

Alternatively, run them in separate terminals:
1. **Start Functions Emulator:**
   ```bash
   npm run dev:backend
   ```
2. **Start Frontend Dev Server:**
   ```bash
   npm run dev
   ```
   The frontend runs on `http://localhost:5173` and proxies `/api/**` requests to the local emulator.

### Available Scripts
- `npm run dev` - Starts Vite dev server.
- `npm run dev:backend` - Builds functions and starts the Firebase emulator.
- `npm run dev:all` - Concurrently runs backend emulator and frontend dev server.
- `npm run test` - Executes Vitest across all unit and integration test suites.
- `npm run lint` - Runs ESLint checks.
- `npm run format` - Runs Prettier to format source files.
- `npm run build` - Typechecks and bundles the frontend.
- `npm run build:functions` - Compiles TypeScript in `functions/`.

---

## Testing & Verification

The project includes thorough unit and integration test suites covering the scraper, normalizer, chord parser, transposer, session storage, set snapshot construction, and security guards:

```bash
npm test
```
- **21 Test Suites** | **93 Passing Tests**
- Full test coverage across backend adapters, safe fetch SSRF guards, rate limiters, chord editing, and display logic.

---

## Deployment & CI/CD

### Automated Deployment (GitHub Actions)
The repository includes a GitHub Actions CI/CD workflow (`.github/workflows/deploy.yml`) that automatically runs linter, tests, frontend build, functions typechecking, and deploys to Firebase Hosting on every commit/merge to `main`.

To enable it, simply add two secrets in your GitHub repository (**Settings > Secrets and variables > Actions**):
- `FIREBASE_SERVICE_ACCOUNT`: Service Account JSON key with Firebase Hosting Admin permissions.
- `FIREBASE_PROJECT_ID`: Your Firebase project ID.

See [`docs/deployment-and-cost.md`](docs/deployment-and-cost.md) for step-by-step instructions.

### Manual Deployment
```bash
npm run build
npm run build:functions
firebase deploy
```

---

## Future Roadmap

- **Algorithmic Chord Simplification Fallback:** Algorithmic engine stripping complex extensions down to root triads for websites that lack an official simplified chart.
- **Full PWA Offline Support:** Service worker (`vite-plugin-pwa`) to cache the complete app shell for full offline usage.
- **PDF & Print Export:** 1-page printable chord sheets formatted specifically for stage binders and paper music stands.

---

## Legal & Terms of Service Notice

This tool is created strictly for **personal study, private rehearsal, and live performance reference**. Chord sheets and lyrics are the intellectual property and copyright of their respective songwriters and publishers. 

Scraped results and chord edits are stored only inside the individual user's browser (IndexedDB or URL hash) and are not republished, redistributed, or sold. Please support artists and songwriters by purchasing authorized sheet music and licensing your public performances through applicable licensing organizations (e.g. CCLI, ASCAP, BMI).
