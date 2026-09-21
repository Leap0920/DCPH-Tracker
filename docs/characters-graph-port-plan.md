# Red Strings — porting the graph renderer into the React app

Status: implemented, cleanup outstanding. Variant A (Case Board) shipped: the
engine, theme, data adapter and `RedStringsCanvas` are in `lib/red-strings/` and
`components/characters/`, and `/characters` renders them. Still open from this
plan: the §6 deletions, the `dom` component test in §5, and the §9 decisions.
Companion to `example-design/THEME-API.md` (the renderer contract) and
`example-design/{A,B,C,D}.html` (the four art directions).

The prototype in `example-design/` is a React-free Canvas 2D renderer written
against the app's real data. This document is the plan for making it the graph
the app ships, and for deleting what it replaces.

---

## 1. Why replace what is there

The live graph is `components/characters/CharactersWeb.tsx` — **2142 lines of
SVG**, one DOM node per character and per relationship. The rAF loop writes
`transform`, path `d` and `opacity` straight onto refs
(`CharactersWeb.tsx:721-724`, `:1824-1847`), so the DOM is not a paint target
that can be swapped out; it *is* the scene graph.

Three consequences that motivate the rewrite:

1. **Cost scales with the cast, not with the pixels.** 95 `<g role="button">`
   nodes plus 153 `<path>` edges are laid out and styled by the browser every
   frame. The canvas engine does the same frame in **1.1–1.9 ms** measured
   (`THEME-API.md`, QA surface), with the whole 95-node / 153-edge graph baked
   into sprites and one built path per edge material.
2. **The graph does not use the portraits at all.** `app/(app)/characters/page.tsx:18-20`
   calls `getLightweightCharacters()`, which strips `image` and `bio`. The app
   ships 96 portraits in `public/characters/` that the graph never shows. The
   canvas engine treats the portrait as the node's identity — it is the single
   biggest visual difference between the two.
3. **Label placement is ad hoc.** SVG `<text>` is laid out by the browser, so
   names collide or get clipped by the frame edge, and `usableRect`
   (`CharactersWeb.tsx:198-221`) is a hand-maintained inset. The engine places
   labels with a 4-candidate greedy search plus hysteresis, and reserves a
   screen-space halo in a closed-form home fit — verified to keep every one of
   the ~85 visible names inside the frame at both 1440×900 and 390×844.

What the rewrite must **not** lose: per-node keyboard focus and `aria-label`
(`:354-384`), pointer capture and drag (`:1465-1530`), wheel/keyboard zoom
(`:1743`, `:1761`), background-click-to-deselect (`:1872-1891`), the search
results list (`:2029-2059`), and the `topLeftSlot` / `sheetInsetVh` /
`hideControls` prop contract that `CharactersExplorer.tsx` depends on.

The engine already answers the accessibility half of this: it renders a real,
focusable, keyboard-navigable `<ul class="a11y">` mirror (`.a11y` in
`lib/base.css`) that drives the renderer, so 95 focusable elements still exist —
they are just not the drawing surface.

---

## 2. Target architecture

New directory `lib/red-strings/`. The prototype's split is already the right
one: one engine, one theme, thin page shells.

| module | ported from | responsibility |
|---|---|---|
| `lib/red-strings/engine.ts` | `example-design/lib/engine.js` (2017 lines) | camera, home fit, label placement, sprite baking, hit-testing, drag/wheel/keyboard, a11y mirror, dossier DOM, `stats()` / `tick()` |
| `lib/red-strings/types.ts` | new | `Theme`, `Node`, `Edge`, `Graph`, `ThemeUtils` — the interfaces `engine.ts` is written against |
| `lib/red-strings/utils.ts` | `engine.js` `THEME_UTILS` | `clamp`, `lerp`, `hash32`, `rand01`, `hexToRgb`, `rgba`, `makeCanvas`, `roundRect`, `gradePortrait`, `setFont`, `setCaps`, `measureTracked`, `paintTracked` |
| `lib/red-strings/data.ts` | `example-design/lib/data.js` + `tools/extract-data.mjs` (155 lines) | build the graph from `lib/characters-guide.ts`; resolve portraits via `getCharacterImage` |
| `lib/red-strings/theme.ts` | the chosen `example-design/lib/theme-{a,b,c,d}.js` | the shipped art direction |
| `components/characters/RedStringsCanvas.tsx` | the chosen `{A,B,C,D}.html` shell | the React client component: canvas + layer stack + chrome slots |

The engine is **not** rewritten idiomatically. It is a working 2000-line
renderer whose value is in the decisions baked into it (see §4); a
"modernise it while porting" pass would put those decisions back in play. Port
it as `.ts` with types added at the boundary — `strict` will find the real
mistakes, and the rest should read the same.

