# Implementation Plan — /characters Mobile UX + Performance

Page: `app/(app)/characters/page.tsx` → `components/characters/CharactersExplorer.tsx`
→ `components/characters/CharactersWeb.tsx` (1910 lines, SVG graph + rAF loop)
→ `components/characters/CharacterDetailPanel.tsx` (mobile bottom sheet / desktop card)

---

## 0. Hard constraints (non-negotiable)

1. **Zero quality loss.** Node count (~95), edge count (~153), node radii
   (`getNodeRadius`), palette, labels, and `PARTICLE_COUNT = 30` are unchanged.
   No node/edge/element is ever removed, hidden by LOD, or downscaled.
   Particles are NOT reduced — they are only *frozen while a gesture is active*.

   > Superseded in part by upstream PR #15, which landed while this branch was
   > open: `PARTICLE_COUNT` is now `isLowEndDevice ? 8 : 30` and the particle
   > cadence is 4 on a low-end device. The gesture freeze above is additive and
   > still applies. See the merge commit for the reconciliation.
2. **"Edge culling" means skipping work, not hiding edges.** Existing behavior
   (loop §3): an edge whose both endpoints are off-screen skips the `d`
   recompute; its last-drawn path stays in the DOM and the world `<g>` transform
   moves it. Nothing visually detaches or disappears. Keep exactly this semantic.
3. **Desktop behavior byte-identical.** Every new code path is gated behind
   `isMobileRef.current` / `isMobile` / `pointerType === "touch"`, or behind
   `max-md` CSS. Desktop keeps: right-side dossier card (`sm:bottom-4 sm:right-4
   sm:w-96`), hover dimming, wheel zoom, keyboard shortcuts.
4. **No React state at 60fps.** Camera, drift, particles, node positions stay in
   refs + direct DOM writes (already true — keep it true).

---

## 1. Task 1 — Graph pan/tap performance on mobile

### 1.1 What the code already does right (verified — do not redo)

| Requirement | Status in `CharactersWeb.tsx` |
|---|---|
| Coalesce pointermove with rAF | ✅ `onMove` schedules `applyPointerMove` once per frame (~line 1470) |
| Freeze drift while panning | ✅ `panFrozen` → `amp = 0` (loop §2, ~line 1000) |
| Edge `d` at half cadence, full while node-dragging | ✅ `frameCount % 2`, `edgeEveryFrame = dragIdx !== -1` (§3, ~line 1512) |
| Cull off-screen edge recompute | ✅ AABB test with `cullMargin` (§3, ~line 1525) |
| Label opacity only when zoom changed | ✅ `Math.abs(cam.k - lastLabelK) > 0.003` gate (§4, ~line 1550) |
| Memoized NodeView/EdgeView, hoisted paint | ✅ `memo` + `NodeSpec`/`EdgeSpec` |
| ResizeObserver debounced | ✅ rAF commit + 120ms timer, size-guarded `setSize` (~line 880) |
| No parent re-render on pan | ✅ pan/pinch/drag write refs only; verified |

So the remaining work is narrow and targeted:

### 1.2 Changes (all in `CharactersWeb.tsx` unless noted)

**A. Throttle the idle-park `poke` handlers (timer churn at event rate).**
The park section (~line 1170–1200) registers `pointermove` on `window`; every
event does `unpark()` check + `clearTimeout` + `setTimeout`. On a 120Hz touch
panel that's 120 timer swaps/sec during a drag — measurable jank on Android.
- Add `let lastPoke = 0` and a timestamp gate: if `!parked && now - lastPoke <
  1000` → return early (only re-arm the idle timer at ~1Hz while already awake).
- `unpark()` (the transition itself) stays unconditional and immediate.

**B. Allocation-free gesture math (GC pressure at 60–120Hz).**
`applyPointerMove` pinch/pan branches build `{ ...next }` objects for
`camRef`/`targetRef` each event; `beginPinch` builds `Array.from` arrays each
frame (~line 1385–1410).
- Mutate in place: `cam.x = …; target.x = …;` (camera smoothing reads fields, so
  field mutation is equivalent).
- Reuse a module/refs-level scratch array `[p0, p1]` instead of `Array.from(pts.values())`.
- Same for the pan branch (~line 1430) and the inertia target on `onUp` (~line 1465).

**C. Freeze particles during gestures (no count change).**
Particle block (§5, ~line 1545) keeps updating during pan — wasted work since
the user is moving. Add a `gestureActiveRef` (set `true` in
`handleCanvasPointerDown` / `handleNodePointerDown` / `beginPinch`, cleared in
`onUp`/`onBlur`) and gate: `if (!reduceRef.current && frameCount % 2 === 0 &&
!gestureActiveRef.current)`. Visual delta: motes pause mid-gesture — imperceptible,
and they are behind the world layer. **Count stays 30 in both themes.**

