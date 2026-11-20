# Frontend Styling & Theme Guidelines

This document outlines the design system, color palettes, typography, and component styling conventions for the Chord & Lyrics Sheet Extractor application.

---

## 1. Design Philosophy

- **Performance-Oriented:** Optimized for musicians and worship leaders performing on tablets or laptops in both bright daylight rehearsals and dimly lit stages.
- **Anti-Glare Dark Mode:** Uses low-contrast matte dark tones (`#1a1a1a`, `#1e1e1e`, soft text `#ededeb`) paired with a warm amber accent (`amber-400` / `amber-500`) to avoid screen glare and eye fatigue.
- **White Light Mode:** Uses a clean white primary canvas and main surfaces (`#FFFFFF`) paired with a deep sea blue accent (`#3368A0` / `#255283`) and soft sage borders (`#C8DFDB`). Only muted supporting panels retain a subtle neutral off-white to preserve hierarchy.
- **Monospace Alignment:** Chords sit on their own line with character-exact spacing directly above lyrics, demanding strict monospace formatting (`font-sheet`).

### Application chrome

The application shell and workflow controls use a restrained, Apple-inspired hierarchy without copying Apple branding. Translucency is limited to global chrome and overlay backdrops; forms, cards, and song-adjacent controls use solid surfaces so materials never stack and reduce legibility.

- Shared primitives in `src/components/ui/` provide buttons, icon buttons, segmented controls, status banners, surfaces, and accessible overlays.
- Controls use immediate CSS feedback. Interruptible spring motion is reserved for dialogs, drawers, and direct manipulation.
- Light mode keeps the white canvas and sea-blue identity. Dark mode retains matte charcoal surfaces and amber accents.
- `prefers-reduced-motion`, `prefers-reduced-transparency`, and `prefers-contrast: more` receive simplified motion and stronger, more opaque surfaces.
- UI icons come from the shared SVG icon set; status and meaning are never communicated by icon or colour alone.

### Protected musician-reading surface

The chord-and-lyric canvas is a separate, stability-critical design surface. UI refreshes must not change its width, padding, typography, colours, DOM structure, column calculations, wrapping, overflow detection, or editing semantics.

The protected implementation boundary includes:

- `src/components/SongSheet.tsx`
- `src/lib/songLayout.ts`
- `src/lib/lineSplit.ts`
- `src/lib/useFitToScreen.ts`
- `.font-sheet`, adaptive column CSS, section blocks, chord positioning, and split/merge controls

Session-page work should remain in surrounding title, action, tab, status, and overlay chrome. Any future song-canvas change requires its own musician-readability review and identical-viewport before/after comparison.

---

## 2. Color Palette Tokens

### Brand Palette (Tailwind CSS `@theme`)

