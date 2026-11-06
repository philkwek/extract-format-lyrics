# Live set sharing (phase 2): implementation plan

Status: Ready. D1 to D4 decided by the owner (section 2)
Issue: philkwek/extract-format-lyrics#45 (phase 1 shipped in PR #47)

## 1. What we are building

Phase 1 gave every set a copyable address. Opening it rebuilds an **independent copy**.

Phase 2 upgrades **Share set → Generate link** into a **live share**:

- The host clicks **Share live**. They get a link like `/live/<id>`.
- Anyone who opens it gets the host's set, including custom sections, chord edits and
  uploads, with **Follow Host Edits** **on by default**. The host's changes (song order,
  name, key, simplify, pad settings, custom sections and flow, chord edits) show up within a
  few seconds, with no reload. Personal view settings (columns, font size, fit to screen)
  still work.
- When a follower starts to edit the set (chords, sections, order, key and so on), they're
  warned that editing makes it their own copy and stops following the host's edits. If they
  go ahead, **Follow Host Edits** turns off and the edit happens.
- Turning the toggle off stops the updates. The set keeps the version it last received and
  becomes editable.
- The host can **Stop sharing** at any time. Followers keep what they last saw, plus a notice.
- Live shares expire 7 days after the host last changed or opened the set (sliding TTL).

The copied address-bar link from phase 1 stays exactly as it is: a one-time copy that
doesn't update. The two links are deliberately different ids, so pasting the address bar
never gives someone live access.

### Out of scope (later, if wanted)

- "Follow the host's current song" (page-turn sync). The data model leaves room for it
  (section 4.1), but it is not built here.
- One host editing from two devices. The write secret lives in one browser, as in phase 1.
- Followers editing together (multi-host).
- Simplifying the chords while still following the host. In this plan **Simplify** goes
  through the edit guard like any other edit. It becomes its own issue once everything here
  has shipped (section 9).

## 2. Owner decisions (decided, don't reopen)

| # | Question | Decision |
| --- | --- | --- |
| D1 | How do followers get updates? | **Decided: Firestore realtime listener (`onSnapshot`)** in the browser, with read-only rules on the live collections. It's instant, a follower costs about 1 read per host change, and there's no polling. The alternative is polling `GET /api/live-set/:id` with an ETag every ~10 s. That needs no rules change, but it costs a function call and a Firestore read per poll per follower, even when nothing changed. |
| D2 | Can a follower transpose or simplify for themselves? | **Replaced on 2026-11-06 by D5 (section 10). Original decision:** there's a **Follow Host Edits** toggle, **on by default**. While it's on, the follower gets the host's version (key and simplify included), and only personal view settings change freely. Any edit to the set, transposing for a capo included, first warns that it will make the set their own copy and stop following. Confirming turns the toggle off and applies the edit. See 4.5 and 4.6. |
| D3 | What happens to the old immutable `/s/:id` links? | **Decided: stop creating them, but keep opening them.** `GET /api/share/:id` and `/s/:shortId` keep working until the last link expires (7 days after deploy). Remove `POST /api/share` from the UI now and delete it in a cleanup PR a week later. |
| D4 | Song limit for live shares | **Decided: 30**, the same as set links. Song content goes in separate docs (4.1), so the old 15-song cap from the snapshot doc size no longer applies. |

Polling stays only as the fallback in 4.5, for networks that block Firestore.

## 3. Decisions already made (don't reopen)

- Phase 1 behaviour, ids and the `setLinks` collection stay untouched.
- Firestore writes go only through the Cloud Function (Admin SDK). Browsers never write.
- Ids come from a client secret: `publicId = base64url(SHA-256(domain + secret))[0..16 bytes]`,
  using a **new** domain separator, `live-set-v1:`.
- The edit-gating rules from phase 1 apply unchanged to the host's writes: hash compare,
  bookkeeping in the identity store, 1.5 s debounce, one write in flight, 5 s spacing,
  Retry-After handling, keepalive flush on hide.

