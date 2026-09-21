# Red Strings — variant theme API

A variant is **two files**: `lib/theme-<x>.js` (the art direction, as code) and
`<X>.html` (the page shell: fonts, page material, chrome CSS).

The renderer (`lib/engine.js`), the data (`lib/data.js`) and the layout CSS
(`lib/base.css`) are **shared and must not be edited** to suit one variant.
Everything a variant needs to look different is reachable through the theme
object below. If you find yourself wanting an engine change, say so instead of
working around it — a hack in one theme is a bug in all four.

`lib/theme-a.js` + `A.html` are the reference implementation. Read them first.

---

## Boot

```html
<script src="lib/data.js"></script>
<script src="lib/engine.js"></script>
<script src="lib/theme-x.js"></script>
<script>
  window.__app = DCPHEngine.create({
    theme: window.DCPH_THEME_X,
    root:    document.getElementById("stage"),
    canvas:  document.getElementById("canvas"),
    bg:      document.getElementById("tile"),   // world-anchored CSS layer
    dossier: document.getElementById("dossier"),
    a11y:    document.getElementById("a11y"),
    slots: {
      title:  document.getElementById("slot-title"),
      legend: document.getElementById("slot-legend"),
      search: document.getElementById("slot-search"),
      tools:  document.getElementById("slot-tools"),
      hud:    document.getElementById("slot-hud")
    }
  });
</script>
```

The required DOM is exactly A.html's `.stage` block: `.bg` (static, engine never
touches it), `.tile` (engine translates it every frame), `.canvas`, `.veil`,
`.chrome` with the five slots, `.dossier`, `ul.a11y`. Portraits resolve against
`public/characters/` — the engine builds `src` itself.

## `DCPHEngine.utils`

`clamp, lerp, easeOutCubic, easeOutQuint, hash32, rand01, hexToRgb, rgba,
makeCanvas, roundRect, gradePortrait, setFont, setCaps, measureTracked,
paintTracked`

- `hexToRgb("#RRGGBB") -> [r,g,b]`
- `rgba([r,g,b], a) -> "rgba(...)"` (also accepts a hex string)
- `makeCanvas(w, h) -> HTMLCanvasElement`
- `roundRect(ctx, x, y, w, h, r) -> ctx` (adds the path; you fill/stroke it)
- `gradePortrait(canvas, {dark, light, contrast, gamma, mix})` — bakes a duotone.
  This is how 94 wildly inconsistent portraits are forced into one material.
  `mix` 0 = untouched, 1 = fully duotone.
- `setFont(ctx, "700 12px Inter, sans-serif")`
- `setCaps(ctx, bool)` — small-caps shaping
- `measureTracked(ctx, text, trackingPx) -> width`
- `paintTracked(ctx, text, x, y, trackingPx, "fill" | "stroke")`

## Node records

`{ id, name, label, role, bio, aliases[], img, faction, bx, by, degree, r,
tier, seed, adj[], sx, sy, sr, alpha, visible, sprite, labelSprite, labelOff }`

- `r` is the node radius in world units (11–26) and **encodes importance** —
  never draw a node smaller or larger than `r` says.
- `tier` is 0 / 1 / 2 from `r`.
- `bx, by` authored layout; `sx, sy, sr` screen position and radius this frame.
- `faction` is a key into `DCPH_DATA.factions` (`{label, short, hue}`).

## Edge records

`{ id, type, a, b, detail, solo, curvature, alpha, emphasis, dash }`

- `type` is one of `romance family friendship rivalry mentor colleague
  secret_identity adversary`.
- `solo` = the only thread between this pair; `curvature` = the authored bow for
  parallel threads (signed, so siblings bow to alternating sides).

---

## The theme object

### Palette / material

| key | shape |
|---|---|
| `id`, `name` | strings |
| `camera` | `{anchorX, anchorY, mobileK, desktopMin, desktopMax, labelPadX, labelPadY}` |
| `safe` | `{left, right, top, bottom}` px reserved for chrome panels — or a function `(vw, vh) => {…}` |
| `nodeScale` | number, default `1` — how large this theme draws its marks |
| `noise` | `{color:[r,g,b], alpha, block}` — grain tile baked once into `--noise` |
| `bgMotion` | `{mode:"world", tile:<worldPx>}` — or omit for a static background |
| `legendCollapsible` | default `true`; the tray starts behind a tab |

