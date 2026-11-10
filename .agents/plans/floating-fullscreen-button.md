# Floating Full Screen Button — Implementation Plan

Status: Implemented
Scope: the setlist session page (`/session/:sessionId`), normal mode only. The shared lyrics
view (`/lyrics/:shortId`) and full-screen mode itself are out of scope.

## 1. Problem

The **Full screen** button lives in the set title bar, next to **Share** and **Add Song**
(`src/pages/SessionPage.tsx`, around line 1387). Once the user scrolls down to read the chord
sheet, that bar leaves the viewport and the control is out of reach. The user should not have
to scroll back to the top mid-song to switch to full screen.

The frontend full-screen mode already exists. This plan only adds a second, floating entry
point that appears while the original button is out of view.

## 2. Behaviour

- While the in-page **Full screen** button is visible, nothing changes.
- When the user scrolls and that button is no longer visible, a circular **Full screen**
  button fades into the bottom-right corner of the viewport as a fixed element.
- Scrolling back until the in-page button is visible again removes the floating button.
- The floating button never appears in full-screen mode. The top bar's **Exit full screen**
  control is already always visible there.
- Both buttons run the same `handleEnterFullScreen` path, so the existing behaviour
  (close edit modes, hide chrome, lock page scroll, remember the trigger) is unchanged.
- The floating button arrives and leaves on a short spring (opacity, scale and a small
  vertical offset) so the corner feels alive without pulling attention from the chord sheet.
  No layout shift and no change to document scroll position.

### 2.1 What counts as "no longer visible"

Check the in-page button's position directly on scroll and resize, not with an
`IntersectionObserver`:

- A passive `scroll` listener (plus `resize`) schedules one `requestAnimationFrame`. In that
  frame, read the sticky header's bottom edge and the in-page button's bottom edge.
- Show while `buttonRect.bottom <= headerBottom`. That is exactly the point where the button
  is fully hidden behind the header, not merely out of the viewport.
- A zero-height rect (jsdom, or an element with no layout) counts as "not hidden", so the
  floating button never appears spuriously.
- Run the check once when the session loads, so a page restored mid-scroll is correct
  immediately.
- Coalesce with a single frame handle, so a fast scroll or momentum only measures once per
  frame. No measurements on render.
- If the button is below the viewport, its bottom is greater than the header bottom, so the
  floating button stays hidden.

The direct read avoids two problems the original `IntersectionObserver` version had: the
negative top `rootMargin` and `boundingClientRect.top < 0` used different coordinate systems
(leaving a dead zone where neither button was reachable), and IO callbacks are delivered
asynchronously, so a quick scroll back to the top left the floating button visible for
several hundred milliseconds.

### 2.2 Placement and styling

- Fixed, bottom-right: `right-4 bottom-4`, `sm:right-6 sm:bottom-6`, `z-40`. This matches the
  existing section tip. It sits below dialogs/drawers (`z-50`), so an open modal still covers
  it.
- 48 × 48 px circle: comfortably above the 44 px touch minimum. `Maximize2` at `18px`.
- Use the shared `IconButton` (`variant="secondary"`, `size="icon"` internally) so it inherits
  the existing hover, active and focus-visible behaviour.
- Add one shared CSS class, `.ui-button--floating`, after `.ui-button--icon` in
  `src/index.css`:
  - `width: 3rem; height: 3rem; border-radius: 9999px;`
  - `box-shadow: var(--ui-shadow-lg);` so it reads as a floating control over the sheet.
  - Token-based colours come from `ui-button--secondary`; both themes work with no extra
    `dark:` classes. The existing `prefers-contrast: more` rule targets
    `.ui-button--secondary` and removes the shadow, leaving the border.
- Accessible name: `Full screen`. Tooltip/title: `Fill the window with this chord sheet`
  (same as the in-page button).
- Add `data-floating-fullscreen-trigger` so focus restoration can find it unambiguously.
- No safe-area change: the viewport meta does not use `viewport-fit=cover`, and the section
  tip already uses the same bottom offset.

### 2.3 Collision with the "Customize sections" tip

The onboarding tip is also fixed bottom-right (`src/pages/SessionPage.tsx`, around line 1846)
and stays until dismissed. A naive floating button would sit on top of it.