## 4. Design

### 4.1 Data model

Splitting the set into a small **manifest** plus immutable **content docs** keeps writes
small. Changing a key or reordering rewrites only a doc of about 2 KB. A chord edit adds one
content doc. Followers re-download only what changed.

```
liveSets/{publicId}                      ← manifest, followers listen to this one doc
  v: 1
  name: string
  entries: [{ entryId, contentHash, targetKey?, simplified?, padKeyMode?, customPadKey? }]
  status: 'live' | 'stopped'
  rev: number               ← +1 on every accepted write, so followers can drop stale events
  updatedAt, expiresAt      ← TTL field
  writeDay, writeCount      ← same throttle bookkeeping as setLinks

liveSetSongs/{publicId}_{contentHash}    ← one per distinct song content, never modified
  liveId: publicId
  song: Song                ← the same Song shape the snapshot uses (uploads included)
  customSections?, customFlow?, customSimplifiedSections?, customSimplifiedFlow?
  expiresAt                 ← TTL field, pushed forward with the manifest
```

- `contentHash` = SHA-256 of the canonical JSON of `{song, custom*}`. It is computed on the
  client and **recomputed on the server**, which rejects a mismatch with 400.
- Content docs use a top-level collection (`liveSetSongs`), not a subcollection, so they get
  their own TTL policy and simple rules.
- Upload songs work here, unlike phase 1, because the song body travels in the content doc.
  The size cap is 256 KB per content doc, checked on the server; anything larger gets 413.

### 4.2 Host write path

Reuse the phase 1 engine. Don't write a second one.

1. Change `createSetLinkSync` into a generic **`createSyncChannel`**. Its deps gain
   `buildPayload(session)` and `publish(identity, payload, opts)`. The phase 1 set link
   becomes one channel and the live share another. Each channel keeps its own state map, so
   one can't block the other.
2. The live channel is active only for sessions that have a live identity, which is created
   when the host clicks **Share live**. It lives in the same `app_set_links_db/identities`
   store under the key `live:<sessionId>`, with fields `secret`, `publicId`,
   `lastPublishedHash`, `knownContentHashes[]` and `expiresAt`.
3. Publishing one change:
   - Build each entry's content and hash it.
   - For each hash not in `knownContentHashes`, call `PUT /api/live-set/:id/song/:hash`.
     These go one at a time, and the server makes them idempotent: if the doc exists, it
     only pushes `expiresAt` forward.
   - Then call `PUT /api/live-set/:id` with the manifest.
   - Record the new hashes and the manifest hash.
   - If any step fails, the whole run goes through the existing retry path. Content docs that
     were already uploaded are harmless leftovers.
4. Chord-edit bursts: the 1.5 s debounce means a session of typing costs one content doc per
   pause, not one per keystroke. The per-id daily cap (200 writes) counts content and
   manifest writes together.
5. **Stop sharing** sends `DELETE /api/live-set/:id`. The server sets `status: 'stopped'`
   and clears `entries`. The host then deletes the live identity locally. Clicking
   **Share live** again later creates a new id.

### 4.3 Server

New file `functions/src/liveSetStore.ts`, modelled on `setLinkStore.ts`:

- `PUT /api/live-set/:id`, Bearer secret: validates and sanitises the manifest. Every
  `contentHash` must already exist as `liveSetSongs/{id}_{hash}`; otherwise it returns 409
  `MISSING_CONTENT` with the missing hashes, and the client uploads them and retries once.
  In a transaction it writes the manifest, bumps `rev`, and pushes `expiresAt` to now + 7 d.
  It skips the write when the hash is unchanged and more than 6 d remain, as phase 1 does.
  After the commit, it best-effort deletes content docs for this id that are no longer
  referenced and are older than 10 minutes, so a follower mid-fetch isn't cut off.
- `PUT /api/live-set/:id/song/:hash`, Bearer secret: recomputes the hash and validates with
  the existing `isSong`/section validators from `shareStore.ts`, reused rather than copied.
  It creates the doc, or only extends `expiresAt` if it exists.
