# Usage tracking

The site uses GA4 through the Firebase browser SDK. It tracks visits and a small set of actions, with no song content or private link IDs in event data. Tracking starts on arrival on configured production hosts. Visitors can turn it off at **Privacy and usage tracking**, linked at the bottom of every page.

## Existing Google configuration

Verified with Firebase CLI on 17 October 2026:

- Project: `extract-format-lyrics`
- Web app: `chordsheet-generator`
- App ID: `1:17000575617:web:af253b7fcd315fe466d380`
- Measurement ID: `G-RG5JNFFQVW`
- GA4 property: `extract-format-lyrics` (`558171670`); web stream ID: `16093125328`

Console checks completed on the same date: Enhanced Measurement is off, there are no connected site tags, and Google Signals is off. The four event-scoped dimensions and three Standard-unit metrics listed below have been created and verified. The five GitHub Actions variables have been configured; collection is enabled for future production builds on the two Firebase production hosts. No deployment or live event receipt has been verified yet.

Reuse this app and stream. Do not create another property or add a second Google tag or Tag Manager installation. To retrieve the public browser configuration, run:

```sh
firebase apps:sdkconfig WEB 1:17000575617:web:af253b7fcd315fe466d380 --project extract-format-lyrics
```

These browser identifiers are public configuration. Never substitute a service account credential or private key.

## Setup reference for future changes

1. Open [Firebase integrations](https://console.firebase.google.com/project/extract-format-lyrics/settings/integrations), then open the linked Google Analytics property. Confirm the web stream uses `G-RG5JNFFQVW`.
2. In **Admin → Data streams → web stream**, turn **Enhanced Measurement off entirely**. The app sends page views manually and excludes raw URLs. Setting `send_page_view: false` in code alone does not disable history-based Enhanced Measurement. Keep other tags and connected destinations from sending duplicate or unsanitized events.
3. Leave Google Signals and advertising links/personalization off. Check the property's data retention and access settings against your needs.
4. Under **Admin → Custom definitions**, add event-scoped dimensions for `entry_page`, `outcome`, `method`, and `operation`. Add event-scoped custom metrics for `result_count`, `imported_count`, and `song_count`, using Standard units.
5. Under the repository's **Settings → Secrets and variables → Actions → Variables**, set the variables below. Set `VITE_ANALYTICS_ENABLED=true` only after the console checks are complete.

| Variable | Value |
| --- | --- |
| `VITE_ANALYTICS_ENABLED` | `true` (console setup verified); set `false` to disable future builds |
| `VITE_ANALYTICS_HOSTNAMES` | `extract-format-lyrics.web.app,extract-format-lyrics.firebaseapp.com` plus any confirmed production custom domains |
| `VITE_FIREBASE_API_KEY` | `apiKey` from the Firebase web configuration |
| `VITE_FIREBASE_APP_ID` | `1:17000575617:web:af253b7fcd315fe466d380` |
| `VITE_FIREBASE_MEASUREMENT_ID` | `G-RG5JNFFQVW` |

The production workflow supplies `VITE_FIREBASE_PROJECT_ID=extract-format-lyrics`. Vite embeds these variables during the build: changing an Actions variable requires a new production build/deployment. Local development is always disabled, and PR preview builds receive no Analytics configuration. Production builds also require an exact hostname match. Missing or invalid required configuration disables collection without affecting the site.

For local configuration, copy `.env.example` to `.env.local`; keep tracking disabled. To test collection on a non-production host, use a separate test stream and a production-mode build with that hostname explicitly allowlisted. Never broaden the production hostname list to preview wildcards.

## Events

| Event | Trigger and details |
| --- | --- |
| `page_view` | Initial page and changes between grouped page types; fixed title and sanitized URL/referrer |
| `song_search` | Completed search: `entry_page=home|search`, `outcome=success|error`, `result_count` |
| `song_import` | Completed import/save, or failed extraction/save: `method=search|pasted_link|upload`, `outcome=success|partial|error`, `imported_count` |
| `set_shared` | Share link created successfully: `song_count` |
| `shared_set_imported` | Shared-set import completed or failed: `outcome=success|error`, `imported_count` |
| `lyrics_published` | Publish/update completed or failed: `operation=create|update`, `outcome=success|error`, `song_count` |

Search and pasted-link imports work from both the home and search pages. Uploads work from the home page and an existing set. Cached imports count like freshly fetched imports. Failed items in a pasted batch do not count as imported songs; a mixed result is `partial`. Validating empty/invalid-only input is not an import attempt. Chart extraction is not a successful import until the user confirms and the songs are saved.

Pages are grouped as `/`, `/search`, `/session`, `/s`, `/lyrics`, `/privacy`, and `/other`. Song selection and different set/link IDs within one group do not send additional page views. Query strings and hashes are excluded. Referrers retain only an external origin or a grouped internal page. Campaign query parameters are deliberately excluded; acquisition uses referring domains and GA's available attribution rather than custom UTM reporting.

Custom payloads allow only fixed values and nonnegative integer counts. They exclude song text/titles, search terms, filenames, source URLs, set names, link/session IDs, API keys, and raw errors. Config-level sanitized page values also cover automatically collected SDK events. This relies on keeping Enhanced Measurement disabled in the console.

## Verify and read reports

1. After configuration and deployment, open the actual production host in a browser without blockers. Enable Google Analytics Debugger for this browser session, then check **Admin → DebugView**. Debug mode is not enabled for ordinary visitors by the app.
2. Inspect Analytics collection requests in browser developer tools. Confirm that `page_location`, `page_title`, and `page_referrer` contain only the allowed values, including on automatic events such as engagement. No private link IDs or query strings should appear.
3. Navigate home → search → set → shared lyrics. Each group transition should produce one `page_view`; changing selected songs or rerendering the page should not. Confirm each action above, including cached and mixed imports.
4. Turn Usage tracking off. Confirm no further collection requests, including engagement events. Reload and repeat an action: it must remain off. Re-enable it and confirm collection resumes once.
5. Use **Reports → Realtime** for live receipt, **Acquisition** for traffic sources, **Engagement → Pages and screens** for grouped pages, and **Events** or an Exploration for the actions and their registered dimensions/metrics. Report navigation names can vary by property. Custom definitions can take 24–48 hours to appear in reporting.

Opt-out is specific to the current browser. It stops future collection and cancels pending app events; it does not delete historical data or existing Analytics cookies. If browser storage is blocked, the choice applies in memory until reload. Google Analytics is browser-based and can be blocked; visitor counts are estimates, not an audit log of backend requests.

Implementation checks and mocked tests do not establish live collection. Record production verification separately after console setup and deployment.

References: [Firebase setup](https://firebase.google.com/docs/analytics/web/get-started), [page views](https://developers.google.com/analytics/devguides/collection/ga4/views), [privacy controls](https://developers.google.com/tag-platform/security/guides/privacy), [custom dimensions](https://support.google.com/analytics/answer/14239696).