- Move the tip and the floating button into one shared fixed bottom-right stack:
  `fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6`.
- Wrapper: `pointer-events-none`; the tip and button each get `pointer-events-auto`.
- The tip keeps its `ui-surface ui-surface--elevated`, widths and content; it only loses its
  own `fixed bottom-4 right-4 z-40` classes.
- Order: tip first, button second, so the button occupies the corner and the tip stacks above
  it. When only one is present it sits in the same corner as today.
- Render the wrapper only when the tip or the floating button is present, to avoid an empty
  fixed node.

The live-set host toast is bottom-centre and transient (5 s); a brief overlap on a narrow
phone is accepted. Revisit only if it proves distracting.

### 2.4 Entering and exiting full screen

- `handleEnterFullScreen` is the same handler. The floating button passes
  `event.currentTarget`, which is stored in `fullScreenTriggerRef` as today.
- Reset the visible state when entering full screen. The full-screen shell changes the page
  root to `100dvh`, so the document height collapses and the page returns to the top on exit.
  Rendering the floating button on exit would flash it at the top and then lose focus when the
  scroll check hid it again.
- On exit, focus returns to the in-page **Full screen** button via the existing
  `[data-fullscreen-trigger]` fallback. The page is already at the top, so the focus ring is
  visible and the page does not jump.
- If the user entered full screen from the top bar, nothing changes.
- `Escape` behaviour, scroll lock and chrome hiding are unchanged.

### 2.5 Accessibility and motion

- It is a real `<button>` with a visible focus ring from the shared button styles, reachable
  by keyboard at the end of the page's tab order.
- Motion follows the Apple-style language already used by the dialogs and popovers: a short,
  critically damped spring (`segmentedSpring`, no bounce) that enters from
  `opacity: 0, scale: 0.9, y: 10` and exits along the same path at `scale: 0.94, y: 8`.
  It is interruptible, so scrolling back and forth mid-animation reverses smoothly.
- `prefers-reduced-motion: reduce` swaps the spring and spatial movement for the shared
  160 ms opacity cross-fade. Nothing moves; the control still appears and disappears.
- No `aria-live` announcement: this is a duplicate of an existing control, not new
  information.

## 3. Implementation

### 3.1 State and effect

Add near the other full-screen state:

```tsx
const [showFloatingFullScreen, setShowFloatingFullScreen] = useState(false)
```

The trigger is found through the existing `data-fullscreen-trigger` attribute (the shared
`Button` does not forward refs):

```tsx
useEffect(() => {
  if (isFullScreen) return

  let frame = 0
  const update = () => {
    frame = 0
    const trigger = document.querySelector<HTMLElement>('[data-fullscreen-trigger]')
    const headerBottom = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0
    const rect = trigger?.getBoundingClientRect()
    const hidden = rect !== undefined && rect.height > 0 && rect.bottom <= headerBottom
    setShowFloatingFullScreen(hidden)
  }
  const schedule = () => {
    if (frame) return
    frame = window.requestAnimationFrame(update)
  }

  update()
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
  return () => {
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    if (frame) window.cancelAnimationFrame(frame)
  }
}, [isFullScreen, hasSession])
```

The trigger is found through the existing `data-fullscreen-trigger` attribute (the shared
`Button` does not forward refs). It is queried fresh in each update, so a replaced button is
still tracked.

`hasSession` (`Boolean(session)`) is in the dependency list because the set title bar is
rendered only after the session finishes loading. Without it, the initial check would run
against an empty page. Session edits do not change the boolean, so the effect is not
recreated on every save.

No other effect reads or writes `showFloatingFullScreen`, so there is no state feedback loop.
Entering full screen resets it to `false` (see 2.4).

### 3.2 Markup

Replace the standalone tip block with the shared stack. The wrapper stays mounted in normal
mode so the exit animation can finish (simplified):