- `DELETE /api/live-set/:id`, Bearer secret: marks the share stopped.
- `GET /api/live-set/:id`: returns the manifest plus all its content, with no-store. This is
  used for the follower's first load and as the fallback if the listener can't connect
  (blocked websockets, corporate networks).
- Throttling: the same `rejectIfLimited` and 5 s/200-per-day per id as phase 1. Content PUTs
  that hit an existing doc don't count toward the daily cap.

### 4.4 Firestore rules (D1)

```
match /liveSets/{id} {
  allow get: if resource.data.expiresAt > request.time;
  allow list, write: if false;
}
match /liveSetSongs/{docId} {
  allow get: if resource.data.expiresAt > request.time;
  allow list, write: if false;
}
// everything else stays deny-all
```

Ids are 128-bit and unguessable, and `list` is denied, so nobody can enumerate shares.
Stopped manifests stay readable until TTL so followers see the "stopped" notice.

### 4.5 Follower read path

New file `src/lib/liveFollow.ts`:

- It lazy-loads `firebase/app` and `firebase/firestore` (only on `/live/*`, so no bundle
  cost elsewhere) with the existing `VITE_FIREBASE_*` config.
- **Opening the link** (`/live/:liveId`) does a single `GET /api/live-set/:id`. It creates
  a local session with `liveSourceId: string`, `followHost: true` and `lastHostHash`, then
  goes to that set's page, where following starts (step 3 below). `followHost` is saved on
  the session, so it resumes after a reload or on the next open.
- **Turning Follow Host Edits back on** after it was turned off:
  1. Warn first if the follower has edited the set since the last host version: "Turning
     this on replaces your changes with the host's version." They choose **Follow** or
     **Cancel**. "Edited" means the session's current payload hash differs from the
     `lastHostHash` stored when the host version was applied.
  2. Do one `GET /api/live-set/:id` and apply it, so they're current straight away.
- **While following:**
  3. Start `followLiveSet(id, handlers)`, which lazy-loads Firestore and calls
     `onSnapshot(liveSets/{id})`. On each event where `rev` is above the last seen value,
     it fetches with `getDoc` any `contentHash` the follower doesn't have, caches it in
     IndexedDB by hash, and applies the change.
  4. If the listener errors, it falls back to the GET every 30 s while the tab is visible,
     and stops while the tab is hidden.
  5. The listener runs only while that set's page is open and the toggle is on. Leaving the
     page unsubscribes. Coming back does a catch-up GET, then subscribes again.
- **Editing while following** turns it off first. See the edit guard in 4.6.
- **Turning it off** unsubscribes, keeps the last applied version, and makes the set
  editable again. The set's own set link was paused while following (next point), so it
  resumes and publishes the version the follower now has.
- Applying a host change goes through the normal session store, so the song view, offline
  reading and the library all work as they do today. Content docs are written to
  `songCache` keyed by hash, so the session page needs no special casing.
- While `followHost` is true, both sync channels skip the session. A following set never
  publishes a set link or its own live share. The guard checks `followHost` before
  publishing. A set that is itself shared live can't follow anyone: `liveSourceId` and a
  live identity are mutually exclusive, and **Share live** is hidden on followed sets.

### 4.6 UI

Host, in the **Share this set** section of `ShareMenuModal` (and `ShareModal` on the home
page):

The section asks the host to pick one of two ways to share, using the shared
`SegmentedControl` from `src/components/ui/`. **Copy** is selected by default because it
needs no setup.

| Option | Label | What it says | Action |
| --- | --- | --- | --- |
| Copy | **Send a copy** | "People get their own copy of the songs and keys as they are now. Your chord and section edits aren't included, and later changes won't reach them." | **Copy link** copies this set's page address (the phase 1 set link, `sessionPath` on the current origin). This is the same thing as copying the address bar, and the tip says so: "This is the same as copying this page's address." |
| Live | **Share live** | "People see your chord edits, sections and changes as you make them. They can turn on **Follow Host Edits** to keep up. The link stops working 7 days after your last change." | **Start live share**, then **Copy link** and **Stop sharing** |