**D. Debounce search-driven re-renders (`useDeferredValue`).**
`searchQuery` state → every keystroke rebuilds `searchMatches` (Set over all
characters) + re-renders results list + bumps `forcedLabelsRef` effect. The
~250 `memo` bail-outs still cost ~1–2ms each keystroke on mid-range Android.
- Keep the `<input>` controlled by `searchQuery` (typing stays instant).
- Add `const deferredQuery = useDeferredValue(searchQuery)` (React 19, no dep);
  use `deferredQuery` (trimmed/lowercased) for: `searchMatches` memo, the
  results list render condition, and the forced-labels effect. React schedules
  the deferred render off the input's commit — matches the "throttle search
  typing" requirement without timers.

**E. Touch-first selection (tap latency, target <200ms).**
Current tap path: `pointerdown` (NodeView, `stopPropagation`) → `pointerup`
(window) → synthetic `click` → `selectNode`. With `touch-action: none` on the
SVG there is no 300ms delay, but we can save the click-synthesis hop on touch:
- In `onUp` (~line 1450): if `panRef`/`dragNodeRef` was active for a **touch**
  pointer and `!didDragRef.current` and the down-target was a node
  (record node index in `dragNodeRef` — it already is), call `selectNode(index)`
  there and set a `selectHandledRef` so the subsequent `click` no-ops
  (`didDragRef` pattern extended with a "consumed" flag). Mouse/keyboard paths
  untouched.
- Verify `handleSelectNode` (`zoomToPoint(..., true)` + `onSelectCharacter`) does
  no extra work on mobile — it doesn't; the heavy part is the panel mount (Task 2).

**F. Optional Phase 2 — only if measured tap render >100ms: edge dim grouping.**
Today selecting a node flips `dimmed`, which changes the `opacity` prop of **all
153 EdgeViews** → 153 memo misses in one render. Acceptable for one tap, but if
Profiling shows it matters: split edges into two `<g>` layers (idle strings /
emphasis strings) and flip a group-level `opacity` — 1 DOM write instead of 153
React re-renders. **Do not attempt unless measured.** No visual change: same
opacities, same paint order (layers must preserve current z-order: dimmed
non-target edges must still render under target edges).

### 1.3 Acceptance (Task 1)

- 1-finger drag pan: single `setAttribute("transform", …)` per frame on the
  world `<g>`; drift frozen; edges at half cadence; no per-frame React render
  (verify with React DevTools "highlight updates" — zero while panning).
- 2-finger pinch: anchored at midpoint, no jitter, no object-allocation churn
  (heap timeline flat during gesture).
- Tap a node → dossier visible <200ms on mid-range Android (4× CPU throttle in
  DevTools 390×844).
- After pan/inertia, strings still attach to circles (they do — endpoints share
  `curX/curY` with nodes; regression-check visually).
- Desktop: no visual or behavioral change (hover, wheel, keyboard, node drag).

---

## 2. Task 2 — Draggable dossier bottom sheet (mobile only)

Files: `CharacterDetailPanel.tsx`, `CharactersExplorer.tsx`.

### 2.1 Snap model (transform-only, no layout thrash)

Sheet element becomes a fixed-height slab: `h-[85svh]` (`svh` dodges the mobile
URL bar; `viewportFit: "cover"` is already set in `app/layout.tsx`). Vertical
position via framer-motion `y` (translate % is relative to the element's own
height):

| Snap | Visible height | `y` |
|---|---|---|
| `full` | 85svh | `0%` |
| `half` | 48svh (current default look) | `(85−48)/85 ≈ 43.5%` |
| `peek` | 30svh (open state) | `(85−30)/85 ≈ 64.7%` |
| dismissed | 0 | `100%` + opacity 0 |

- Opens at `peek`. Tap handle toggles `peek ↔ half`. Drag up expands, drag down
  collapses, drag down past threshold from `peek` dismisses (`onClose`).
- Snap decision on release: velocity fling (|vy| > ~500px/s) wins, else nearest
  snap; dismiss threshold = `peek + ~8%` of sheet height or downward fling from peek.
- `animate={{ y: snapY }} transition={spring(stiffness 320, damping 30)}` —
  reuses the existing spring feel. During drag, `y` follows the pointer via a
  motion value; content is never re-laid-out (transform only ⇒ compositor-driven,
  60fps even on cheap phones).