`labelPadX/labelPadY` are the **screen-space** halo the home fit reserves for
labels (labels are constant device size, so this is exact). It has to cover the
**widest** nameplate, not a typical one: labels are placed on either side of
their node, so the outermost node can carry its label outward, and a halo that
is too small is what puts names a few pixels off the frame edge.

`safe` should be a function whenever the chrome changes shape between desktop
and mobile, which is nearly always — a cartouche becomes a full-width banner, a
legend tray is dropped entirely. Measure the real panels rather than guessing;
the failure is not subtle, the cluster ends up centred in a rectangle that does
not match the free space and the shot looks off-centre with dead bands.

`nodeScale` changes only the drawn size. Label tiers are read from the
unscaled radius, so raising it enlarges the marks without promoting anyone into
a heavier label band.

`theme.safe` is how the establishing shot avoids parking a node under your own
chrome. Keep it honest: measure your actual panels.

### Callbacks

**`gradePortrait(canvas, node, h)`** — `h` is `utils`. Bake-time duotone.

The **engine owns this call**: it runs once per portrait, in place, on the
cropped square, immediately before `bakeNode` receives it. So `bakeNode` should
draw `h.portrait` as-is and must NOT grade it again — a second pass stacks two
duotones and crushes the face. Options are `{dark, light, contrast, gamma, lift,
mix}`; `mix` 0 leaves the photograph alone, 1 is a pure duotone.

**`bakeNode(node, px, h) -> HTMLCanvasElement`** — `px` is the square sprite
size in **device** px. `h.unit` is device px per world unit, `h.pad` is the
bleed factor, `h.portrait` is the already-graded portrait canvas (may be `null`
while portraits stream in — always handle null), `h.faction` is
`{hue, short, label}`. Re-baked on resize and once after webfonts land, so keep
it idempotent and free of one-shot side effects.
Draw the node's full art here: mount, frame, ring, pin, seal. Bake-time
`ctx.filter` / `ctx.shadowBlur` are fine and encouraged — this runs once per
node, never per frame.

**`beforeWorld(ctx, st)` / `afterWorld(ctx, st)`** — once per frame, before and
after the graph. `st` = `{vw, vh, cam:{x,y,k}, dpr, t, dt, selected, hovered,
filterType, focusId, graph, data}`. `beforeWorld` is the place for underlays
(figure lines, grids, glow pools); `afterWorld` for overlays (scanlines,
vignette washes, reticles). The canvas transform is already `dpr`-scaled and
origin-top-left; `st.cam` is the same camera the graph used, so
`world * k + cam` gives screen coordinates.

**`drawEdge(ctx, edge, st)`** — `st` = `{alpha, k, t, emphasis, selected,
hovered, filterType, focused}`. Called once per visible edge. **Budget: keep
this to a handful of stroke calls.** Build the path once and restroke it at
different widths rather than rebuilding geometry; the frame budget at 153 edges
is real. Do not allocate per call.

**`drawNode(ctx, node, st)`** — `st` = `{alpha, scale, k, t, size, screenR,
selected, hovered, focused, isMatch, hasFilter, dimmed, dpr}`. `size` is the
sprite's CSS width; `screenR` its on-screen radius. Blit `node.sprite` centred
on `(node.sx, node.sy)`, scaled by `st.scale`. Honour `st.alpha`.

**`edgeStyle(type) -> {color, width, dash?, bow?, knot?, ...}`** — the single
source of truth for a relationship type. The engine feeds it to `swatchSvg` to
build the legend key, so **any geometry channel you return is drawn in the
legend too** (`bow` curves the swatch, `knot` adds its marker, `dash` dashes it,
`cord` adds a highlight line). Return `label` as well.

**`typeLabel(type) -> string`**

### Labels

```js
label: {
  family, size(node)|px, weight(node)|px, tracking, color|color(node),
  smallCaps?, upper?, gap, leaderColor, offsets: [0,1,2,3],
  plate(node) -> {bg, border?, borderWidth?, radius, padX, padY,
                  shadow?, shadowBlur?, shadowY?, rule?} | null,
  halo(node) -> {color, width} | null,
  text(node) -> string
}
```