```tsx
{!isFullScreen && (
  <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
    {showTip && (
      <aside
        role="complementary"
        aria-label="Section customization tip"
        className="ui-surface ui-surface--elevated pointer-events-auto flex max-w-xs flex-col gap-2.5 p-3.5 sm:max-w-sm"
      >
        {/* existing tip content unchanged */}
      </aside>
    )}

    <AnimatePresence>
      {showFloatingFullScreen && (
        <motion.div
          key="floating-full-screen"
          className="pointer-events-auto"
          {...floatingFullScreenMotion}
        >
          <IconButton
            label="Full screen"
            title="Fill the window with this chord sheet"
            variant="secondary"
            className="ui-button--floating"
            onClick={(event) => handleEnterFullScreen(event.currentTarget)}
            data-floating-fullscreen-trigger
          >
            <Maximize2 size={18} />
          </IconButton>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
)}
```

`floatingFullScreenMotion` comes from `getFloatingActionMotion(Boolean(useReducedMotion()))`
in `src/lib/uiMotion.ts`. `showTip` stands for the existing
`showSectionEditTip && activeIndex === 0 && Boolean(displayedSong)` condition.

The floating button goes at the end of the normal-mode content, next to the tip. It is
`position: fixed`, so DOM placement does not affect layout.

### 3.3 Files

| File | Change |
| --- | --- |
| `src/pages/SessionPage.tsx` | `showFloatingFullScreen` state and scroll/resize effect; floating `IconButton`; shared tip/floating stack; reset on entering full screen. |
| `src/lib/uiMotion.ts` | `getFloatingActionMotion` spring/reduced-motion preset. |
| `src/index.css` | New `.ui-button--floating` size/radius/elevation class after `.ui-button--secondary`. |
| `srcTest/pages/SessionPage.test.tsx` | Scroll boundary, below-viewport, full-screen, exit-focus and motion tests. |
| `srcTest/lib/uiMotion.test.ts` | Floating button motion preset tests. |
| `.agents/plans/floating-fullscreen-button.md` | This plan. |

No changes to `App.tsx`, `SongSheet.tsx`, `useFitToScreen.ts`, `songLayout.ts`,
`songPrefs.ts` or any other protected sheet file. No new dependencies. No persistence:
the floating button's visibility is derived from scroll position and resets on reload.

## 4. Test plan

### 4.1 Component tests

Mock `getBoundingClientRect` in the floating-button describe: the header ends at 63px and
the in-page button is visible by default. Dispatch `scroll` inside `act` and wait one frame
to run the coalesced update.

New tests:

1. Initially only the in-page button exists; no
   `[data-floating-fullscreen-trigger]`.
2. Move the in-page button behind the header (`bottom: 40`, header `63`). After a scroll, the
   floating button appears.
3. Move it back below the header (`bottom: 200`). After a scroll, the floating button
   disappears.
4. A button below the viewport (`bottom: 900`) leaves the floating button hidden.
5. Enter full screen from the floating button: chrome hides, **Exit full screen** appears,
   and the floating button is not rendered while full screen.
6. Exit full screen: the page returns to normal, the floating button stays hidden (the page
   is back at the top, the in-page button is visible), and focus lands on the in-page
   **Full screen** button.

The existing full-screen tests must keep finding exactly one button in jsdom. The zero-height
guard in the production check keeps the floating button hidden when jsdom reports zero-sized
rects.

### 4.2 Manual QA

- Desktop 1440 and 1280, iPad 1024/834/768, iPhone 375 (light and dark).
- Scroll slowly and quickly in both directions. The button flips once at the threshold, with
  no flicker.
- Check the sticky-header handoff: the floating button should be present by the time the
  in-page button is hidden behind the header.
- Enter full screen from the floating button, exit, and confirm the page returns to the top
  with focus on the in-page **Full screen** button and no flash of the floating button.
- With the **Customize sections** tip visible, confirm the tip sits above the button and
  both remain clickable.
- Open **Share**, **Add Song** and **Arrange setlist**: their overlays cover/dim the floating
  button correctly and closing them leaves it in place.
- Live host toast appears at the bottom centre; confirm the brief overlap is acceptable.
- Keyboard: Tab reaches the floating button, Enter opens full screen, focus ring is visible.
- Browser zoom 80/100/150/200%; text size changes; short and long sets.
- Reduced motion: nothing moves on appearance.

## 5. Decisions