### 2.2 Drag surface = handle + header (cannot fight inner scroll)

- Pointer handlers (`onPointerDown/Move/Up`, `setPointerCapture`) attach to the
  grabber bar (`h-1.5 w-12 rounded-full bg-line`) and the sticky header block —
  **not** the scroll body. The scrollable content (`overflow-y-auto`) therefore
  always owns its own touches; the sheet only moves when you grab chrome.
- Header drag skips drag-start when `e.target.closest("button")` (close X must
  stay a tap target).
- `touch-action: none` + `cursor-grab` on handle/header only.
- When sheet is at `full`, content scrolls natively; header still drags the sheet.
- During an active drag, suppress inner scroll explicitly as belt-and-braces:
  `overscroll-behavior: contain` on the scroll body.

### 2.3 Graph must react to sheet height

`usableRect()` (~line 183) hard-codes `bottom = h * 0.48` when
`panelOpen && isMobile`, and the bottom-left dock uses
`bottom-[calc(48vh+12px)]` (~line 1730). With variable sheet height:
- `CharacterDetailPanel` gains `onSnapChange?: (snap: "peek"|"half"|"full") => void`.
- `CharactersExplorer` stores it (`panelSnap` state) and passes
  `sheetInsetVh={ snap === "peek" ? 30 : snap === "half" ? 48 : 85 }` into
  `CharactersWeb` (new optional prop, mirrored into `sheetInsetVhRef`).
- `usableRect` reads `sheetInsetVhRef.current` instead of the literal `0.48`;
  dock style becomes a computed `style={{ bottom: calc(...) }}` from the same ref
  via state (3 possible values — re-render cost trivial).
- Refit is **gated by `userAdjustedRef`** (existing flag): on snap change, if the
  user hasn't manually panned/zoomed, re-run `zoomToPoint` on the selected node
  so it stays in the visible area. If the user has adjusted, only the dock moves.
- Snap changes fire 3-value events, never continuous drag values → no rAF→React coupling.

### 2.4 A11y + platform details (preserve/extend what exists)

- Escape-to-close and focus restore: already implemented in the panel — keep.
- Handle becomes focusable: `role="slider"` (or `button` + aria-expanded), keyboard
  `ArrowUp/ArrowDown` = expand/collapse, `Home/End` = full/peek, `Enter/Space` = toggle,
  `aria-valuenow` = snap index, `aria-label="Drag to resize dossier"`.
- Safe area: sheet bottom padding `pb-[max(env(safe-area-inset-bottom),0.75rem)]`
  (Tailwind arbitrary value; `viewportFit` already on).
- Backdrop: keep current no-backdrop design (graph dims via selection), but the
  sheet root keeps `pointer-events-auto` and the existing tap-empty-canvas
  deselect in `CharactersWeb`'s SVG `onClick` (~line 1615) still closes it.
- Desktop: all sheet-drag code paths gated `sm:` / `isMobile`; the desktop card
  markup (`sm:max-h-[85vh]`, `sm:rounded-2xl`) untouched; grabber bar stays
  `sm:hidden` (hidden on desktop as today).
- On each new selection, snap resets to `peek` (effect keyed on `character.id`).

### 2.5 Acceptance (Task 2)

- Drag handle/header: sheet tracks finger 1:1, snaps with spring, no rubber-band
  past bounds, dismiss on overdrag from peek.