Defined in [`src/index.css`](file:///Users/philkwek/CodeWorkspace/extract-format-lyrics/src/index.css):

| Token Name | Hex Code | Role |
| :--- | :--- | :--- |
| `--color-palette-deep` | `#3368A0` | Primary brand accent in Light Mode |
| `--color-palette-deep-dark` | `#255283` | Primary hover & active states in Light Mode |
| `--color-palette-mid` | `#66A3BF` | Secondary accents, highlights |
| `--color-palette-soft` | `#C8DFDB` | Borders, subtle dividers, badge backgrounds |
| `--color-palette-light` | `#FFFFFF` | Light mode primary page canvas |

---

### Chrome tokens and utilities

Application chrome uses the `--ui-*` tokens in `src/index.css`. Each one is defined once under
`:root` and once under `:root.dark`, and `@theme inline` turns it into a Tailwind colour, so one
class covers both modes. Don't write a light/dark hex pair in a `.tsx` file; raw hex belongs
only in `src/index.css` and the protected song sheet.

| Element | Light | Dark | Class |
| :--- | :--- | :--- | :--- |
| **Page canvas** | `#FFFFFF` | `#1A1A1A` | `bg-ui-canvas` |
| **Card / surface** | `#FFFFFF` | `#1E1E1E` | `bg-ui-surface` (or the `Surface` primitive) |
| **Raised panel, popover** | `#FFFFFF` | `#242424` | `bg-ui-surface-raised` |
| **Muted sub-panel** | `#FAFAFA` | `#202020` | `bg-ui-surface-muted` |
| **Borders** | `rgba(74,105,106,0.2)` | `rgba(255,255,255,0.09)` | `border-ui-border` |
| **Hover / emphasised borders** | sea blue 32% | amber 30% | `border-ui-border-strong` |
| **Primary text** | `#171717` | `#EDEDEB` | `text-ui-text` |
| **Muted text** | `#686865` | `#A5A5A0` | `text-ui-text-muted` |
| **Accent fill** | `#3368A0` | `#F59E0B` (amber-500) | `bg-ui-accent` |
| **Accent hover, accent text and links** | `#255283` | `#FBBF24` (amber-400) | `hover:bg-ui-accent-strong`, `text-ui-accent-strong` |
| **Text on the accent** | `#FFFFFF` | `#16120A` | `text-ui-on-accent` |
| **Focus ring** | sea blue 36% | amber 34% | `ring-ui-focus` |

Buttons, fields, banners and dialogs use the primitives in `src/components/ui/` and the
`.ui-*` classes rather than these utilities directly. Status colours (success, warning,
error) live in `.ui-status--*` and the `success`/`danger` button variants.

The song sheet keeps its own colours (chord text is `text-[#3368A0] dark:text-amber-400`);
see section 1.

Switched-on toggles use `ui-button--pressed`. The `@media (pointer: coarse)` block raises
small controls to a 44px touch target on touch screens.

---

## 3. Typography Guidelines

- **UI & Controls Font:** `'DM Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
  - Body copy: `text-sm text-ui-text`
  - Section headers: `text-lg font-bold text-ui-text`
  - Field labels / Metadata: `text-[11px] font-semibold uppercase tracking-wider text-ui-text-muted`
- **Sheet & Musical Notation Font (`.font-sheet`):**
  - Definition: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
  - Purpose: Guarantees character-grid alignment so chords sit exactly above their target lyric syllable.
  - Sizing: Dynamically computed down to `11px` via `useFitToScreen.ts` to fit screens without vertical scrolling.

---

## 4. Multi-Column Sheet Layout Rules

Defined in [`src/index.css`](file:///Users/philkwek/CodeWorkspace/extract-format-lyrics/src/index.css):

```css
.columns-1 { column-count: 1; }
.columns-2 { column-count: 2; column-gap: 2rem; column-fill: balance; }
.columns-3 { column-count: 3; column-gap: 2rem; column-fill: balance; }

.break-inside-avoid {
  break-inside: avoid-column;
  page-break-inside: avoid;
}
```

- Every verse, chorus, or section block must include `break-inside-avoid` to prevent mid-verse column splitting.
- Columns balance automatically to fit landscape tablet viewports.

---

## 5. Reusable Component Patterns

Use the primitives in `src/components/ui/` first: `Button`, `IconButton`, `SegmentedControl`,
`Switch`, `Surface`, `StatusBanner`, `Toast`, `OverlayDialog`, and `useModalFocus` for any custom dialog
or drawer. Form fields use the `ui-field` class (`ui-field--sm` for compact ones). Colours use
the `ui-*` utilities from section 2. Hex colour classes in `.tsx` files are allowed only in the
protected song sheet; `srcTest/designTokens.test.ts` fails on new ones.

### A. Modals & Dialogs

Use `OverlayDialog`. It supplies the blurred backdrop, the solid surface, the header, the focus
trap, and overscroll containment. Don't rebuild one with raw `<div>`s.

### B. Buttons

Use `Button` with the `primary`, `secondary`, `ghost`, `danger` or `success` variant. Add
`pressed` for a toggle that is switched on. Use `IconButton` for a square icon-only control.

### C. Form Inputs & Textareas

Use the `ui-field` class (`ui-field--sm` for compact fields) instead of hand-built borders and
focus rings.

### D. Mode Switchers & Tabs

Use `SegmentedControl`. It handles the active state, labels, and `aria-pressed`.

---

## 6. Theme Switching Mechanism

- Persisted in `localStorage` under key `app_theme` with values `light`, `dark`, or `system`.
- `system` follows the device via `prefers-color-scheme` and reacts live to OS theme changes while selected.
- `useThemeMode` (`src/lib/useThemeMode.ts`) is the shared hook for reading the mode, resolving the effective theme, and changing it. `ThemeToggle` renders the header and lyrics-view controls and cycles through device, light, and dark modes.
- Applies `.dark` class to `document.documentElement` (`<html>`).
- Dispatches a custom window event `app_theme_changed` with `{ mode, isDark }` so decoupled UI modules update synchronously.
- Tailwind v4 configured with:
  ```css
  @variant dark (&:where(.dark, .dark *));
  ```