1. **Keep the in-page button.** The floating button is an additional entry point, not a
   replacement, so nothing changes for users who never scroll.
2. **Direct scroll/resize check, not `IntersectionObserver`.** The first version mixed a
   negative `rootMargin` with a `top < 0` test, which left a dead zone between "hidden behind
   the header" and "out of the viewport". IO callbacks are also asynchronous, so a quick jump
   to the top kept the floating button visible for several hundred milliseconds. One
   rAF-coalesced geometry read is immediate and exact.
3. **Respect the sticky header.** Compare the in-page button's bottom edge with the header's
   bottom edge, so the control appears exactly when the original is no longer reachable.
4. **Apple-style spring, not a fade.** A short, critically damped enter/exit makes the
   control feel like it belongs to the corner without bouncing. Reduced motion keeps only
   the opacity cross-fade.
5. **48 px circle, bottom-right.** Comfortable touch target, consistent with the tip's corner,
   and clear of the centred toast.
6. **Stack with the section tip.** Neither element covers the other; the button stays in the
   corner and the tip grows upwards.
7. **Reset visibility on entering full screen.** The full-screen shell collapses the page
   height and the browser returns to the top, so restoring the floating button on exit would
   flash it at the top and then lose focus. Focus goes back to the in-page button instead.
8. **No browser Fullscreen API.** Unchanged from the existing full-screen feature.
9. **No persistence or analytics.** The control is scroll-derived UI, not a preference.

## 6. Done when

- Scrolling the in-page **Full screen** button out of view shows a circular floating button
  in the bottom-right corner; scrolling back hides it.
- The floating button is never shown in full-screen mode, and the existing top-bar entry and
  exit controls behave exactly as before.
- Entering full screen from either button produces the same state; exiting returns to the
  top with focus on the in-page **Full screen** button.
- The section tip and floating button do not overlap, and an open modal covers the floating
  button.
- The button works on phone, tablet and desktop, in light and dark mode, by touch, mouse and
  keyboard.
- `npm test && npm run test:functions && npm run lint && npm run build && npm run build:functions`
  all pass after implementation.
- No changes to the protected song sheet files, no new dependencies, no layout shift.

## 7. Implementation notes

- **Async session load.** The effect depends on `hasSession` as well as `isFullScreen`,
  because the set title bar does not exist until the session finishes loading. The dependency
  is a boolean, so ordinary session edits do not re-run the effect.
- **Sticky header handoff.** Each update reads the header's current bottom edge, so the
  floating button appears exactly when the in-page button slips behind the header and hides
  when it peeks back out. No cached header height.
- **Fast scroll.** Scroll and resize events only schedule one animation frame. The update
  reads two rects in that frame, so a trackpad flick or a jump to the top settles in the same
  frame instead of waiting for an IO callback.
- **Zero-height guard.** A zero-sized rect (jsdom, or a hidden element) is not treated as
  "hidden", so the floating button does not appear spuriously before layout exists.
- **Full-screen exit.** Entering full screen resets the floating state. The page root becomes
  `100dvh`, the document stops scrolling, and the browser returns to the top; without the
  reset the floating button would flash at the top and then lose focus.
- **Motion.** `getFloatingActionMotion` follows the existing `uiSpring`/`segmentedSpring`
  language. It uses `segmentedSpring` (critically damped, no bounce) and the shared
  `reducedMotionTransition` cross-fade for `prefers-reduced-motion`.
- **Tests added:** `SessionPage.test.tsx` covers the header boundary, show/hide, the
  below-viewport guard, the full-screen handoff and focus restoration; `uiMotion.test.ts`
  covers both motion presets.
- **Checked in a browser:** 375 × 812 phone and 768 × 1024 tablet, light and dark, with the
  section tip visible. The button is 48 × 48 with a 16 px (phone) / 24 px (tablet) right
  margin, sits 12 px below the tip, and causes no horizontal overflow. Scrolling across the
  header boundary shows and hides it at the same point in both directions.

## 8. Delivery note

Suggested commit: `feat(ui): add a floating full screen button while scrolled`.

Per `AGENTS.md`, ask the owner whether the commit goes on `main` or a new branch before the
first commit. Deployment is a **HUMAN** step and is not part of this plan.
