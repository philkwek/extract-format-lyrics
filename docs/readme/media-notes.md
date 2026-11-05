# README media

## Screenshots

The screenshots were captured from the local Vite app on 5 November 2026 using Chrome at a 1280 × 870 viewport and 2× pixel density, with original demonstration songs seeded into an isolated browser's local storage. Both use the same two-song demo set, with lyrics written for the screenshots.

- `setlist-overview.png`: a two-song demo set in a three-column layout, light theme.
- `dark-mode.png`: the same set in dark mode.
- `lyrics-preview.png`: the in-app lyrics preview, retained as a separate asset.

## Hero

The README hero is a 5:1 banner at `docs/marketing/github-banner-dark.png` and `github-banner-light.png` (3000 × 600, rendered at 2× from `docs/marketing/github-banner.html`). GitHub shows the dark version to dark-mode readers through a `<picture>` element. It sets the headline as a chord sheet, with chords over "Chords, lyrics, your setlist. All in one place.", beside a Goodness of God excerpt whose lyric lines are placeholder bars because the lyrics are copyrighted. To change it, edit the HTML and re-render both themes with headless Chrome at `--window-size=1500,300 --force-device-scale-factor=2`.

`hero.svg` is the previous hero, kept as an alternative and no longer embedded in the README.

## User-recorded GIFs

Converted from the user's MP4 recordings at 1100px wide and 18 fps, keeping the complete duration. Each GIF loops and uses a custom palette. GIFs contain no audio.

These recordings predate the rename to Sets & Sheets and were cropped below the old app header. The workflows they show are unchanged; some control labels have since been shortened in the current UI.

- `getting-started-compact.gif`: getting started and opening a set.
- `simplify-transpose.gif`: changing key and simplifying chords.
- `edit-chord.gif`: editing a chord and adjusting its position.
- `arrange.gif`: reordering songs and sections.
- `ambient.gif`: updated recording showing ambient pad playback and the Custom Key selector for guitarists using a capo.
- `share-lyrics.gif`: generating a lyrics link and opening the shared viewer.

The recordings show existing songs in the actual app; they are not the original demo songs used in the screenshots.

## Earlier alternatives

- `getting-started.gif`: the first conversion, at the source resolution and 24 fps. The README uses the smaller version above.
- `transpose.gif` and `ambient-pad.gif`: earlier local demos assembled from successive settled UI screenshots. These are retained as alternatives and are no longer embedded in the README.