### Data adapter

`lib/characters-guide.ts` already holds everything needed:

- `CHARACTERS: Character[]` — **95 entries**, each with authored `x`/`y` in a
  **2600×1900 world** (`Character` at `:24-37`; the world size matches
  `lib/characters-layout.ts:27`). The layout is authored, not computed, so the
  port needs no force simulation.
- `RELATIONSHIPS: Relationship[]` — **153 entries**, `{id, source, target, type, detail?}`
  (`:147-153`).
- `RelationshipType` — the 8 types (`:14-22`), with `RELATIONSHIP_META`
  (`:155-199`) as the label/colour source for the legend and dossier.

Two things need reconciling, and they are the only real data work:

1. **Faction taxonomy.** The prototype's `data.js` has 15 factions keyed
   `JDL, KUDO, OSAKA, MOURI, SUZUKI, KID, TMPD, POLICE, PSB, FBI, MI6, CIA, BO,
   MIYANO, CIVILIAN`, derived by `tools/extract-data.mjs`. The app's live
   taxonomy is `FACTION_THEMES` / `resolveFaction` in
   `components/characters/graph-theme.ts:24-172`, which substring-matches
   `affiliation` and falls back to `DEFAULT`. These are different sets. Decide
   which is authoritative and derive the other — do not let both survive, or
   the legend, the dossier and the graph will disagree about faction colours.
2. **Portraits.** The engine expects each node to carry an image. Today the
   route strips it. `getCharacterImage(characterId)` (`lib/characters-guide.ts:142-145`)
   returns `/characters/<file>` from the `CHARACTER_IMAGES` map (`:43-139`).
   The adapter should attach that path and drop `getLightweightCharacters()`
   for the graph path — the portraits are the point.

The engine loads images itself and grades them through `theme.gradePortrait`
once per portrait, in place, before baking the node sprite. That contract is
deliberate (`THEME-API.md`, and §4.4 below).

---

## 3. React integration

`RedStringsCanvas.tsx` is a client component replacing `CharactersWeb` at the
same mount point. It keeps the existing boundary:

```
app/(app)/characters/page.tsx   (server; keeps metadata, keeps being a server component)
  └── CharactersExplorer.tsx    (client orchestrator; filter chip, legend popover, dossier state)
        └── dynamic(ssr:false) → RedStringsCanvas.tsx
```

`ssr:false` stays: the engine needs a live canvas and `ResizeObserver`.

The component owns exactly three things: creating the root/canvas/bg/veil
elements, calling `DCPHEngine.create(...)` in an effect, and calling
`destroy()` on unmount. Everything else — chrome HTML, dossier, legend, search,
HUD, a11y list — is produced by the theme's render functions and mounted into
slots, exactly as in `A.html`. React does not re-render the graph; it must not,
or every state change would rebuild the scene.

**Prop contract.** `CharactersWeb`'s props (`:279-296`) are consumed by
`CharactersExplorer`, including rendering `topLeftSlot` *inside* the graph's
control column (`:2027`) and the `sheetInsetVh` dock offset. Either reproduce
that surface or change Explorer in the same commit. Recommended: reproduce it
first so the port is a pure renderer swap and the Explorer diff stays small,
then simplify.

**Shared theme contract.** `components/characters/graph-theme.ts` is used by
the graph *and* by `CharacterDetailPanel.tsx` (`:9`, `:368`, `:553`) and
`CharactersExplorer.tsx` (`:24`, `:133`) — all three call
`getRelationshipColor`. The new renderer must keep reading relationship colours
from that one place, or the legend and dossier will drift from the threads.
Either keep `graph-theme.ts` as the colour authority and have the shipped
`theme.ts` consume it, or move all three consumers together.

---

## 4. Engine behaviour that is already proven — do not regress

These were found and fixed while building the prototype, and each one is a bug
the React port would otherwise inherit. They are the reason to port the file
rather than rewrite it.

1. **Never commit an unmeasurable container size.** A container that measures
   ~0 at mount is the normal case in a React tree — the route renders before
   layout settles, or the panel is collapsed. `resize()` refuses a degenerate
   reading outright and keeps asking (interval + `ResizeObserver`) until the box
   is real. Committing 1×1 instead bakes every label and node sprite at 1×1 and
   re-homes the camera to `k=0.5`, and nothing undoes it, because the later real
   measurement looks like an ordinary resize that re-bakes but never re-homes.
   This is *the* bug that made one variant boot blank.
