# Chord & Lyrics Sheet Extractor SPA

A personal-use, mobile-first React Single Page Application with Firebase Cloud Functions for scraping, formatting, transposing, and viewing chords and lyrics sheets without scrolling.

## Features

- **Multi-URL Import:** Paste multiple chord-sheet links into a session at once.
- **Supported Sites:**
  - Ultimate Guitar (`tabs.ultimate-guitar.com`)
  - PNW Chords (`pnwchords.com`)
  - Worship Chords (`worshipchords.com`)
  - Worship Together (`worshiptogether.com`)
  - Generic `<pre>` fallback for other chord sheet pages
- **Offline & Browser Caching:** Scraped songs and setlists persist locally in your browser via IndexedDB (`idb-keyval`). Previously viewed songs load instantly offline.
- **Accurate Alignment & Sectioning:** Monospace character-aligned chords positioned directly above lyrics; tabs and chord-only sections preserved with `break-inside: avoid-column` styling.
- **Key Detection & Transposition:** Detects or infers song keys, supports transposition across all 12 keys (major/minor aware with enharmonic spelling), and displays the offset relative to the original key (e.g. `Key: A (original G, +2)`).
- **Column Modes & "Fit to Screen":** Switch between 1, 2, or 3 columns, or use **Fit Screen** mode to dynamically adapt layout and font size to fit the entire sheet on screen without scrolling.
- **In-App Search:** Search songs across supported chord sites directly within the application and add candidates to your active session.

---

## Architecture & Security Safeguards

- **Frontend:** React 19, TypeScript, Vite, React Router v7, Tailwind CSS v4.
- **Backend:** Firebase Cloud Functions (2nd Gen, Node 22, TypeScript, Express routing).
- **Backend Safeguards:**
  - `maxInstances: 3` and `minInstances: 0` to prevent runaway cloud costs.
  - Domain allow-list restricting outbound scraper requests strictly to permitted domains.
  - SSRF guard resolving DNS and rejecting private/loopback/link-local/cloud metadata IPs.
  - 10-second request timeout, 2 MB payload size cap, and strict HTML content-type validation.
  - In-memory IP rate limiter (30 req/min, 300 req/day).
  - Per-host circuit breaker pausing outbound requests for 10 minutes upon 3 consecutive 403/429 upstream blocks.

---

## Local Development & Emulators

### Prerequisites
- Node.js 22+
- npm 10+
- Firebase CLI (`npm install -g firebase-tools`)

### Running the App
1. Install dependencies:
   ```bash
   npm install
   cd functions && npm install && cd ..
   ```

2. Start the Cloud Functions emulator:
   ```bash
   npm run build --prefix functions
   firebase emulators:start --only functions --project demo-chords
   ```

3. In a separate terminal, start the Vite development server:
   ```bash
   npm run dev
   ```
   The frontend dev server proxies `/api/**` to `http://127.0.0.1:5001/demo-chords/us-central1/api`.

4. Run tests and linting:
   ```bash
   npm test
   npm run lint
   npm run build
   ```

---

## Legal & Terms of Service Notice

This tool is designed strictly for **personal study and performance reference**. Chord sheets and lyrics are copyrighted by their respective songwriters and publishers. Scraped results are stored only within the individual user's browser (IndexedDB) and are not redistributed or republished. Always support songwriters and publishers by purchasing licensed sheet music.
