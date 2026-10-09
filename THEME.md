# Frontend Styling & Theme Guidelines

This document outlines the design system, color palettes, typography, and component styling conventions for the Chord & Lyrics Sheet Extractor application.

---

## 1. Design Philosophy

- **Performance-Oriented:** Optimized for musicians and worship leaders performing on tablets or laptops in both bright daylight rehearsals and dimly lit stages.
- **Anti-Glare Dark Mode:** Uses low-contrast matte dark tones (`#101010`, `#1a1a1a`, soft text `#e5e5e5`) paired with a warm amber accent (`amber-400` / `amber-500`) to avoid screen glare and eye fatigue.
- **Warm Paper Light Mode:** Uses a warm parchment/cream background (`#F2EFE7`) paired with a deep sea blue accent (`#3368A0` / `#255283`) and soft sage borders (`#C8DFDB`) for high readability without harsh white glare.
- **Monospace Alignment:** Chords sit on their own line with character-exact spacing directly above lyrics, demanding strict monospace formatting (`font-sheet`).

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
| `--color-palette-light` | `#F2EFE7` | Light mode page background (parchment/cream) |

---

### Light vs. Dark Mode Mapping

| Element | Light Mode | Dark Mode | Tailwind Classes |
| :--- | :--- | :--- | :--- |
| **Page Canvas** | `#F2EFE7` | `#101010` | `bg-[#F2EFE7] dark:bg-[#101010]` |
| **Card / Surface** | `#FFFFFF` | `#1A1A1A` | `bg-white dark:bg-[#1a1a1a]` |
| **Modal / Dialog** | `#FFFFFF` | `#1A1A1A` | `bg-white dark:bg-[#1a1a1a]` |
| **Elevated Sub-panel** | `#FCFBFA` / `neutral-50` | `#151515` | `bg-neutral-50/60 dark:bg-[#151515]` |
| **Primary Borders** | `#C8DFDB` | `#282828` | `border-[#C8DFDB] dark:border-[#282828]` |
| **Input Borders** | `neutral-300` | `#282828` | `border-neutral-300 dark:border-[#282828]` |
| **Primary Text** | `neutral-900` (`#171717`) | `#E5E5E5` | `text-neutral-900 dark:text-[#e5e5e5]` |
| **Muted / Subtitle Text** | `neutral-500` / `neutral-600` | `#999999` | `text-neutral-500 dark:text-[#999999]` |
| **Primary Button** | `#3368A0` (hover `#255283`) | `amber-500` (hover `amber-400`) | `bg-[#3368A0] hover:bg-[#255283] text-white dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-black` |
| **Chord Text** | `#3368A0` | `amber-400` | `text-[#3368A0] dark:text-amber-400 font-bold` |
| **Active Tab Pill** | `#3368A0` / `#3368A0/15` | `amber-500` / `amber-500/20` | `bg-[#3368A0]/15 text-[#255283] border-[#3368A0]/40 dark:bg-amber-500/20 dark:text-amber-300` |
| **Success Action** | `emerald-600` | `emerald-500` | `bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-500 dark:text-black` |
| **Error Banner** | `red-50` / `border-red-200` | `red-950/60` / `border-red-800` | `bg-red-50 border-red-200 text-red-800 dark:bg-red-950/60 dark:border-red-800 dark:text-red-200` |

---

## 3. Typography Guidelines