- Tap handle toggles peek↔half; ArrowUp/Down work when handle focused.
- Content scroll works at half/full; grabbing content never moves the sheet.
- Conan and the graph re-center above the sheet as it grows (only when the user
  hasn't panned manually).
- Escape closes; focus returns to the node/trigger; safe-area respected at bottom.
- Desktop: card identical to current build (screenshot diff).

---

## 3. Task 3 — Hide chrome while a character is selected (mobile only)

Condition: `selection != null && max-width: 767px`. Nothing unmounts the graph;
state (`searchQuery`, `filter`, `legendOpen`) must survive hide/show.

### 3.1 Search input + relationship filter (inside `CharactersWeb`)

- `CharactersExplorer` already owns `selection` and `isMobile` is available via
  the exported `useMediaQuery("(max-width: 767px)")` hook — add it there.
- New prop on `CharactersWeb`: `hideControls?: boolean` =
  `isMobile && selection != null` (computed in the explorer).
- In `CharactersWeb`, apply `hidden` **class** to the top-left control column
  container (~line 1652): `className={cn("pointer-events-none absolute …",
  hideControls && "hidden")}`. Using `hidden` instead of conditional render
  keeps `searchQuery` state in place trivially (it lives in the component
  anyway) and avoids remount/focus churn; the spec's "hidden md:flex or
  conditional render" is satisfied by the class route.
- `topLeftSlot` (filter chip + legend from the explorer) sits inside that column
  → hidden with it. The explorer additionally wraps `filterControls` output in
  the same `hideControls && "hidden"` class as belt-and-braces (it is the same
  DOM subtree).
- Graph fit math: `usableRect`'s `top = 100` chrome inset still reserves space —
  fine either way; do NOT re-fit on hide (avoids surprise camera jumps).

### 3.2 Global ChatWidget (mounted in `app/layout.tsx` via `ChatWidgetLoader`)

Cannot unmount from the characters page without losing chat state. Use a tiny
shared store — no new deps:

- New file `lib/character-chrome.ts`:
  ```ts
  // module-level pub/sub + useSyncExternalStore hook
  let hidden = false;
  const listeners = new Set<() => void>();
  export function setCharacterChromeHidden(v: boolean) { … notify … }
  export function useCharacterChromeHidden(): boolean { … useSyncExternalStore … }
  ```
- `CharactersExplorer`: `useEffect(() => { setCharacterChromeHidden(hideControls);
  return () => setCharacterChromeHidden(false); }, [hideControls])` — the cleanup
  also covers route changes away from /characters.
- `ChatWidget.tsx`: `const chromeHidden = useCharacterChromeHidden()`. Apply to
  both the launcher button (~line 227) and the open panel (~line 240):
  `className={cn(…, chromeHidden && "hidden")}` (or `pointer-events-none
  opacity-0` — prefer `hidden`: no compositor cost, trivially restorable).
  Chat state (`messages`, `open`, auth) is untouched — pure visibility.

### 3.3 Acceptance (Task 3)

- 390px viewport, tap Conan → search field, filter chip/legend, chat launcher
  all gone; sheet occupies bottom; no layout shift of the SVG (background rect
  is already viewport-sized).
- Close/deselect → all three reappear instantly with prior search text and
  active filter intact (verify: type "ran", select, close → "ran" still in input).
- ≥768px: selecting a character changes nothing (search, filter, chat, badge all
  stay; desktop dossier on the right).
- Chat history/session persists across hide/show; open-chat state preserved
  (panel hidden while selected, reappears as it was).

---

## 4. Sequencing & commits

1. **Commit 1 — perf:** §1.2 A–E in `CharactersWeb.tsx`
   (poke throttle, gesture allocs, particle gesture-freeze, deferred search,
   touch select). Build + desktop smoke test.
2. **Commit 2 — sheet:** §2 in `CharacterDetailPanel.tsx` + `CharactersExplorer.tsx`
   (snap model, drag surface, `onSnapChange` → `sheetInsetVh` → `usableRect`/dock).
3. **Commit 3 — chrome hiding:** §3 (`lib/character-chrome.ts`, explorer wiring,
   `ChatWidget` classes, `hideControls` prop).
4. **Verify:** `npm run build` (must pass clean), `npm run lint`, `npm test`
   (existing vitest suites are lib-level; nothing should break).

## 5. Verification matrix

| Check | 390px (DevTools 4× CPU) | Real mid-range Android | 1440px desktop |
|---|---|---|---|
| 1-finger pan smooth, no React re-renders | ✅ | ✅ | n/a |
| 2-finger pinch anchored, no jitter | ✅ | ✅ | n/a |
| Tap node → dossier <200ms | ✅ | ✅ | existing |
| Strings attached during + after pan | ✅ | ✅ | ✅ |
| Sheet drag peek→half→full→dismiss | ✅ | ✅ | hidden |
| Search/filter/chat hidden on select, restored on close | ✅ | ✅ | unchanged |
| Node count / strings / particles visually identical to today | ✅ | ✅ | ✅ |

## 6. Risks / notes

- `usableRect` change must read the ref, not state, so the rAF loop never stalls
  on a stale closure; the ref mirrors the prop via `useEffect` like `panelOpenRef`.
- The dock `bottom-[calc(48vh+12px)]` string lives in a `cn()` — replace with an
  inline `style` so the three snap values work without Tailwind dynamic classes.
- Touch-select (§1.2E) must not double-fire with `onClick` — the consumed flag is
  mandatory; add it before shipping.
- Keep `IDLE_PARK_MS` behavior intact: poke throttling (§1.2A) must never delay
  *unparking* (unpark stays immediate), only re-arming while awake.
- No changes to `graph-theme.ts` paints, `getNodeRadius`, `CANVAS`, or any
  `<circle>`/`<path>` visual attributes anywhere in this plan.
