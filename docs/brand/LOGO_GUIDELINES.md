# Chord Sheets — Logo & Brand Guidelines

## 1. The Mark ("Overline Sheet")
The **Chord Sheets** identity combines a pictorial symbol (**Overline Sheet**) with an outlined geometric sans-serif wordmark (`Avenir Next DemiBold`, custom-tracked and converted to pure vector paths).

- **Concept**: A rounded song sheet (`rx = 28` on a `256 × 256` grid) with a `45°` top-right dog-ear fold separated by an exact `16`-unit orthogonal negative-space channel. Inside the sheet, negative-space pill cutouts depict the app's defining typographic grammar: **chord badges perched directly above lyric bars** across two stanzas.
- **Small-Size / Favicon Cut (`≤ 24 px`)**: At `16 × 16 px` and `24 × 24 px`, use [`chord-sheets-symbol-small.svg`](file:///Users/philkwek/CodeWorkspace/extract-format-lyrics/docs/brand/chord-sheets-symbol-small.svg) (or `/favicon.svg`), which simplifies the interior to a single bold chord-over-lyric stanza so every cutout and wall remains `≥ 1.25–2 px` wide.
- **Reversed Cut (White on Dark)**: When placing the white mark on dark surfaces, use [`chord-sheets-symbol-white.svg`](file:///Users/philkwek/CodeWorkspace/extract-format-lyrics/docs/brand/chord-sheets-symbol-white.svg), which expands the interior cutouts by `1.5` units (`~2%`) to counteract optical halation/irradiation.

---

## 2. Master Files & Variants

### Master SVGs (`docs/brand/`)
| File | ViewBox | Usage |
| :--- | :--- | :--- |
| [`chord-sheets-symbol.svg`](file:///Users/philkwek/CodeWorkspace/extract-format-lyrics/docs/brand/chord-sheets-symbol.svg) | `0 0 256 256` | Primary standalone symbol in Sheet Slate Blue (`#3368A0`) for sizes `≥ 28 px` |
| [`chord-sheets-symbol-small.svg`](file:///Users/philkwek/CodeWorkspace/extract-format-lyrics/docs/brand/chord-sheets-symbol-small.svg) | `0 0 256 256` | Simplified 1-stanza cut for `16 px – 24 px` favicons and compact badges |
| [`chord-sheets-symbol-amber.svg`](file:///Users/philkwek/CodeWorkspace/extract-format-lyrics/docs/brand/chord-sheets-symbol-amber.svg) | `0 0 256 256` | Dark-mode primary symbol in Stage Amber (`#F59E0B`) |
| [`chord-sheets-symbol-white.svg`](file:///Users/philkwek/CodeWorkspace/extract-format-lyrics/docs/brand/chord-sheets-symbol-white.svg) | `0 0 256 256` | Irradiation-compensated reversed white (`#FFFFFF`) symbol |
| [`chord-sheets-symbol-black.svg`](file:///Users/philkwek/CodeWorkspace/extract-format-lyrics/docs/brand/chord-sheets-symbol-black.svg) | `0 0 256 256` | One-colour black (`#111111`) symbol for print and monochrome contexts |
| [`chord-sheets-horizontal.svg`](file:///Users/philkwek/CodeWorkspace/extract-format-lyrics/docs/brand/chord-sheets-horizontal.svg) | `0 0 720 180` | Primary horizontal lockup (symbol + outlined wordmark) for headers & banners |
| [`chord-sheets-stacked.svg`](file:///Users/philkwek/CodeWorkspace/extract-format-lyrics/docs/brand/chord-sheets-stacked.svg) | `0 0 480 356` | Centered stacked lockup for square/vertical placements and splash screens |
| [`chord-sheets-wordmark.svg`](file:///Users/philkwek/CodeWorkspace/extract-format-lyrics/docs/brand/chord-sheets-wordmark.svg) | `0 0 504 104` | Standalone outlined wordmark (`Chord` in `#1B1916`, `Sheets` in `#3368A0`) |

### Production Exports & Web Icons (`docs/brand/exports/` & `public/`)
- **Browser & PWA Icons**: `favicon.svg` (light/dark adaptive via `prefers-color-scheme`), `favicon.ico` (`16/32/48` multi-size), `apple-touch-icon.png` (`180×180`), `icon-192.png`, `icon-512.png`, `maskable-512.png`, and `site.webmanifest`.
- **Raster Lockups & Symbols**: `64 px`, `256 px`, and `512 px` transparent PNGs across all colourways (`black`, `white`, `mono-3368a0`, `mono-f59e0b`, `app-icon`, `square`, `favicon`).

---

## 3. Clear Space & Minimum Size

- **Clear Space**: Maintain a minimum clear-space margin of **$0.25 \times H$** (where $H$ is the height of the sheet symbol, or the cap-height of `Chord` in wordmark-only use) on all four sides. No borders, text, or UI controls may intrude into this zone.
- **Minimum Sizes**:
  - **Two-stanza primary symbol (`chord-sheets-symbol.svg`)**: `28 px` tall digital / `7 mm` print.
  - **One-stanza small symbol (`chord-sheets-symbol-small.svg`)**: `16 px` tall digital / `4 mm` print.
  - **Horizontal lockup (`chord-sheets-horizontal.svg`)**: `24 px` tall (`96 px` wide) digital / `20 mm` wide print.
  - **Stacked lockup (`chord-sheets-stacked.svg`)**: `48 px` tall digital / `15 mm` tall print.

---

## 4. Colour Palette

Aligned directly with the site's light-mode parchment theme and dark-mode stage theme in [`src/index.css`](file:///Users/philkwek/CodeWorkspace/extract-format-lyrics/src/index.css):

| Swatch Name | Hex | RGB | Role |
| :--- | :--- | :--- | :--- |
| **Sheet Slate Blue** | `#3368A0` | `rgb(51, 104, 160)` | Light-mode primary brand mark, chord badges, and `Sheets` wordmark accent |
| **Deep Chord Blue** | `#255283` | `rgb(37, 82, 131)` | Interactive hover / pressed accent in light mode |
| **Stage Amber** | `#F59E0B` | `rgb(245, 158, 11)` | Dark-mode primary brand mark & stage chord badge highlight |
| **Warm Stage Ink** | `#1B1916` | `rgb(27, 25, 22)` | Primary wordmark ink (`Chord`) on light backgrounds |
| **Warm Parchment** | `#F8F6F1` | `rgb(248, 246, 241)` | Preferred light background surface |
| **Stage Charcoal** | `#16120A` | `rgb(22, 18, 10)` | Preferred dark-mode background surface |
| **Pure Black / White** | `#111111` / `#FFFFFF` | `17,17,17` / `255,255,255` | One-colour monochrome and reversed applications |

### Background Pairing Rules
- **Light backgrounds (`#FFFFFF`, `#F8F6F1`, `#F2EFE9`)**: Use the primary `#3368A0` symbol and two-tone lockup (`#1B1916` + `#3368A0`).
- **Dark backgrounds (`#16120A`, `#1E1A16`, `#111111`)**: Use the Stage Amber (`#F59E0B`) symbol or the irradiation-compensated Reversed White (`#FFFFFF`) symbol.
- **Brand-coloured tiles (`#3368A0` or `#F59E0B` containers)**: Use the Reversed White (`#FFFFFF`) symbol on `#3368A0` tiles, and Warm Stage Ink (`#16120A`) on `#F59E0B` tiles (matching the app navbar badge in [`src/App.tsx`](file:///Users/philkwek/CodeWorkspace/extract-format-lyrics/src/App.tsx)).

---

## 5. Misuse (Don'ts)
1. **Do not** stretch, skew, or alter the aspect ratio of the symbol or lockup.
2. **Do not** fill the interior chord/lyric cutouts with a third colour—they must remain true negative space (`fill-rule="evenodd"`) so the background surface shows through.
3. **Do not** use the 2-stanza master symbol below `24 px`; always switch to `chord-sheets-symbol-small.svg` for `16 px` favicons.
4. **Do not** add drop shadows, outer glows, bevels, or gradients to the vector paths.
5. **Do not** re-typeset `"Chord Sheets"` in live system fonts over the lockup; always use the outlined master SVGs.