2. **Loading a portrait must wake a parked loop.** The idle park stops rAF after
   ~4s; on a slow connection portraits are still arriving then. `im.onload`
   calls `wake()`.
3. **The engine owns `.legend`.** `renderLegend` emits the wrapper div, not just
   the head and list — otherwise the tray styling silently applies to nothing.
4. **`gradePortrait` is called once per portrait, by the engine, in place.**
   A theme must not grade a copy inside `bakeNode` as well, or two duotones
   stack. One variant shipped ungraded photographs because it graded in
   `bakeNode` and the documented hook was never invoked; the engine now invokes
   it and the theme passes the graded canvas through.
5. **A throwing theme callback must not kill the board.** `paint()` is wrapped;
   the first failure is reported once with its stack, and the loop keeps running.
6. **Labels never overhang the frame.** A nameplate must be entirely on screen
   or not drawn. The failure mode is a name sliced in half at the edge, which
   never reads as "there is more graph over there".
7. **`nodeScale` scales the mark, not the tier.** Tier is read from the
   unscaled radius; scaling first silently promotes every node into a heavier
   label band.
8. **`safe` must be able to vary with the viewport.** The chrome is not the same
   shape at 390px as at 1440px. A static inset either reserves space that no
   longer exists or misses space that now does, and the shot ends up centred in
   the wrong rectangle with dead bands.
9. **Mobile fills the height.** The graph is far wider than tall, so fitting it
   whole on a phone makes every node unreadable. The mobile shot fills the
   available height and lets the user pan sideways.
10. **Thread geometry must not shadow its own parameters.** The thread builder
    takes a small vertical offset used to lay a highlight along one side of the
    cord. Naming the endpoint deltas `dx`/`dy` in the same scope shadowed that
    parameter, so the highlight offset became the edge's entire vertical span
    and every thread was drawn displaced by that much. Horizontal threads landed
    correctly and steep ones did not, so the board read as "subtly wrong"
    rather than broken — while in fact no thread met the pins it joined. Any
    re-implementation should keep the offset and the delta visibly distinct, and
    should be tested by the ink test below rather than by eye.

---

## 5. Verification

The prototype ships the harness; port it with the engine.

- `window.__app.stats()` returns `{k, labels, portraits, vw, vh, dpr, resizes,
  frames, queued, parked, labelBounds, labelRects, rect}`. `labelBounds` is the
  union of every placed nameplate; if it falls outside `[0, 0, vw, vh]`, names
  are being sliced by the frame edge. `labelRects` is the individual plates,
  which is what a canvas-sampling test needs in order to know where the ink it
  is *not* looking for lives.
- `window.__app.tick(n)` advances the loop on a synthetic clock. This exists
  because an occluded or headless tab throttles `requestAnimationFrame` to
  nothing, so a screenshot pass otherwise captures only the first frame —
  portraits undrained, no labels placed — and the board looks broken when it is
  merely unpainted.
- Frame cost: `tick(320)` to settle, then time `tick(240)`.

Acceptance for the port, at **1440×900 and 390×844**, for every variant:

| check | bar |
|---|---|
| boot | `vw/vh` equal the viewport; no degenerate commit |
| portraits | `portraits === 94`, `queued === 0` |
| labels | `labelBounds` inside the frame; count in the 24–88 range by viewport |
| errors | `window.__errs` empty, including `console.error` capture |
| chrome | no slot overflows the viewport |
| threads | ink sits on the computed thread path, and stays there across zoom in → out → in |
| cost | steady-state ms/frame well under 16.7 |

The thread check is worth spelling out, because it is the one defect that is
invisible to every other row. Replicate the theme's own curve construction in
the page, then sample the canvas along a short normal at points clear of every
node disc, every nameplate, and every other thread: the ink must be found
within ~1px of the predicted path. Measured this way the prototype reads
`offsetMeanAbs 0.67–1.12px` with the ink on the predicted curve for 80–97% of
samples, and the ink lands on the displaced (pre-fix) position essentially
never. A thread that is 200px from where its geometry says it is looks
perfectly plausible in a still, which is exactly why the still is not the test.

Then in the app, under the existing vitest setup
(`vitest.config.mts`: a `node` project for `**/*.test.ts` and a `dom` project
for `components/**/*.test.{ts,tsx}` on jsdom):

- Pure functions worth unit-testing on the node side: home fit, label candidate
  scoring, sprite sizing, `gradePortrait`, the data adapter (95/153, faction
  mapping, portrait resolution).
- One `dom` test that mounts `RedStringsCanvas`, asserts the canvas is sized
  from its container, and asserts the a11y list has one entry per character.
  There is currently **no** component test for the graph at all.

---

## 6. Deletions this port enables