- **UI & Controls Font:** `'DM Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
  - Body copy: `text-sm text-neutral-800 dark:text-[#e5e5e5]`
  - Section headers: `text-lg font-bold text-neutral-900 dark:text-[#e5e5e5]`
  - Field labels / Metadata: `text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-[#999999]`
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

### A. Modals & Dialogs

Used in [`ShareModal.tsx`](file:///Users/philkwek/CodeWorkspace/extract-format-lyrics/src/components/ShareModal.tsx) and [`UploadSheetModal.tsx`](file:///Users/philkwek/CodeWorkspace/extract-format-lyrics/src/components/UploadSheetModal.tsx):

```tsx
/* Backdrop overlay */
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">

  /* Modal container card */
  <div className="w-full max-w-4xl bg-white dark:bg-[#1a1a1a] border border-[#C8DFDB] dark:border-[#282828] rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
    
    /* Header */
    <div className="flex items-center justify-between border-b border-[#C8DFDB] dark:border-[#282828] px-6 py-4 bg-white dark:bg-[#1a1a1a]">
      <h2 className="text-lg font-bold text-neutral-900 dark:text-[#e5e5e5]">Modal Title</h2>
      <button className="text-neutral-400 hover:text-neutral-700 dark:text-[#999999] dark:hover:text-[#e5e5e5] p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-[#252525] transition cursor-pointer">
        ✕
      </button>
    </div>

    /* Content Body */
    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-neutral-50/60 dark:bg-[#151515]">
      {/* Content */}
    </div>

    /* Footer Actions */
    <div className="border-t border-[#C8DFDB] dark:border-[#282828] px-6 py-4 flex items-center justify-between bg-white dark:bg-[#1a1a1a]">
      {/* Action buttons */}
    </div>
  </div>
</div>
```

---

### B. Action Buttons & Pills

#### 1. Primary Action Button
```tsx
<button className="px-5 py-2 rounded-lg text-xs font-semibold bg-[#3368A0] hover:bg-[#255283] text-white dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-black transition shadow-xs cursor-pointer">
  Save Changes
</button>
```

#### 2. Header / Secondary Action Bar Pill (e.g. `+ Add song`, `Arrange`, `Upload sheet`)
```tsx
<button className="text-xs bg-white/80 hover:bg-[#C8DFDB]/30 border border-[#C8DFDB] dark:bg-[#1a1a1a] dark:hover:bg-[#252525] text-neutral-800 dark:text-[#e5e5e5] dark:border-[#282828] px-3 py-1.5 rounded transition-colors cursor-pointer whitespace-nowrap shadow-2xs flex items-center gap-1.5">
  <span>📄</span>
  <span>Upload sheet</span>
</button>
```

#### 3. Success / Confirm Button
```tsx
<button className="px-5 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-black transition shadow-xs cursor-pointer">
  Import to Setlist
</button>
```

#### 4. Ghost / Cancel Button
```tsx
<button className="px-4 py-2 rounded-lg text-xs font-medium text-neutral-600 dark:text-[#999999] hover:text-neutral-900 dark:hover:text-[#e5e5e5] hover:bg-neutral-100 dark:hover:bg-[#252525] transition cursor-pointer">
  Cancel
</button>
```

---

### C. Form Inputs & Textareas

```tsx
<input
  type="text"
  className="w-full bg-neutral-50 dark:bg-[#101010] border border-neutral-300 dark:border-[#282828] rounded px-3 py-2 text-xs text-neutral-900 dark:text-[#e5e5e5] placeholder:text-neutral-400 dark:placeholder:text-[#666666] focus:outline-none focus:border-[#3368A0] dark:focus:border-amber-500"
/>
```

---

### D. File Dropzones

```tsx
<div className="border-2 border-dashed border-[#C8DFDB] hover:border-[#3368A0] dark:border-[#282828] dark:hover:border-amber-500/70 bg-white hover:bg-neutral-50 dark:bg-[#1a1a1a]/60 dark:hover:bg-[#1a1a1a] transition rounded-xl p-8 text-center cursor-pointer flex flex-col items-center justify-center gap-3 shadow-xs">
  <div className="w-12 h-12 rounded-full bg-[#3368A0]/10 dark:bg-amber-500/10 flex items-center justify-center text-[#3368A0] dark:text-amber-400 text-2xl">
    📄
  </div>
  <p className="text-sm font-medium text-neutral-800 dark:text-[#e5e5e5]">Click or drop files here</p>
  <p className="text-xs text-neutral-500 dark:text-[#999999]">Supported formats: .pdf, .png, .jpg</p>
</div>
```

---

### E. Mode Switchers & Tabs

```tsx
/* Tab Container */
<div className="flex bg-neutral-100 dark:bg-[#101010] p-1 rounded-lg border border-neutral-200 dark:border-[#282828]">

  /* Active Tab */
  <button className="px-3 py-1.5 rounded-md text-xs font-semibold bg-[#3368A0] text-white shadow-xs dark:bg-amber-500 dark:text-black">
    Paste Links
  </button>

  /* Inactive Tab */
  <button className="px-3 py-1.5 rounded-md text-xs font-semibold text-neutral-600 dark:text-[#999999] hover:text-neutral-900 dark:hover:text-[#e5e5e5]">
    Search Songs
  </button>
</div>
```

---

## 6. Theme Switching Mechanism

- Persisted in `localStorage` under key `theme:dark` (`true` or `false`).
- Applies `.dark` class to `document.documentElement` (`<html>`).
- Dispatches a custom window event `app_theme_changed` so decoupled UI modules update synchronously.
- Tailwind v4 configured with:
  ```css
  @variant dark (&:where(.dark, .dark *));
  ```