Labels are drawn at **constant device size** — they do not scale with zoom. That
is deliberate and is the main legibility win over the shipped SVG graph. `offsets`
is the candidate order: `0` below, `1` above, `2` right, `3` left.

### Chrome

Each returns an HTML string. The engine re-renders them on state change, so they
must be pure functions of nothing (or of `DCPH_DATA`) — read live state from the
`[data-k]`, `[data-labels]`, `[data-progress]` hooks the engine updates in place.

| member | notes |
|---|---|
| `title()` | wraps in `.brand`; slot is `.slot-title` |
| `legendHead()` | inner head of the tray; the engine owns the `.legend` wrapper |
| `legendTab()` | the collapsed tab's inner HTML |
| `searchPlaceholder` | string |
| `searchHead()` | inner head of the search panel |
| `hud()` | wraps in `.hud`; must contain `[data-k]`, `[data-labels]`, `[data-progress]` |
| `dossier(d)` | `d = {node, faction, threads, typeLabel, swatch, edgeStyle, esc}` |

`d.threads` is `[{e, other, dir}]`. `d.swatch(type)` returns an inline SVG thread
sample — use it, do not hand-roll a colour chip. `d.esc()` escapes.

Interactive hooks the engine already delegates on `root`:
`[data-type]` (set/clear filter), `.legend__clear`, `[data-legend-toggle]`,
`.tools__btn[data-act=in|out|home]`, `.search__hit[data-id]`,
`.a11y__node[data-id]`, `.dossier__close`, `[data-goto]` (jump to a node).

---

## Hard rules

1. **No per-frame allocation.** No `map`/`filter`/`sort`/template strings inside
   `drawEdge`, `drawNode`, `beforeWorld`, `afterWorld`.
2. **No `ctx.filter`, `ctx.shadowBlur`, `createRadialGradient`, or `getImageData`
   in a per-frame callback.** Bake them instead. Gradients created once at module
   scope are fine; per frame they are not.
3. **`globalCompositeOperation`** is limited to `source-over`, `lighter`,
   `multiply` — and always restore it in the same callback.
4. **Node radius is data.** Do not rescale it.
5. **Relationship type must survive greyscale.** Colour alone is not an encoding.
   Give each of the 8 types at least two of: width, dash, bow, knot/marker,
   material, label treatment.
6. **Labels never scale with the camera** and never reshuffle while panning
   (the engine handles hysteresis — do not defeat it by varying label geometry
   with zoom).
7. **`prefers-reduced-motion`** is handled by the engine; do not add motion the
   engine cannot disable.

## Performance

Measured steady state, 1440×900, with all 94 portraits drained and every label
placed — cost of the whole engine JS body per frame, against a 16.7 ms budget:

| variant | ms/frame | share of budget |
|---|---|---|
| A — Case Board | 1.32 | 8% |
| B — Celestial Atlas | 1.12 | 7% |
| C — Signal | 1.70 | 10% |
| D — Hanko Registry | 1.92 | 11% |

That headroom exists because the callbacks are allocation-free and bake their
expensive work. Keep it that way.

## The QA surface

`window.__app` exposes two things beyond the theme API that exist for
verification rather than for the page:

```js
window.__app.stats()
// { k, labels, portraits, vw, vh, dpr, resizes, frames, queued, parked,
//   labelBounds: [l,t,r,b] | null, rect: [w,h] }

window.__app.tick(n, stepMs)   // advance n frames on a synthetic clock
```

`stats()` is the only way to tell a layout bug from a paint bug from the
outside, because a canvas that was never sized looks identical to one that
painted nothing. `labelBounds` is the union of every nameplate rect placed this
frame; if it falls outside `[0, 0, vw, vh]` then names are being sliced by the
frame edge.

`tick()` matters for headless verification. An occluded or headless tab
throttles `requestAnimationFrame` to nothing, so a screenshot pass would
otherwise only ever capture the first frame — portraits undrained, no labels
placed — and the board looks broken when it is merely unpainted. `tick()`
suspends the rAF chain and drives the loop by hand. Real browsers never call it.

To measure frame cost without a compositor, tick past the portrait bake and time
a fixed run:

```js
window.__app.tick(320);              // settle: drain portraits, place labels
const t0 = performance.now();
window.__app.tick(240);
console.log((performance.now() - t0) / 240, "ms/frame");
```