- The Copy option's text has to match what phase 1 really sends. The set link carries the
  song links, set name and per-song key, simplify and pad settings. It doesn't carry custom
  sections or flow, chord edits, or uploaded sheets. If the set has uploaded sheets, add the
  line "Uploaded sheets aren't included. Use **Share live** to send them."
- If the set has never been published (the set link isn't on the server yet), **Copy link**
  calls `ensureSetLinkFresh` first, then copies.
- Labels stay short so they don't wrap at 375 px. If they do, they become **Copy** and
  **Live**.
- The phase 1 tip line in `ShareSetLinkPanel` is replaced by this choice, so it isn't said
  twice.
- The modal's description changes to "Send a copy of the set, share it live, or send a
  lyrics-only link."
- While live, a small **Live** chip shows next to the set name, with text and not colour
  alone. It shows "Not updating" if the channel has given up after retries. Reopening the
  modal on a live set opens the **Share live** option.
- Sets that follow someone else (`liveSourceId`) show only **Send a copy**.

Follower, on `SessionPage` when `liveSourceId` is set:

- A banner holds the **Follow Host Edits** switch, using the shared segmented/switch
  primitive from `src/components/ui/`. It's on when the set first opens.
  - On: "Following the host's edits. Editing this set makes it your own copy." The status
    text reads **Live**, **Reconnecting…**, **Sharing stopped** or **Link expired**, in
    text and not colour alone.
  - Off: "This is your own copy. Turn on **Follow Host Edits** to get the host's changes
    again."
- When the host has stopped sharing or the link has expired, the switch turns itself off
  and is disabled, and the set keeps the last version received.
- **Edit guard.** While following, controls that change the set stay enabled, so nothing
  looks broken. Using one opens a confirm dialog (`OverlayDialog`) first. The guarded
  controls are: chord editing, chord position, split/merge, Customise sections, Arrange,
  Add song, Upload, remove song, rename set, key, simplify and pad key.
  - Title: "Make this your own copy?"
  - Body: "Editing stops following the host's edits. You'll keep the set as it is now, and
    the host's later changes won't reach you. You can turn **Follow Host Edits** back on
    later, but that replaces your changes."
  - Buttons: **Edit my copy** (primary) and **Keep following**.
  - **Edit my copy** sets `followHost: false`, unsubscribes, then continues the action the
    follower started (enters chord edit mode, applies the chosen key, opens Arrange, and so
    on). **Keep following** cancels and leaves everything as it was, and the key picker
    snaps back to the host's key.
  - Implement it as one `useFollowEditGuard()` hook in `SessionPage`. It returns
    `guard(action)`, which runs the action directly when not following and otherwise shows
    the dialog. Each control's handler wraps its existing body in `guard(...)`, so the
    editing code itself isn't touched.
  - A host change that arrives while the dialog is open waits until the dialog closes. If
    the follower picks **Edit my copy**, it's dropped.
- Personal view controls (columns, font size, Fit, full screen, theme) never go through the
  guard, because they're already per-device preferences.
- No jumps mid-song: changes apply in place, and the follower stays on their current
  `entryId`. If the host removes that song, the follower keeps seeing it with "Removed by
  the host" until they move to another song.
- If a host change arrives while a dialog is open, it applies after the dialog closes.
- Song switching follows the protected song sheet rule: nothing in `SongSheet.tsx` or the
  layout files changes. The guard wraps handlers in `SessionPage` before they reach the
  sheet, so the sheet's editing behaviour is unchanged.

Route: `/live/:liveId` → `LiveFollowPage`. If a session with that `liveSourceId` already
exists, it navigates there; otherwise it creates one. Concurrent opens share one in-flight
import, the same pattern as `importFromSetLinkOnce`.

## 5. Tasks

Run them in order. Each one is a single commit and passes the full check line from AGENTS.md.

| # | Commit | Files | Test | Done when |
| --- | --- | --- | --- | --- |
| 1 | `feat(functions): add live set store and endpoints` | `functions/src/liveSetStore.ts`, `functions/src/index.ts`, `functions/src/types.ts`; export the validators from `shareStore.ts` | `functions/srcTest/liveSetStore.test.ts` covers the hash mismatch → 400, the 409 missing-content case, unchanged-skip, the throttle, stop and the orphan sweep. `functions/srcTest/index.liveSet.test.ts` covers the routes and their status codes. | All four endpoints behave as in 4.3 against the fake Firestore used by the set-link tests |
| 2 | `feat(functions): allow reading live shares` | `firestore.rules` | Manual check in the rules playground. A rules unit test needs the Firestore emulator, which isn't set up (note this in the report). | get is allowed on both collections, and list and write are denied |
| 3 | `refactor(lib): turn set link sync into a reusable channel` | `src/lib/setLinkSync.ts` | The existing `setLinkSync.test.ts` passes unchanged | No behaviour change; phase 1 tests are green |
| 4 | `feat(share): publish live shares from the host` | `src/lib/liveShareSync.ts`, `src/lib/setLinkIdentity.ts` (`live:` keys), `src/lib/api.ts`, `src/main.tsx` | `srcTest/lib/liveShareSync.test.ts` covers: content uploaded once per hash, a key change sends only the manifest, a 409 triggers re-upload and one retry, follower sessions are never published, and stop clears the identity | The host's changes reach the server with the write counts from 4.2 |
| 5 | `feat(ui): choose between sending a copy and sharing live` | `src/components/share/ShareSetPanel.tsx` (replaces `ShareSetLinkPanel.tsx`), `ShareMenuModal.tsx`, `ShareModal.tsx`, `SessionPage.tsx` (Live chip) | Panel tests cover: **Send a copy** is the default and copies `sessionPath` on the origin; an unpublished set runs `ensureSetLinkFresh` before copying; the upload notice shows only when the set has uploads; **Start live share**, **Copy link** and **Stop sharing** work; a live set opens on **Share live**; a following set has no **Share live** | Both options work at 375 px and tablet widths, in light and dark mode, and **Generate link** is gone (D3) |
| 6a | `feat(session): open a live share` | `src/pages/LiveFollowPage.tsx`, `src/App.tsx`, `src/lib/sessionStore.ts` (`liveSourceId`, `followHost`, `lastHostHash`), `src/lib/liveFollow.ts` (GET + apply only) | `srcTest/lib/liveFollow.test.ts` covers: opening creates one set with `followHost: true` and `lastHostHash`, a second open reuses it, and the content matches the host's | The link opens the host's set with full content (listening is added in 6b) |
| 6b | `feat(session): follow host edits` | `src/lib/liveFollow.ts` (listener, fallback), `src/lib/useFollowEditGuard.ts`, `SessionPage.tsx` (switch, edit guard, turn-on warning), both sync channels (skip while following) | Extend `liveFollow.test.ts` with a fake listener: stale `rev` ignored, only missing content fetched, the turn-on warning shown only when there are local edits, turning off resumes the set link, the current song kept when removed, stopped and expired turn the switch off, and the fallback paused while hidden. Add `useFollowEditGuard.test.tsx`: the action runs directly when not following; when following, the dialog shows and **Keep following** runs nothing; **Edit my copy** turns following off and then runs the action once; a host change held during the dialog is dropped after **Edit my copy**. Also update `SessionPage.test.tsx` (entering chord edit while following shows the dialog; layout controls don't). | Two browsers: the follower sees the host's key, order and chord changes within a few seconds without touching anything. Tapping chord edit warns, and confirming stops updates and enters edit mode. |
| 7 | `docs: explain live sharing` | `README.md` ("Before you rely on it", TTL steps), `src/pages/PrivacyPage.tsx`, `src/lib/analytics.ts` (`live_share_started`, `live_share_stopped`, `live_share_followed`) | None | The copy is plain and states the limits |
| 8 | (a week after deploy) `chore: remove one-off share links` | Delete `POST /api/share` and `createShareApi`. Delete the `/s/` GET route and `ShareImportPage` once no links are left. | Remove the tests that only covered those | The `sharedSets` collection is empty |

## 6. Write and read budget (worst realistic case)

A host rehearsal of one hour with 10 followers and 15 songs:

- Opening the share: 15 content writes plus 1 manifest write.
- About 40 key or order changes: 40 manifest writes (~2 KB each).
- About 20 chord-edit pauses: 20 content writes plus 20 manifest writes.
- Total ≈ 96 writes, well under the 200 per day cap.
- Follower reads ≈ 10 × (16 initial + 60 manifest + 20 content) ≈ 960 reads, since
  **Follow Host Edits** is on by default. Followers who turn it off stop costing reads.

Compare polling every 10 s: 10 × 360 = 3,600 reads and function calls, with nothing changing
most of the time. That gap is the reason for D1.

## 7. What it still can't do (put this in the README)

- Live sharing stops if the host clears their browser storage or switches devices. They
  start a new live share.
- If the host is offline, followers keep the last version. Changes arrive when the host
  reconnects.
- Followers on networks that block Firestore's connection get updates every 30 s instead of
  instantly.
- Shares end 7 days after the host's last change or open.
- Turning on **Follow Host Edits** replaces the follower's own changes to that set. There's
  a warning first, but no merge.
- Transposing for a capo, like any other edit, makes the set your own copy and stops
  following. There's no personal key on top of the host's.

## 8. HUMAN steps

1. After task 2, deploy the rules: `firebase deploy --only firestore:rules`.
2. After the first live share exists, add TTL policies on `expiresAt` for collection
   groups **`liveSets`** and **`liveSetSongs`**. Use the same steps as `setLinks`: either the
   console or `gcloud firestore fields ttls update expiresAt --collection-group=<name> --enable-ttl`.
3. Deploy functions and hosting together, so the new UI never runs against an old API.
4. Test on staging with two browsers (one host, one follower), at phone and tablet widths, in
   light and dark mode.
5. A week after deploy, run task 8.
6. Once task 8 has shipped, open the follow-up issue in section 9.

## 9. Follow-up issue (after every task above has shipped)

Open this issue only after tasks 1 to 8 are merged and deployed, and not before, so it's
written against the real follower code. `gh issue create` is a GitHub write, so it's a
**HUMAN** step, or the agent runs it only when the owner asks in that session.

Title: `[Feat] Simplify chords while following host edits`

Body (rewrite it against the shipped code first):

> Today, tapping **Simplify** on a set you follow shows "Make this your own copy?", and
> confirming stops **Follow Host Edits**. Musicians who want easier chords have to give up
> live updates.
>
> Goal: a follower can turn **Simplify** on or off for themselves and keep following. The
> host's chord, section and order changes keep arriving and are shown simplified.
>
> - Store the follower's choice per entry as a personal setting on their set (for example
>   `followerSimplified` by `entryId`). It's never published and never overwritten by host
>   updates.
> - When a host update arrives, apply the host's content, then show the follower's choice
>   on top. The host's own `simplified` value is the starting point only until the
>   follower picks.
> - Remove **Simplify** from `useFollowEditGuard`'s guarded controls. Key and pad key stay
>   guarded.
> - Content docs already include `customSimplifiedSections` and `customSimplifiedFlow`. If
>   the host never simplified a song, the follower's view uses the normal automatic
>   simplification.
> - Tests: a host update keeps the follower's simplify choice, **Simplify** no longer opens
>   the dialog, and turning following off keeps the choice.
>
> Follows #45 (live set sharing, phase 2).


## 10. Revision: no follow toggle, copy on edit (decided 2026-11-06)

The owner found the follow on/off permutations confusing. Phase 2 isn't deployed, so there is
no stored data to migrate.

### D5 (replaces D2)

- A set opened from a live link is **always a live set**. There is no **Follow Host Edits**
  switch, no stop, no resume.
- Any edit to it first asks: editing makes **your own copy**. Confirming creates a normal set
  named "<name> - Copy" and opens it. The live set is left as it is. The edit that triggered
  the dialog is not applied to the copy; the musician makes it again there.
- A stopped or expired live set still asks before edits. It never changes state.
- Key, capo and **Simplify** changes count as edits. Column count and font size don't.
- **Create a copy** in the share window uses the same helper and the same "- Copy" name.
  Copying twice gives "- Copy" again; no numbering.

### Code changes

- Remove `followHost` from `Session` and `CreateSessionOptions`. "Live set" means
  `liveSourceId` is set. Both sync channels skip sets with a `liveSourceId`.
- Remove `stopFollowing`, `resumeFollowing`, `hasLocalEdits` and the resume dialog.
  `followLiveSet` runs for every set with a `liveSourceId`.
- `useFollowEditGuard`: the dialog's primary button makes the copy and navigates to it;
  **Cancel** keeps the live set (and flushes deferred host updates as now).
- New shared helper `createSetCopy(session)` in `sessionStore.ts`: deep copies the songs and
  per-song edits, adds " - Copy", no live fields.
- README, PrivacyPage and analytics: drop follow on/off wording and events.
- Section 9's follow-up issue still applies, minus "turning following off".

### UI: telling live sets from normal sets (green = live)

Green is only for "live". It pairs with the existing light and dark identities:

| Use | Light | Dark |
| --- | --- | --- |
| Live text and icon | `text-emerald-800` | `dark:text-emerald-400` |
| Live tint surface | `bg-emerald-100` | `dark:bg-emerald-400/10` |
| Live border | `border-emerald-300` | `dark:border-emerald-400/30` |
| Live dot | `bg-emerald-600` | `dark:bg-emerald-400` |

The follower's banner and chip change with the state, using the same steps in amber
(reconnecting); ended (stopped or expired) uses the raised surface, border and small shadow. These live in `liveToneClasses` in
`src/components/ui/index.tsx`.

Status is always in words too, never only colour. The pulsing dot stops under
`prefers-reduced-motion`. The song sheet (protected) is not touched.

**Set page, live set (follower):**

- A live banner with a **Radio** icon, coloured by state. The title is the indicator:
  - Live (green, pulsing dot): "Live set from host" / "You see the host's changes as they
    make them. Editing makes your own copy."
  - Reconnecting (amber): "Live set from host" / "Reconnecting… The host's latest changes
    will show once you're back online."
  - Ended (neutral grey): "Live set ended by host" (or "Live link expired") / "Set no longer
    updating. Create your own copy to edit."
  The title and line are the `role="status"` region. On the right, a **Create a copy**
  button (same as **Make a copy** in the edit dialog).
- A **Live set** chip next to the set name in the same state colour (**Live set ended** when
  ended).

**Set page, host sharing live:** `LiveShareChip` turns green with the words **Sharing live**
(amber **Not updating** stays as is).

**Landing page cards:**

- Live set (follower): green icon tile with **Radio** instead of the list icon, a green
  border, and a **Live set** pill under the name.
- Host set that is being shared live: a small green **Sharing live** pill; the rest of the card
  stays normal.
- Normal sets and copies: unchanged. Copies are told apart by the "- Copy" name.

### Done when

- No `followHost`, `stopFollowing`, `resumeFollowing` or `hasLocalEdits` left in `src/`.
- Tests: editing a live set creates "<name> - Copy" with the same songs and edits and opens
  it; the live set is unchanged; cancel keeps the live set; sync channels skip live sets;
  landing page shows the live pills.
- All checks pass; browser check in light and dark at 375 px and tablet width.