Confirmed dead or superseded — the port should remove them rather than leave
two graph models in the tree:

| path | why |
|---|---|
| `components/characters/CharactersWeb.tsx` (2142 lines) | replaced |
| `lib/characters-layout.ts` (189 lines) | **zero importers** |
| `lib/characters-graph-engine.ts` (179 lines) | imported only by its own test; a sigma/graphology model that never shipped |
| `lib/__tests__/characters-graph-engine.test.ts` | tests only the above |
| `graphology`, `sigma`, `@sigma/edge-curve` in `package.json` | installed, never used in production code |

`lib/__tests__/characters-graph.test.ts` (321 lines) re-implements `quadPath`,
`computeBbox`, `usableRect`, `labelOpacityFor` and the search filter as *local
copies*, so it does not exercise the renderer and will keep passing after the
renderer is gone. Move the parts that are still meaningful (theme colours,
search filtering) onto the new modules and delete the rest.

One live gap to decide on: `lib/characters-visible.ts` (`gateGraph`, `:59`) is
used only by tests, and `page.tsx` passes ungated data. `CharactersWeb` has
`locked` handling (`:122`, `:133`, `:161`) and `graph-theme.ts:141` has
`LOCKED_THEME`, but the path is dormant. If spoiler gating is meant to work,
the port is the moment to wire it; if not, delete it. Do not carry it forward
unwired.

---

## 7. Risks

- **Accessibility regression.** Moving 95 focusable nodes out of the drawing
  surface into the a11y mirror is a real change in how screen readers and
  keyboard users traverse the graph. Verify focus order, the search results
  list, and `aria-label` content against the current SVG behaviour before
  deleting `CharactersWeb`.
- **Chrome is now theme-owned HTML.** The prototype builds the title card,
  legend tray, search panel, HUD and dossier as template strings in the theme.
  In React that is a lot of raw HTML injected via `innerHTML`. It works and it
  is fast (built once, not per frame), but it bypasses React's escaping — every
  interpolated value must go through the theme's `esc` helper. Alternative:
  keep the chrome as React components and let the theme supply only the
  *classes* and copy. Decide before writing `RedStringsCanvas`.
- **Faction reconciliation is a data change, not a rendering change.** Getting
  it wrong changes colours in three places at once (§2).
- **Route stays a server component.** `page.tsx` is server-side and calls
  synchronous `getLightweight*()`. If the port needs the portraits, the data it
  passes grows; check the payload size before shipping, and prefer passing
  portrait *paths* over base64 or fetched blobs.
- **The prototype's `data.js` is generated and must not be edited by hand.**
  `tools/extract-data.mjs` (155 lines) is the generator. The React port should
  replace both with a runtime adapter over `lib/characters-guide.ts` — one
  source of truth, not a generated copy that can drift.

---

## 8. Sequencing

1. **Choose the art direction.** The four variants share one engine; the
   choice decides `theme.ts` and the page shell, not the architecture. See §9.
2. **Port the engine and utils** as TypeScript behind `types.ts`, with no
   behaviour change. Verify with the §5 harness against the four existing
   `example-design` pages — the ported engine must reproduce the same
   `stats()` at both viewports before any React work starts.
3. **Write the data adapter** over `lib/characters-guide.ts`, and settle the
   faction taxonomy in the same commit.
4. **Build `RedStringsCanvas.tsx`** against the existing prop contract; keep
   `CharactersExplorer` unchanged in this commit so a visual regression is
   attributable.
5. **Wire the theme's chrome** into React (or confirm the `innerHTML` decision
   from §7) and verify keyboard + screen-reader traversal.
6. **Delete** the modules in §6 and drop the unused dependencies.
7. **Run the full suite** plus the §5 acceptance table, then compare against the
   prototype pages side by side.

---

## 9. Open decisions for the user

1. **Which variant ships?** A — Case Board (cork, pinned photographs, crimson
   thread); B — Celestial Atlas (engraved vellum star chart); C — Signal
   (monochrome phosphor intercept); D — Hanko Registry (lacquer, red seals).
   All four are complete, boot clean, and measure 1.1–1.9 ms/frame.
2. **Should the graph show portraits?** Today it does not — the route strips
   them. All four variants put the portrait at the centre of the node, and it is
   the largest single visual change in this port. If the answer is no, the
   variants need reworking before the port.
3. **Label density.** The engine shows ~85 names at desktop and ~25 at mobile,
   chosen by collision, with a tier system (9 story characters get index cards
   in A; 75 get plain labels). Confirm that showing a *subset* of names is
   acceptable versus the current SVG, which attempts all of them.
4. **Spoiler gating** — wire it or delete it (§6).
