/*
  red-strings/engine — the Canvas 2D graph renderer.

  Ported from `example-design/lib/engine.js` with no behaviour change: every
  constant, branch and ordering decision below is the prototype's. Types are
  added at the boundaries (the theme contract, the DOM) and left inferred
  inside the numeric loops.

  Architecture (fixed for all four variants, per the perf review):
  - ONE Canvas 2D surface, full repaint per frame, viewport-culled. No WebGL,
    no layered canvases, no DOM/SVG label overlay.
  - Labels are baked ImageBitmap-style sprites drawn in SCREEN space at a
    constant device size, so they never scale with the camera and never smear.
    Placement is greedy over 4 candidate offsets in priority order, with
    hysteresis so a label that already has a slot keeps it while panning.
  - Everything expensive is baked once at load: node art, portrait grades,
    label plates, glow sprites, noise tiles. Nothing in the frame loop runs a
    filter, a blur, or a shadow.
  - DPR capped at 2.
  - React-free by construction; this file is the reference implementation the
    React port wraps.

  The theme object owns all art direction. See theme-a.js … theme-d.js.
*/

import type {
  AuthoredGraph,
  AuthoredNode,
  BakeContext,
  Camera,
  CameraConfig,
  DossierContext,
  DossierThread,
  Edge,
  EdgeState,
  Engine,
  EngineConfig,
  EngineStats,
  Faction,
  Graph,
  Node,
  NodeState,
  Noise,
  WorldState,
} from "./types"
import {
  THEME_UTILS,
  clamp,
  easeOutQuint,
  hash32,
  hexToRgb,
  makeCanvas,
  measureTracked,
  paintTracked,
  rand01,
  rgba,
  roundRect,
  setCaps,
  setFont,
} from "./utils"

export { THEME_UTILS }

const DPR_CAP = 2
/*
  Node sprites bake at SPRITE_S device pixels per world unit and are drawn at
  CSS size (P / (SPRITE_S * dpr)) * k, which puts the art at exactly r*k on
  screen and lands 1:1 device pixels at k = SPRITE_S. SPRITE_PAD is the margin
  around the art that holds glows, rings and drop shadows.
*/
const SPRITE_S = 2.0
const SPRITE_PAD = 1.5
const SPRITE_CAP = 320
const MAX_LABELS = 120
const DRIFT_AMP = 2.6
const CAM_TAU = 90
const PAN_INERTIA_MS = 150
const IDLE_PARK_MS = 4200
const TAP_SLOP = 9
const TAP_MS = 420
/*
  How far a pan may travel before the cached thread layer has to be redrawn.
  The layer holds the viewport plus this much on every side, so a pan that
  stays inside the margin is a blit of pixels that are already correct;
  crossing it costs one full thread pass and re-anchors the layer there. The
  trade is memory and culled-in work against the number of expensive frames:
  the backing store is (vw + 2*PAN_CACHE_M) x (vh + 2*PAN_CACHE_M) at device
  resolution, which is ~36MB at 1440x900 on a 2x display.
*/
const PAN_CACHE_M = 180

/* ── thread layer cache: the two decisions ──────────────────────────
  The thread pass is the whole cost of a frame — 153 threads are stroked three
  to five times each (bed, core, colour, top-light, plus a ribbon and markers),
  which measures ~17ms of a ~21ms frame. A pan on empty space moves the camera
  without moving anything in the scene, so every thread's screen-space geometry
  is its previous geometry plus one constant offset: the same pixels,
  translated. Rendering that pass into an offscreen layer once and blitting it
  per frame turns a pan frame into a copy.

  Both halves of that bargain are pure functions of numbers, so they live out
  here where they can be tested directly rather than buried in the engine's
  closure: whether a cached layer still describes this frame at all, and where
  its pixels go if it does.
*/

/**
 * The scene inputs `theme.drawEdge` reads that decide how a thread *looks*.
 * A change to any of them means a cached layer holds the wrong pixels rather
 * than the right pixels in the wrong place, and translating it would be wrong
 * in a way no offset can fix.
 */
export type ThreadScene = {
  selected: string | null
  hovered: string | null
  filter: string | null
  focus: string | null
}

/** A cached thread layer: the camera and the scene it was rendered from. */
export type ThreadLayerAnchor = {
  x: number
  y: number
  k: number
  scene: ThreadScene
}

/** The camera, as the cache needs it: a translation and a scale. */
export type ThreadLayerCamera = { x: number; y: number; k: number }

function sameScene(a: ThreadScene, b: ThreadScene): boolean {
  return (
    a.selected === b.selected &&
    a.hovered === b.hovered &&
    a.filter === b.filter &&
    a.focus === b.focus
  )
}

/**
 * Whether a layer rendered from `anchor` can serve a frame at `cam` by being
 * blitted rather than redrawn.
 *
 * The scale has to match exactly: a blit cannot rescale. The scene has to
 * match exactly: the layer's threads were stroked at that scene's emphasis.
 * The camera may differ, but only within `margin` on each axis, because the
 * layer only holds `margin` beyond the viewport on every side and a pan past
 * that would expose pixels that were never drawn.
 */
export function threadLayerServes(
  anchor: ThreadLayerAnchor,
  cam: ThreadLayerCamera,
  scene: ThreadScene,
  margin: number,
): boolean {
  return (
    cam.k === anchor.k &&
    sameScene(scene, anchor.scene) &&
    Math.abs(cam.x - anchor.x) <= margin &&
    Math.abs(cam.y - anchor.y) <= margin
  )
}

/**
 * Where the layer's pixels go for a camera that has moved, snapped to whole
 * device pixels.
 *
 * The snap is the point of this function. A fractional offset turns the blit
 * into a resample, and a resampled 1px thread stroke both softens and shimmers
 * as the offset changes from frame to frame. The cost is that cached threads
 * can sit up to half a device pixel from the nodes drawn over them — below what
 * the eye resolves, and unlike a resample it does not accumulate over a pan.
 */
export function threadLayerBlitOffset(
  anchor: ThreadLayerAnchor,
  cam: ThreadLayerCamera,
  dpr: number,
): { x: number; y: number } {
  const snap = 1 / dpr
  return {
    x: Math.round((cam.x - anchor.x) / snap) * snap,
    y: Math.round((cam.y - anchor.y) / snap) * snap,
  }
}

/* ── records ────────────────────────────────────────────────────── */

/** A screen-space rect, `[x, y, w, h]`. Nameplate placement works in these. */
type Rect = [number, number, number, number]

/** World-space content bounds — the input to the establishing fit. */
type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

/**
 * The engine's node record: everything the frozen `Node` declares, plus the
 * fields the prototype keeps on the record — its index (themes print it as the
 * record number), the searched `affiliation`, the drift and anti-collision
 * offsets, and the cached adjacency.
 */
export type EngineNode = Node & {
  /** Index in `graph.nodes`. */
  i: number
  /** Free-text affiliation; `setSearch` matches it. */
  affiliation: string
  /** Anti-collision offset from the authored position, in world units. */
  ox: number
  oy: number
  /** Drift offset from the authored position, in world units. */
  dx: number
  dy: number
  /** Intro-stagger slot. The record keeps the prototype's field. */
  enter: number
  /**
   * Edge indices into `graph.edges`, in authored order — what the prototype
   * cached in `adj`, and what the incidence test in `updateEmphasis` walks
   * (O(degree), not O(edges)). `adj` itself holds adjacent node *ids*, which
   * is what the frozen `Node` declares it to be.
   */
  adjEdges: number[]
  /** Node position when the current drag started. */
  _dragStart: { x: number; y: number }
  /** Where the pointer went down, in screen space. */
  _down: { x: number; y: number }
}

/**
 * The engine's edge record: the frozen `Edge` with its endpoints narrowed to
 * `EngineNode`, which carries the fields the engine keeps on the record but a
 * theme has no business reading (the node index, the drift offsets, the cached
 * edge incidence). Narrowing rather than widening means an `EngineEdge` *is* an
 * `Edge`, so handing one to `theme.drawEdge` needs no assertion.
 */
export type EngineEdge = Omit<Edge, "a" | "b"> & {
  a: EngineNode
  b: EngineNode
}

/** The built graph: `Graph` plus the index, bounds and hub node the engine needs. */
export type EngineGraph = Omit<Graph, "nodes" | "edges"> & {
  nodes: EngineNode[]
  edges: EngineEdge[]
  byId: Record<string, EngineNode>
  bounds: Bounds
  /** The node `data.hub` names, or the first node — what the shot centres on. */
  hubNode: EngineNode
}

/* `AuthoredGraph`/`AuthoredNode`/`AuthoredEdge` live in `./types` with the rest
   of the contract — the data adapter has to produce them and the engine has to
   consume them, so they belong on neither side of the seam. */

/**
 * The camera band plus the two mobile clamp fields `computeHome` reads
 * (`band.mobileMin`/`band.mobileMax`), which the frozen `CameraConfig` does not
 * declare.
 */
type CameraBand = CameraConfig & {
  mobileMin?: number
  mobileMax?: number
}

/* One registered listener, replayed by `destroy()`. The ResizeObserver rides
   in the same list behind a `null` target, so there is one teardown path. */
type ListenerEntry =
  | [el: EventTarget, ev: string, fn: EventListener, opts: AddEventListenerOptions | undefined]
  | [el: null, ev: "ro", fn: ResizeObserver, opts: null]

type Pt = { x: number; y: number }
type PointerRec = { x: number; y: number; type: string }
type PanRef = { x: number; y: number; cx: number; cy: number }
type Pinch = { d: number; mx: number; my: number; wx: number; wy: number; k: number }
type HistPt = { x: number; y: number; t: number }
type SelectOpts = { k?: number; ax?: number; ay?: number; noFocus?: boolean }

/*
  The prototype called `getContext("2d")` and used the result unguarded. A
  browser canvas always yields one; a jsdom canvas (the component test) yields
  null unless the `canvas` package is installed, and the prototype's behaviour
  there was a TypeError raised inside `paint()` and swallowed by its guard — so
  this stays an assertion at the boundary rather than a throw at boot, which
  would make `createEngine` fail outright in jsdom.
*/
function ctx2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return canvas.getContext("2d") as CanvasRenderingContext2D
}

/*
  `Graph.factions` is a `Record<string, Faction>`, so the type says every
  lookup hits; the prototype reads it as possibly missing and falls back at
  each site (`engine.js:548`, `:1643`, `:1700`). This keeps that reading
  without an assertion at three call sites.
*/
function factionOf(factions: Record<string, Faction>, key: string): Faction | undefined {
  return factions[key] as Faction | undefined
}

/* ── graph model ────────────────────────────────────────────────── */
export function buildGraph(raw: AuthoredGraph): EngineGraph {
  const nodes: EngineNode[] = raw.nodes.map(function (n, i): EngineNode {
    return {
      i: i,
      id: n.id,
      name: n.name,
      label: n.label,
      aliases: n.aliases,
      role: n.role,
      affiliation: n.affiliation,
      faction: n.faction,
      bio: n.bio,
      img: n.img,
      bx: n.x,
      by: n.y,
      degree: 0,
      r: 12,
      tier: 2,
      seed: hash32(n.id),
      ox: 0,
      oy: 0,
      dx: 0,
      dy: 0,
      sx: 0,
      sy: 0,
      sr: 12,
      sprite: null,
      portrait: null,
      labelSprite: null,
      labelOff: -1,
      visible: false,
      alpha: 1,
      enter: 0,
      adj: [],
      adjEdges: [],
      _dragStart: { x: 0, y: 0 },
      _down: { x: 0, y: 0 },
    }
  })
  const byId: Record<string, EngineNode> = {}
  nodes.forEach(function (n) {
    byId[n.id] = n
  })

  const edges: EngineEdge[] = []
  raw.edges.forEach(function (e) {
    const a = byId[e.s],
      b = byId[e.t]
    if (!a || !b) return
    a.degree++
    b.degree++
    /*
      `solo` and `dash` are part of the frozen `Edge`; the prototype left both
      off the record — `solo` is filled by the parallel-thread pass below, and
      `dash` was never set at all (themes read `edgeStyle(type).dash`). Seeded
      here so the record matches the contract.
    */
    edges.push({
      id: e.id,
      a: a,
      b: b,
      type: e.type,
      detail: e.detail,
      curvature: 0,
      alpha: 1,
      emphasis: 0,
      solo: false,
      dash: null,
    })
  })

  // Parallel threads between one pair bow to alternating sides.
  const pairs: Record<string, EngineEdge[]> = {}
  edges.forEach(function (e) {
    const key = e.a.i < e.b.i ? e.a.i + "|" + e.b.i : e.b.i + "|" + e.a.i
    ;(pairs[key] || (pairs[key] = [])).push(e)
  })
  Object.keys(pairs).forEach(function (key) {
    const group = pairs[key]
    group.forEach(function (e, idx) {
      const off = idx - (group.length - 1) / 2
      e.curvature = off === 0 ? 0.16 : (off < 0 ? -1 : 1) * (0.16 + Math.abs(off) * 0.22)
      // A lone thread can take its bow from the relationship type instead;
      // parallel siblings must alternate sides to stay distinguishable.
      e.solo = group.length === 1
    })
  })

  nodes.forEach(function (n) {
    n.r = nodeRadius(n)
    n.tier = n.r >= 20 ? 0 : n.r >= 16 ? 1 : 2
    n.adj = []
    n.adjEdges = []
  })
  edges.forEach(function (e, ei) {
    /*
      The frozen `Node.adj` is the adjacent node *ids*; the incidence test in
      `updateEmphasis` needs edge indices, which is what the prototype cached
      there. Both are filled: `adj` for the contract, `adjEdges` for O(degree)
      incidence. Reported as a contract mismatch.
    */
    e.a.adjEdges.push(ei)
    e.b.adjEdges.push(ei)
    e.a.adj.push(e.b.id)
    e.b.adj.push(e.a.id)
  })

  // Content bounds drive the establishing shot — fitting the authored 2600x1900
  // canvas would leave a third of the frame empty.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  nodes.forEach(function (n) {
    minX = Math.min(minX, n.bx - n.r)
    minY = Math.min(minY, n.by - n.r)
    maxX = Math.max(maxX, n.bx + n.r)
    maxY = Math.max(maxY, n.by + n.r)
  })

  const hubNode = byId[raw.hub] || nodes[0]

  return {
    nodes: nodes,
    edges: edges,
    byId: byId,
    bounds: { minX: minX, minY: minY, maxX: maxX, maxY: maxY },
    /*
      The frozen `Graph.hub` is a node *id* where the prototype's was the node
      itself. The id of the node the shot actually centres on is the faithful
      mapping: it falls back to the first node when `data.hub` names nothing.
    */
    hub: hubNode.id,
    hubNode: hubNode,
    /* `factions` and `world` are required by the frozen `Graph`; the prototype
       read them off `data` directly, and still does. */
    factions: raw.factions,
    world: raw.world,
  }
}

export function nodeRadius(n: { id: string; degree: number }): number {
  if (n.id === "conan-edogawa") return 26
  if (
    n.id === "ran-mouri" ||
    n.id === "ai-haibara" ||
    n.id === "kogoro-mouri" ||
    n.id === "heiji-hattori" ||
    n.id === "kaitou-kid" ||
    n.id === "tooru-amuro" ||
    n.id === "shuichi-akai" ||
    n.id === "gin"
  )
    return 20
  if (
    n.id === "vermouth" ||
    n.id === "inspector-megure" ||
    n.id === "officer-sato" ||
    n.id === "officer-takagi" ||
    n.id === "kazuha-toyama" ||
    n.id === "professor-agasa" ||
    n.id === "yusaku-kudo" ||
    n.id === "yukiko-kudo" ||
    n.id === "vodka" ||
    n.id === "jodie-starling" ||
    n.id === "sonoko-suzuki"
  )
    return 16
  return Math.min(11 + Math.min(n.degree * 0.6, 5), 15)
}

/* ── engine ─────────────────────────────────────────────────────── */
export function createEngine(cfg: EngineConfig): Engine {
  const data = cfg.data
  const theme = cfg.theme
  const root = cfg.root
  const canvas = cfg.canvas
  const bgEl = cfg.bg
  const dossierEl = cfg.dossier
  const slots = cfg.slots || {}
  const a11yEl = cfg.a11y

  const ctx = ctx2d(canvas)
  const graph = buildGraph(data)
  /*
    The same object, seen through the frozen `Graph` type. `EngineEdge` refines
    `Edge` only by naming its endpoint fields as the node records they already
    are, so this is a widening with no assertion behind it: what the QA surface
    and `WorldState.graph` hand out is exactly what the engine runs on.
  */
  const graphView: Graph = graph
  const nodes = graph.nodes,
    edges = graph.edges
  /*
    nodeScale is how large a theme draws its marks. It is applied here rather
    than inside buildGraph because that graph is cached and shared: baking a
    theme's scale into it would leak one variant's proportions into the next.
    Tier is a statement about importance, so it is already fixed from the
    unscaled radius -- scaling first would silently promote every node into a
    heavier label band. Recomputed from nodeRadius each time, so this stays
    idempotent across repeated create() calls on the cached graph.
  */
  const nodeScale = theme.nodeScale
  if (nodeScale && nodeScale !== 1) {
    nodes.forEach(function (n) {
      n.r = nodeRadius(n) * nodeScale
    })
  }
  const reduced =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches

  let vw = 0,
    vh = 0,
    dpr = 1
  const cam: Camera = { x: 0, y: 0, k: 1 }
  const target: Camera = { x: 0, y: 0, k: 1 }
  let homeCam: Camera = { x: 0, y: 0, k: 1 }
  let kMin = 0.2,
    kMax = 4

  let selected: EngineNode | null = null
  let hovered: EngineNode | null = null
  let focusId: string | null = null
  let filterType: string | null = null
  let searchQuery = ""
  let matches: Record<string, number> | null = null // Set of node ids
  let gesture = false
  let parked = false
  let rafId = 0
  // Assigned and never read in the prototype too (`engine.js:373`); kept so the
  // port stays line-for-line, reported with it.
  let t0 = performance.now()
  let introT = 0
  let lastPoke = 0
  let lastFrame = 0
  let labelBand = -1
  let paintError = false
  let legendOpen = false

  /*
    ── thread layer cache ──────────────────────────────────────────────
    See `threadLayerServes` at the top of the file for why a pan can be a
    blit. This is the state it needs: the layer itself, and the camera and
    scene it was rendered from.
  */
  let layer: HTMLCanvasElement | null = null
  let layerCtx: CanvasRenderingContext2D | null = null
  let layerValid = false
  const layerAnchor: ThreadLayerAnchor = {
    x: 0,
    y: 0,
    k: 0,
    scene: { selected: null, hovered: null, filter: null, focus: null },
  }
  /*
    The scene as this frame sees it, rebuilt per frame so `threadLayerServes`
    can be handed a plain value. One small object per frame, the same order as
    the `EdgeState` the edge pass already allocates per edge.
  */
  const sceneNow: ThreadScene = { selected: null, hovered: null, filter: null, focus: null }
  /*
    Reported through `stats()`. Without them a silent regression -- a stray
    scene input in the validity test, or drift left live during a pan -- would
    turn the cache off and look exactly like it working.
  */
  let layerHits = 0
  let layerRenders = 0

  /* interaction */
  const pointers = new Map<number, PointerRec>()
  const scratchPts: PointerRec[] = []
  let panRef: PanRef | null = null
  let dragNode: EngineNode | null = null
  let pinch: Pinch | null = null
  let didDrag = false
  let tapConsumed = false
  let downAt = 0
  let downPos: Pt = { x: 0, y: 0 }
  const vel: Pt = { x: 0, y: 0 }
  const history: HistPt[] = []

  /* baked assets */
  let noiseTile: HTMLCanvasElement | null = null
  let spritesReady = 0
  let bgBand: number | null = null
  const measure = ctx2d(makeCanvas(8, 8))

  const listeners: ListenerEntry[] = []

  /*
    One registration helper, so `destroy()` has a single list to replay. Each
    handler keeps its own event type (`PointerEvent`, `WheelEvent`, …); DOM's
    `EventListener` takes the base `Event`, so the registration is asserted here
    rather than narrowed inside every handler.
  */
  function on<T extends Event>(
    el: EventTarget,
    ev: string,
    fn: (ev: T) => void,
    opts?: AddEventListenerOptions,
  ): void {
    el.addEventListener(ev, fn as EventListener, opts)
    listeners.push([el, ev, fn as EventListener, opts])
  }

  /* ── noise tile: baked once, handed to CSS as a repeating pattern ── */
  function bakeNoise(): string {
    const size = 200
    const nz: Noise = theme.noise || { color: [255, 255, 255], alpha: 0.05 }
    const block = nz.block || 2
    const c = makeCanvas(size, size)
    const cx = ctx2d(c)
    const img = cx.createImageData(size, size)
    const d = img.data
    const col = nz.color || [255, 255, 255]
    const aMax = nz.alpha == null ? 0.05 : nz.alpha
    // Blocky low-frequency grain reads as paper/cork tooth; pure per-pixel
    // randomness reads as television static.
    const cells = Math.ceil(size / block)
    const field = new Float32Array(cells * cells)
    for (let k = 0; k < field.length; k++) field[k] = Math.random()
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4
        const v = field[((y / block) | 0) * cells + ((x / block) | 0)]
        let a = v * 0.72 + Math.random() * 0.28
        if (Math.random() < 0.06) a = Math.random() // occasional speck
        d[i] = col[0]
        d[i + 1] = col[1]
        d[i + 2] = col[2]
        d[i + 3] = a * aMax * 255
      }
    }
    cx.putImageData(img, 0, 0)
    return c.toDataURL("image/png")
  }

  /* ── label sprites ─────────────────────────────────────────────── */
  function labelText(n: EngineNode): string {
    let t = theme.label.text ? theme.label.text(n) : n.label
    if (theme.label.upper) t = t.toUpperCase()
    return t
  }

  function bakeLabel(n: EngineNode): void {
    const L = theme.label
    const size = typeof L.size === "function" ? L.size(n) : L.size
    const weight = typeof L.weight === "function" ? L.weight(n) : L.weight
    const family = L.family
    const font = weight + " " + size + "px " + family
    const tracking = (L.tracking || 0) * size
    const text = labelText(n)

    setFont(measure, font)
    setCaps(measure, !!L.smallCaps)
    const tw = measureTracked(measure, text, tracking)

    const plate = L.plate ? L.plate(n) : null
    const halo = L.halo ? L.halo(n) : null
    const padX = (plate ? plate.padX : 0) + (halo ? halo.width : 0) + 3
    const padY = (plate ? plate.padY : 0) + (halo ? halo.width : 0) + 3
    const lineH = size * 1.34
    const w = Math.ceil(tw + padX * 2)
    const h = Math.ceil(lineH + padY * 2)

    const c = makeCanvas(w * dpr, h * dpr)
    const cx = ctx2d(c)
    cx.setTransform(dpr, 0, 0, dpr, 0, 0)
    setFont(cx, font)
    setCaps(cx, !!L.smallCaps)
    cx.textBaseline = "middle"

    if (plate) {
      if (plate.shadow) {
        cx.save()
        cx.shadowColor = plate.shadow
        cx.shadowBlur = plate.shadowBlur || 6
        cx.shadowOffsetY = plate.shadowY || 2
        cx.fillStyle = plate.bg
        roundRect(cx, padX * 0.35, padY * 0.35, w - padX * 0.7, h - padY * 0.7, plate.radius)
        cx.fill()
        cx.restore()
      }
      cx.fillStyle = plate.bg
      roundRect(cx, padX * 0.35, padY * 0.35, w - padX * 0.7, h - padY * 0.7, plate.radius)
      cx.fill()
      if (plate.border) {
        cx.strokeStyle = plate.border
        cx.lineWidth = plate.borderWidth || 1
        roundRect(
          cx,
          padX * 0.35 + 0.5,
          padY * 0.35 + 0.5,
          w - padX * 0.7 - 1,
          h - padY * 0.7 - 1,
          plate.radius,
        )
        cx.stroke()
      }
      if (plate.rule) {
        cx.strokeStyle = plate.rule
        cx.lineWidth = 1
        cx.beginPath()
        cx.moveTo(padX * 0.35, h - padY * 0.35 - 2.5)
        cx.lineTo(w - padX * 0.35, h - padY * 0.35 - 2.5)
        cx.stroke()
      }
    }

    const tx = padX
    const ty = h / 2
    if (halo) {
      cx.lineJoin = "round"
      cx.lineWidth = halo.width
      cx.strokeStyle = halo.color
      paintTracked(cx, text, tx, ty, tracking, "stroke")
    }
    cx.fillStyle = typeof L.color === "function" ? L.color(n) : L.color
    paintTracked(cx, text, tx, ty, tracking, "fill")

    n.labelSprite = { canvas: c, w: w, h: h }
  }

  function bakeAllLabels(): void {
    for (let i = 0; i < nodes.length; i++) bakeLabel(nodes[i])
    labelBand = currentLabelBand()
  }

  /* ── node sprites ──────────────────────────────────────────────── */
  function nodeSpritePx(n: EngineNode): number {
    return Math.min(SPRITE_CAP, Math.ceil(2 * SPRITE_S * n.r * dpr * SPRITE_PAD))
  }

  /** CSS size to draw a node sprite at, for a given camera zoom. */
  function spriteCssSize(n: EngineNode, k: number): number {
    if (!n.sprite) return 0
    return (n.sprite.width / (SPRITE_S * dpr)) * k
  }

  function bakeNode(n: EngineNode): void {
    const px = nodeSpritePx(n)
    /*
      `BakeContext` is `ThemeUtils & { … }`: the frozen contract promises a
      theme the whole helper set on `h`, where the prototype handed `bakeNode`
      the nine it happened to use. The whole set is spread here.
    */
    const h: BakeContext = {
      ...THEME_UTILS,
      dpr: dpr,
      unit: SPRITE_S * dpr, // device px per world unit
      pad: SPRITE_PAD,
      portrait: n.portrait,
      faction: factionOf(data.factions, n.faction) || {
        hue: "#888888",
        short: "—",
        label: "—",
      },
      graph: graphView,
    }
    n.sprite = theme.bakeNode(n, px, h)
  }

  function bakeAllNodes(): void {
    for (let i = 0; i < nodes.length; i++) bakeNode(nodes[i])
  }

  /* ── portrait loading, chunked so first paint is never blocked ── */
  const portraitQueue: [EngineNode, HTMLImageElement][] = []
  function loadPortraits(): void {
    nodes.forEach(function (n) {
      if (!n.img) return
      const im = new Image()
      im.decoding = "async"
      im.onload = function () {
        portraitQueue.push([n, im])
        /*
          Waking here is load-bearing. The idle park fires after ~4s, and on a
          slow connection the portraits are still arriving at that point — so
          without this the queue is filled AFTER the loop has stopped and the
          board sits there as 95 empty mounts until the user happens to move
          something. That is exactly the failure this had.
        */
        wake()
      }
      im.onerror = function () {
        // The frozen `Node.img` is a string with `""` for "no image"; every
        // read of the field is a falsiness test, so `""` stands in for the
        // prototype's null.
        n.img = ""
      }
      /*
        `EngineConfig` has no `imgBase`: the frozen `Node.img` is already a
        `public/` path (`/characters/conan-edogawa.webp`), so it is used
        verbatim. The prototype concatenated its own base and
        `encodeURIComponent`'d a bare filename, which would escape the leading
        slash of a path-style `img`. Reported with the port.
      */
      im.src = n.img
    })
  }

  function drainPortraits(budget: number): void {
    let done = 0
    while (portraitQueue.length && done < budget) {
      const item = portraitQueue.shift()
      if (!item) break // unreachable: the loop condition guarantees an entry
      const n = item[0],
        im = item[1]
      const size = Math.max(48, Math.min(256, Math.round(nodeSpritePx(n) * 0.6)))
      const c = makeCanvas(size, size)
      const cx = ctx2d(c)
      const s = Math.max(size / im.width, size / im.height)
      const dw = im.width * s,
        dh = im.height * s
      cx.drawImage(im, (size - dw) / 2, (size - dh) / 2, dw, dh)
      /*
        The theme gets to grade the portrait before it is handed to bakeNode.
        This is the hook that turns 94 wildly inconsistent photographs into
        one material, and it is the reason `gradePortrait` is in the theme
        contract at all — for a while it was documented but never invoked.
      */
      if (theme.gradePortrait) theme.gradePortrait(c, n, THEME_UTILS)
      n.portrait = c
      bakeNode(n)
      spritesReady++
      done++
    }
    if (done) {
      const el = slots.hud && slots.hud.querySelector("[data-progress]")
      if (el)
        el.textContent =
          spritesReady +
          "/" +
          nodes.filter(function (x) {
            return x.img
          }).length
    }
  }

  /* ── camera ────────────────────────────────────────────────────── */
  /*
    Labels are drawn at a constant *device* size, so the margin a nameplate
    needs around the outermost node is a screen-space constant — not a world
    one. Subtracting that halo from the usable rect before fitting is
    therefore exact, and closed-form:

      k = min((usableW - 2*haloX) / contentW, (usableH - 2*haloY) / contentH)

    `theme.safe` reserves the strips the chrome panels occupy, so the
    establishing shot never hides a node under the title card or the search
    field. Without both of these the outer names get clipped by the frame
    edge, which is the failure the served SVG graph already shipped with.
  */
  function computeHome(): Camera {
    const b = graph.bounds
    /*
      `CameraConfig` (frozen) declares anchorX/anchorY/mobileK/desktopMin/
      desktopMax/labelPadX/labelPadY; `computeHome` also reads `band.mobileMin`
      and `band.mobileMax`, the clamp bounds of the mobile shot, whose defaults
      are 0.28 and 0.95. Read through a narrow local view so the prototype's
      numbers survive; reported as a contract gap.
    */
    const band = (theme.camera || {}) as CameraBand
    const mobile = vw < 768
    /*
      `safe` may be a plain object or a function of the viewport. It has to be
      able to vary: the chrome is not the same shape at 390px as at 1440px
      (a cartouche becomes a full-width banner, a legend tray is dropped
      entirely), so a single static inset either reserves space that no
      longer exists or misses space that now does. Getting it wrong is not
      subtle -- the cluster ends up centred in the wrong rectangle and the
      establishing shot is visibly off-centre with dead space at the bottom.
    */
    const sf = typeof theme.safe === "function" ? theme.safe(vw, vh) || {} : theme.safe || {}
    const ux = sf.left || 0,
      uy = sf.top || 0
    const uw = Math.max(200, vw - ux - (sf.right || 0))
    const uh = Math.max(200, vh - uy - (sf.bottom || 0))
    const haloX = band.labelPadX == null ? 52 : band.labelPadX
    const haloY = band.labelPadY == null ? 28 : band.labelPadY
    const cw = b.maxX - b.minX,
      ch = b.maxY - b.minY
    const fitK = Math.max(0.12, Math.min((uw - 2 * haloX) / cw, (uh - 2 * haloY) / ch))
    /*
      On a phone the graph is far wider than it is tall, so fitting the whole
      thing at once makes every node unreadably small. The mobile shot
      therefore fills the available HEIGHT and lets the user pan sideways.
      Filling the height matters: at a lower zoom the cluster is centred in a
      tall rectangle and leaves dead bands above and below it, which reads as
      a layout mistake rather than as room to pan. mobileK is a floor, so a
      theme can still ask for more room than the height fill would give.
    */
    const kFill = uh / ch
    const k = mobile
      ? clamp(
          Math.max(fitK, band.mobileK || 0.5, Math.min(kFill, band.mobileMax || 0.95)),
          band.mobileMin || 0.28,
          band.mobileMax || 0.95,
        )
      : clamp(fitK, band.desktopMin || 0.3, band.desktopMax || 1.25)
    const ax = band.anchorX == null ? 0.5 : band.anchorX
    const ay = band.anchorY == null ? 0.5 : band.anchorY
    let x: number, y: number
    const fits = cw * k <= uw && ch * k <= uh
    if (fits) {
      x = ux + (uw - cw * k) / 2 - b.minX * k
      y = uy + (uh - ch * k) / 2 - b.minY * k
      // Nudge toward the composition anchor, but never far enough to push
      // content (plus its label halo) out of the usable rect.
      const loX = ux + haloX - b.minX * k,
        hiX = ux + uw - haloX - b.maxX * k
      const loY = uy + haloY - b.minY * k,
        hiY = uy + uh - haloY - b.maxY * k
      if (hiX > loX) x = clamp(ux + ax * uw - graph.hubNode.bx * k, loX, hiX)
      if (hiY > loY) y = clamp(uy + ay * uh - graph.hubNode.by * k, loY, hiY)
    } else {
      x = ux + (band.anchorX == null ? 0.42 : band.anchorX) * uw - graph.hubNode.bx * k
      y = uy + (band.anchorY == null ? 0.52 : band.anchorY) * uh - graph.hubNode.by * k
    }
    homeCam = { x: x, y: y, k: k }
    kMin = Math.min(fitK * 0.75, k * 0.55)
    kMax = 4
    return homeCam
  }

  function home(instant?: boolean): void {
    const h = computeHome()
    target.x = h.x
    target.y = h.y
    target.k = h.k
    if (instant) {
      cam.x = h.x
      cam.y = h.y
      cam.k = h.k
    }
    schedule()
  }

  function zoomAt(sx: number, sy: number, factor: number, smooth: boolean): void {
    const k2 = clamp(target.k * factor, kMin, kMax)
    if (k2 === target.k) return
    const wx = (sx - target.x) / target.k
    const wy = (sy - target.y) / target.k
    target.k = k2
    target.x = sx - wx * k2
    target.y = sy - wy * k2
    if (!smooth) {
      cam.k = k2
      cam.x = target.x
      cam.y = target.y
    }
    schedule()
  }

  function focusNode(n: EngineNode, opts?: SelectOpts): void {
    const k = clamp((opts && opts.k) || 1.35, kMin, kMax)
    const ax = opts && opts.ax != null ? opts.ax : vw < 768 ? 0.5 : 0.62
    const ay = opts && opts.ay != null ? opts.ay : vw < 768 ? 0.32 : 0.5
    target.k = k
    target.x = ax * vw - n.bx * k
    target.y = ay * vh - n.by * k
    schedule()
  }

  function wake(): void {
    parked = false
    lastPoke = performance.now()
    schedule()
  }

  /* ── selection / filter / search ───────────────────────────────── */
  function neighborSet(n: EngineNode): Record<string, number> {
    const set: Record<string, number> = {}
    set[n.id] = 1
    edges.forEach(function (e) {
      if (e.a === n) set[e.b.id] = 1
      else if (e.b === n) set[e.a.id] = 1
    })
    return set
  }

  /*
    The prototype's `select(n, opts)` took a node; the frozen `Engine.select`
    takes an id, so the node-taking half is `selectNode` and the exported
    `select` resolves the id through `graph.byId` (an unknown id is a no-op,
    as in `focus`).
  */
  function selectNode(n: EngineNode | null, opts?: SelectOpts): void {
    selected = n
    focusId = n ? n.id : null
    renderDossier()
    updateA11yFocus()
    if (n && !(opts && opts.noFocus)) focusNode(n, opts)
    else schedule()
    /*
      Called in the prototype's position: last, after the dossier and the focus
      move (`engine.js:767`). The id travels rather than the record -- the host
      owns the character data and has no business holding an engine node.
    */
    if (cfg.onSelect) cfg.onSelect(n ? n.id : null)
  }

  function setFilter(type: string | null): void {
    filterType = filterType === type ? null : type
    // A live filter has to leave the key readable, so opening one opens the
    // tray even if the user had it collapsed.
    if (filterType) legendOpen = true
    renderLegend()
    schedule()
    if (cfg.onFilter) cfg.onFilter(filterType)
  }

  function setSearch(q: string): void {
    searchQuery = q || ""
    const needle = searchQuery.trim().toLowerCase()
    if (!needle) {
      matches = null
    } else {
      const found: Record<string, number> = {}
      nodes.forEach(function (n) {
        if (
          n.name.toLowerCase().indexOf(needle) >= 0 ||
          n.label.toLowerCase().indexOf(needle) >= 0 ||
          n.role.toLowerCase().indexOf(needle) >= 0 ||
          n.affiliation.toLowerCase().indexOf(needle) >= 0 ||
          n.aliases.some(function (a) {
            return a.toLowerCase().indexOf(needle) >= 0
          })
        )
          found[n.id] = 1
      })
      matches = found
    }
    renderSearch()
    schedule()
  }

  /* ── frame loop ────────────────────────────────────────────────── */
  /*
    `stepping` suspends the rAF chain while tick() drives frames by hand.
    A headless or occluded tab throttles requestAnimationFrame to nothing,
    which makes the board look broken when it is merely unpainted: the
    portraits never drain and no label is ever placed. tick() advances the
    loop on a synthetic clock instead, so a screenshot can be taken of a
    settled board without depending on the compositor.
  */
  let stepping = false
  function schedule(): void {
    if (stepping) return
    if (!rafId) rafId = requestAnimationFrame(frame)
  }

  /*
    A container that measures ~zero at mount is the normal case in a React
    tree: the route renders before layout settles, the panel is still
    collapsed, or the tab is offscreen. Such a reading is NOT a viewport of
    1x1 — it means "not measurable yet", and committing it is destructive:
    it bakes every label and node sprite at 1x1 and re-homes the camera to
    k=0.5, and nothing ever undoes that, because the later real measurement
    looks like an ordinary resize and only re-bakes, never re-homes the
    already-corrupted camera.

    So a degenerate reading is refused outright and we keep asking until the
    box is real. The ResizeObserver alone is not enough here: it fires on
    box changes, and a container that was never laid out can go straight
    from "no box" to its final size in a way that leaves the observer's
    initial 0x0 notification as the only one we ever see. The interval also
    survives a hidden tab, where rAF is throttled away entirely.
  */
  /*
    `setInterval`'s handle is a `number` in the DOM lib and a `NodeJS.Timeout`
    under @types/node, which this repo loads. The prototype's sentinel for "no
    watch armed" is 0, so the handle is typed as the interval's own return type
    and every check stays `if (sizeWatchId)`.
  */
  let sizeWatchId: ReturnType<typeof setInterval> | 0 = 0
  let resizeCount = 0
  let frameCount = 0
  function armSizeWatch(): void {
    if (sizeWatchId) return
    sizeWatchId = setInterval(function () {
      if (resize()) {
        clearInterval(sizeWatchId)
        sizeWatchId = 0
        schedule()
      }
    }, 150)
  }
  function resize(): boolean {
    resizeCount++
    const rect = root.getBoundingClientRect()
    const w = Math.round(rect.width)
    const h = Math.round(rect.height)
    if (w <= 1 || h <= 1) {
      armSizeWatch()
      return false
    }
    const d = Math.min(window.devicePixelRatio || 1, DPR_CAP)
    if (w === vw && h === vh && d === dpr) return false
    if (sizeWatchId) {
      clearInterval(sizeWatchId)
      sizeWatchId = 0
    }
    vw = w
    vh = h
    dpr = d
    canvas.width = Math.round(vw * dpr)
    canvas.height = Math.round(vh * dpr)
    canvas.style.width = vw + "px"
    canvas.style.height = vh + "px"
    // Label and node sprites are baked at device resolution.
    bakeAllLabels()
    bakeAllNodes()
    bgBand = null
    // The layer's own size is checked when it is next rendered, but the camera
    // it was anchored to is gone with the old viewport.
    layerValid = false
    const wasHome = Math.abs(cam.k - homeCam.k) < 0.001
    if (wasHome) home(true)
    else home(false)
    return true
  }

  function currentLabelBand(): number {
    const k = cam.k
    if (k < 0.3) return 0
    if (k < 0.55) return 1
    return 2
  }

  function updatePositions(now: number, dt: number): void {
    const t = now / 1000
    const amp = reduced || gesture ? 0 : DRIFT_AMP
    let i: number, n: EngineNode
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i]
      if (amp > 0) {
        const p1 = rand01(n.seed, 1) * 6.283
        const p2 = rand01(n.seed, 2) * 6.283
        const s1 = 0.28 + rand01(n.seed, 3) * 0.22
        const s2 = 0.19 + rand01(n.seed, 4) * 0.18
        n.dx = Math.sin(t * s1 + p1) * amp
        n.dy = Math.cos(t * s2 + p2) * amp * 0.8
      } else {
        n.dx = n.dy = 0
      }
    }
    /*
      Anti-collision: two Gauss-Seidel passes, offset decays home. Held still
      for the duration of a rigid pan, alongside the drift above. Both exist to
      keep the board from settling into a lattice, and neither is worth a
      sub-pixel creep while the user is moving the board -- but more to the
      point, a node that shifts mid-pan moves its threads with it, and that is
      exactly what the cached thread layer cannot express. Frozen here, the
      scene is a pure translation and the cache is exact rather than nearly
      right.
    */
    if (cam.k > 0.34 && !panIsRigid()) {
      for (let pass = 0; pass < 2; pass++) {
        for (i = 0; i < nodes.length; i++) {
          const a = nodes[i]
          const axp = a.bx + a.ox
          const ayp = a.by + a.oy
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j]
            const dx = b.bx + b.ox - axp
            const dy = b.by + b.oy - ayp
            const rr = a.r + b.r + 2
            const d2 = dx * dx + dy * dy
            if (d2 >= rr * rr || d2 < 0.0001) continue
            const d = Math.sqrt(d2)
            const push = (rr - d) * 0.5
            const ux = dx / d,
              uy = dy / d
            a.ox -= ux * push
            a.oy -= uy * push
            b.ox += ux * push
            b.oy += uy * push
          }
        }
      }
      const cap = 16
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i]
        n.ox = clamp(n.ox, -cap, cap)
        n.oy = clamp(n.oy, -cap, cap)
        n.ox *= 0.995
        n.oy *= 0.995
      }
    }
    // Project to screen.
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i]
      const wx = n.bx + n.ox + n.dx
      const wy = n.by + n.oy + n.dy
      n.sx = wx * cam.k + cam.x
      n.sy = wy * cam.k + cam.y
      n.sr = n.r * cam.k
      n.visible = n.sx > -80 && n.sx < vw + 80 && n.sy > -80 && n.sy < vh + 80
    }
  }

  function updateEmphasis(): void {
    const keep = selected ? neighborSet(selected) : null
    let i: number, n: EngineNode
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i]
      let on = true
      if (keep) on = !!keep[n.id]
      if (filterType) {
        // incidence is O(degree) via the cached adjacency, not O(edges)
        let inc = false
        for (let a = 0; a < n.adjEdges.length; a++) {
          if (edges[n.adjEdges[a]].type === filterType) {
            inc = true
            break
          }
        }
        if (!inc) on = false
      }
      n.alpha = on ? 1 : 0.15
    }
    for (i = 0; i < edges.length; i++) {
      const eg = edges[i]
      let vis = !filterType || eg.type === filterType
      // With a selection live, keep the induced neighbourhood subgraph.
      if (keep) vis = vis && !!keep[eg.a.id] && !!keep[eg.b.id]
      eg.alpha = vis ? 1 : 0.055
      eg.emphasis = keep && keep[eg.a.id] && keep[eg.b.id] ? 1 : 0
    }
  }

  function frame(now: number): void {
    rafId = 0
    frameCount++
    const dt = Math.min(64, Math.max(0, now - (lastFrame || now)))
    lastFrame = now

    // camera glide
    const a = reduced ? 1 : 1 - Math.exp(-dt / CAM_TAU)
    cam.x += (target.x - cam.x) * a
    cam.y += (target.y - cam.y) * a
    cam.k += (target.k - cam.k) * a
    if (
      Math.abs(target.x - cam.x) < 0.05 &&
      Math.abs(target.y - cam.y) < 0.05 &&
      Math.abs(target.k - cam.k) < 0.0004
    ) {
      cam.x = target.x
      cam.y = target.y
      cam.k = target.k
    }

    if (introT < 1) introT = clamp(introT + dt / (reduced ? 1 : 900), 0, 1)

    drainPortraits(5)
    updatePositions(now, dt)
    updateEmphasis()
    /*
      A throwing theme callback must not be able to stop the board dead. The
      first failure is reported loudly (once, with its stack) and then the
      loop keeps running, so a broken draw pass degrades to a frozen-looking
      layer instead of a canvas that never repaints again.
    */
    try {
      paint(now, dt)
    } catch (err) {
      if (!paintError) {
        paintError = true
        console.error("DCPHEngine: paint failed", err)
      }
    }

    const band = currentLabelBand()
    if (band !== labelBand) labelBand = band

    // idle park: stop the loop entirely once nothing is moving
    const settled =
      Math.abs(target.x - cam.x) < 0.1 &&
      Math.abs(target.y - cam.y) < 0.1 &&
      Math.abs(target.k - cam.k) < 0.001 &&
      !gesture &&
      !portraitQueue.length
    if (reduced || (settled && now - lastPoke > IDLE_PARK_MS && introT >= 1)) {
      parked = true
      return
    }
    schedule()
  }

  function paint(now: number, dt: number): void {
    const t = now / 1000
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, vw, vh)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"

    if (theme.beforeWorld) {
      const st: WorldState = {
        vw: vw,
        vh: vh,
        cam: cam,
        dpr: dpr,
        t: t,
        dt: dt,
        selected: selected,
        hovered: hovered,
        filterType: filterType,
        // The frozen `WorldState` types `focusId` as an optional string, so the
        // prototype's `null` ("nothing focused") has to travel as `undefined`.
        // Nothing reads it: every consumer is an engine-internal `focusId`.
        focusId: focusId ?? undefined,
        graph: graphView,
        data: data,
      }
      theme.beforeWorld(ctx, st)
    }

    paintThreads(t)
    drawNodes(t, now)
    drawLabels()

    if (theme.afterWorld) {
      const st: WorldState = {
        vw: vw,
        vh: vh,
        cam: cam,
        dpr: dpr,
        t: t,
        dt: dt,
        selected: selected,
        hovered: hovered,
        filterType: filterType,
        graph: graphView,
        data: data,
      }
      theme.afterWorld(ctx, st)
    }

    moveBackground()
  }

  function moveBackground(): void {
    if (!theme.bgMotion || theme.bgMotion.mode !== "world" || !bgEl) return
    const tile = theme.bgMotion.tile
    const band = Math.round(clamp(cam.k, 0.3, 3) * 4) / 4
    const tilePx = tile * band
    if (bgBand !== band) {
      bgBand = band
      /*
        `layers` lets a theme stack the SAME grain tile at several scales —
        fine tooth over coarse mottle is what makes a surface read as paper
        or cork rather than as noise. Every layer stays world-anchored, which
        a single background-size cannot express.
      */
      /*
        The frozen `BgMotion.layers` is typed `number`; the prototype reads it
        as the list of scale factors this branch walks (`theme-b.js:233`
        `layers: [1, 3.4]`). Read as a list here; reported as a contract gap.
      */
      const layers = (theme.bgMotion as { layers?: number[] }).layers
      if (layers && layers.length) {
        const sizes: string[] = []
        for (let li = 0; li < layers.length; li++) sizes.push(tilePx * layers[li] + "px")
        bgEl.style.backgroundSize = sizes.join(", ")
      } else {
        bgEl.style.backgroundSize = tilePx + "px " + tilePx + "px"
      }
      if (theme.bgMotion.secondSize) {
        bgEl.style.setProperty("--tile2", tilePx * theme.bgMotion.secondSize + "px")
      }
    }
    const ox = ((cam.x % tilePx) + tilePx) % tilePx
    const oy = ((cam.y % tilePx) + tilePx) % tilePx
    bgEl.style.transform = "translate3d(" + ox.toFixed(1) + "px," + oy.toFixed(1) + "px,0)"
  }

  /*
    True while the scene is provably a rigid screen-space translation of its
    previous self: a single pointer panning empty space, intro finished so the
    thread fade is not still running, and no node being dragged or pinch
    zooming -- both of which move or rescale things *inside* the board.

    Under this condition `updatePositions` writes no motion at all (drift is
    off for any gesture, and the anti-collision relaxation is held still
    alongside it) and the camera translates without scaling, so
    `sx = wx * cam.k + cam.x` differs from the previous frame by one constant.
  */
  function panIsRigid(): boolean {
    return gesture && !!panRef && !dragNode && !pinch && pointers.size === 1 && introT >= 1
  }

  /*
    The thread pass, from the cache when the pan is rigid and from scratch
    otherwise. See `threadLayerServes` above for why a pan can be a blit.
  */
  function paintThreads(t: number): void {
    const rigid = panIsRigid()
    sceneNow.selected = selected ? selected.id : null
    sceneNow.hovered = hovered ? hovered.id : null
    sceneNow.filter = filterType
    sceneNow.focus = focusId
    if (
      rigid &&
      layerValid &&
      layer &&
      layerCtx &&
      threadLayerServes(layerAnchor, cam, sceneNow, PAN_CACHE_M)
    ) {
      const off = threadLayerBlitOffset(layerAnchor, cam, dpr)
      layerHits++
      ctx.drawImage(
        layer,
        0,
        0,
        layer.width,
        layer.height,
        -PAN_CACHE_M + off.x,
        -PAN_CACHE_M + off.y,
        vw + 2 * PAN_CACHE_M,
        vh + 2 * PAN_CACHE_M,
      )
      return
    }

    if (rigid) {
      renderThreadLayer(t)
      return
    }

    /*
      Every other frame draws the threads straight to the visible canvas and
      leaves the layer stale, so the next pan re-anchors rather than blitting
      geometry that has moved since. That includes the inertia glide after a
      flick: the camera is still only translating, but drift and relaxation are
      live again, so the threads genuinely do move relative to the nodes.
    */
    layerValid = false
    drawEdges(t, ctx, 0, 0, vw, vh)
  }

  function renderThreadLayer(t: number): void {
    const w = vw + 2 * PAN_CACHE_M
    const h = vh + 2 * PAN_CACHE_M
    if (!layer) {
      layer = makeCanvas(1, 1)
      layerCtx = ctx2d(layer)
    }
    const lc = layerCtx
    if (!lc || !layer) return
    const lw = Math.round(w * dpr)
    const lh = Math.round(h * dpr)
    if (layer.width !== lw || layer.height !== lh) {
      layer.width = lw
      layer.height = lh
    }
    /*
      The layer is drawn in the same screen coordinates as the main canvas and
      shifted by its own margin, so `theme.drawEdge` needs no idea it is
      rendering anywhere but the viewport. Assigning width or height resets the
      context, so the transform is set after the resize, not before.
    */
    lc.setTransform(dpr, 0, 0, dpr, PAN_CACHE_M * dpr, PAN_CACHE_M * dpr)
    lc.clearRect(-PAN_CACHE_M, -PAN_CACHE_M, w, h)
    lc.lineCap = "round"
    lc.lineJoin = "round"
    drawEdges(t, lc, -PAN_CACHE_M, -PAN_CACHE_M, vw + PAN_CACHE_M, vh + PAN_CACHE_M)
    layerRenders++
    layerAnchor.x = cam.x
    layerAnchor.y = cam.y
    layerAnchor.k = cam.k
    layerAnchor.scene.selected = selected ? selected.id : null
    layerAnchor.scene.hovered = hovered ? hovered.id : null
    layerAnchor.scene.filter = filterType
    layerAnchor.scene.focus = focusId
    layerValid = true
    // Drawn immediately: this frame is the one the layer was built for, and
    // the alternative is a frame with no threads on it.
    ctx.drawImage(layer, 0, 0, layer.width, layer.height, -PAN_CACHE_M, -PAN_CACHE_M, w, h)
  }

  /*
    `x0..y1` is the screen-space rect the pass has to cover. It is the viewport
    when drawing straight to the canvas and the layer's own rect when drawing
    into the cache -- the cached pass has to include the threads a pan will
    reveal at the edges, not just the ones on screen at the moment it renders.
  */
  function drawEdges(
    t: number,
    dst: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): void {
    // A thread bows outside the segment between its endpoints, so the cull is
    // generous: an edge whose ends are both off the same side can still show.
    const margin = 90
    const left = x0 - margin,
      right = x1 + margin,
      top = y0 - margin,
      bottom = y1 + margin
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i]
      const aN = e.a,
        bN = e.b
      if (
        (aN.sx < left && bN.sx < left) ||
        (aN.sx > right && bN.sx > right) ||
        (aN.sy < top && bN.sy < top) ||
        (aN.sy > bottom && bN.sy > bottom)
      )
        continue
      let alpha = e.alpha
      if (introT < 1) alpha *= clamp((introT - 0.25) / 0.6, 0, 1)
      if (alpha < 0.012) continue
      const st: EdgeState = {
        alpha: alpha,
        k: cam.k,
        t: t,
        emphasis: e.emphasis,
        selected: selected,
        hovered: hovered,
        filterType: filterType,
        focused: focusId,
      }
      // Assertions across the frozen `Edge`'s id-typed `a`/`b` (also in
      // `renderDossier`): the theme gets the live edge record.
      theme.drawEdge(dst, e, st)
    }
  }

  function drawNodes(t: number, now: number): void {
    // Two passes instead of a sort: dimmed first so emphasised nodes paint on
    // top, with zero per-frame allocation.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]
        if (!n.visible) continue
        const isTop = n.alpha > 0.5 || n === selected
        if ((pass === 0) === isTop) continue
        const enter = reduced ? 1 : clamp((introT * 1400 - i * 5) / 700, 0, 1)
        const scale = reduced ? 1 : 0.55 + 0.45 * easeOutQuint(enter)
        const alpha = n.alpha * (reduced ? 1 : clamp(enter * 1.6, 0, 1))
        if (alpha < 0.02) continue
        const st: NodeState = {
          alpha: alpha,
          scale: scale,
          k: cam.k,
          t: t,
          size: spriteCssSize(n, cam.k) * scale,
          screenR: n.sr * scale,
          selected: n === selected,
          hovered: n === hovered,
          focused: n.id === focusId,
          isMatch: matches ? !!matches[n.id] : false,
          hasFilter: !!filterType,
          dimmed: n.alpha < 1,
          dpr: dpr,
        }
        theme.drawNode(ctx, n, st)
      }
    }
  }

  /* ── label placement: greedy, 4 candidates, hysteresis ─────────── */
  const placed: Rect[] = []
  function drawLabels(): void {
    if (introT < 1 && !reduced && introT < 0.5) return
    const L = theme.label
    const band = currentLabelBand()
    placed.length = 0
    const cand: [EngineNode, number][] = []
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      if (!n.visible || !n.labelSprite) continue
      if (n.tier === 1 && band < 1) continue
      if (n.tier === 2 && band < 2) continue
      const forced =
        n === selected || n === hovered || n.id === focusId || (matches && matches[n.id])
      if (n.tier === 2 && band < 2 && !forced) continue
      if (n.alpha < 0.5 && !forced) continue
      const pri = forced ? 100 : n === selected ? 90 : 40 - n.tier * 10 + n.degree * 0.1
      cand.push([n, pri])
    }
    cand.sort(function (p, q) {
      return q[1] - p[1]
    })

    const offs = L.offsets || [0, 1, 2, 3]
    let drawn = 0
    for (let c = 0; c < cand.length && drawn < MAX_LABELS; c++) {
      const node = cand[c][0]
      const sp = node.labelSprite
      if (!sp) continue // unreachable: only nodes with a plate are candidates
      // Constant device size — the whole point of screen-space labels.
      const w = sp.w,
        h = sp.h
      const gap = node.sr + (L.gap == null ? 7 : L.gap)
      const rects: Rect[] = [
        [node.sx - w / 2, node.sy + gap, w, h],
        [node.sx - w / 2, node.sy - gap - h, w, h],
        [node.sx + gap, node.sy - h / 2, w, h],
        [node.sx - gap - w, node.sy - h / 2, w, h],
      ]
      let chosen = -1
      // hysteresis: keep last winning offset when it still fits
      const first = node.labelOff >= 0 ? node.labelOff : offs[0]
      const tryOrder = [first].concat(
        offs.filter(function (o) {
          return o !== first
        }),
      )
      for (let oi = 0; oi < tryOrder.length; oi++) {
        const r = rects[tryOrder[oi]]
        /*
          A nameplate must be entirely on screen. The old tolerance let a
          label overhang the frame by 40px, which is only ever visible as a
          name sliced in half at the edge -- it never reads as "there is more
          graph over there", because the graph itself is what says that.
          Dropping the label is the better failure: the node is still there
          and the name returns as soon as it is panned into view.
        */
        if (r[0] < 0 || r[0] + r[2] > vw || r[1] < 0 || r[1] + r[3] > vh) continue
        if (!collides(r)) {
          chosen = tryOrder[oi]
          break
        }
      }
      if (chosen < 0) continue
      node.labelOff = chosen
      const rect = rects[chosen]
      placed.push(rect)
      const forced2 = node === selected || node === hovered || (matches && matches[node.id])
      const la = node.alpha < 1 && !forced2 ? 0.55 : 1
      ctx.globalAlpha = la
      if (chosen !== 0 && L.leader !== false) {
        ctx.strokeStyle = L.leaderColor || "rgba(255,255,255,0.28)"
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(node.sx, node.sy + (chosen === 1 ? -node.sr * 0.6 : 0))
        ctx.lineTo(rect[0] + rect[2] / 2, rect[1] + rect[3] / 2)
        ctx.stroke()
      }
      ctx.drawImage(sp.canvas, rect[0], rect[1], w, h)
      ctx.globalAlpha = 1
      drawn++
    }
    const hudN = slots.hud && slots.hud.querySelector("[data-labels]")
    if (hudN) hudN.textContent = String(drawn)
  }

  function collides(r: Rect): boolean {
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i]
      if (r[0] < p[0] + p[2] && r[0] + r[2] > p[0] && r[1] < p[1] + p[3] && r[1] + r[3] > p[1])
        return true
    }
    return false
  }

  /* ── input ─────────────────────────────────────────────────────── */
  function localPoint(ev: MouseEvent): Pt {
    const rect = canvas.getBoundingClientRect()
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
  }

  function hitTest(sx: number, sy: number): EngineNode | null {
    let best: EngineNode | null = null,
      bestD = Infinity
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      if (!n.visible) continue
      const dx = sx - n.sx,
        dy = sy - n.sy
      const d = Math.sqrt(dx * dx + dy * dy)
      const hit = Math.max(n.sr + 6, 14)
      if (d < hit && d < bestD) {
        best = n
        bestD = d
      }
    }
    return best
  }

  function beginPinch(): void {
    scratchPts.length = 0
    pointers.forEach(function (p) {
      scratchPts.push(p)
    })
    const p0 = scratchPts[0],
      p1 = scratchPts[1]
    if (!p0 || !p1) return
    const mx = (p0.x + p1.x) / 2,
      my = (p0.y + p1.y) / 2
    pinch = {
      d: Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1,
      mx: mx,
      my: my,
      wx: (mx - cam.x) / cam.k,
      wy: (my - cam.y) / cam.k,
      k: cam.k,
    }
    gesture = true
    vel.x = vel.y = 0
  }

  function onPointerDown(ev: PointerEvent): void {
    if (ev.pointerType === "mouse" && ev.button !== 0) return
    const p = localPoint(ev)
    pointers.set(ev.pointerId, { x: p.x, y: p.y, type: ev.pointerType })
    try {
      canvas.setPointerCapture(ev.pointerId)
    } catch (e) {}
    wake()
    if (pointers.size === 2) {
      dragNode = null
      panRef = null
      beginPinch()
      return
    }
    if (pointers.size > 2) return
    // A tap must stop an in-flight glide exactly, so anchor the target on the
    // current visual position rather than letting inertia carry on.
    target.x = cam.x
    target.y = cam.y
    target.k = cam.k
    const n = hitTest(p.x, p.y)
    didDrag = false
    downAt = performance.now()
    downPos = { x: p.x, y: p.y }
    history.length = 0
    history.push({ x: p.x, y: p.y, t: downAt })
    if (n) {
      dragNode = n
      dragNode._dragStart = { x: n.bx, y: n.by }
      dragNode._down = { x: p.x, y: p.y }
      gesture = true
    } else {
      panRef = { x: p.x, y: p.y, cx: cam.x, cy: cam.y }
      gesture = true
    }
  }

  function onPointerMove(ev: PointerEvent): void {
    const rec = pointers.get(ev.pointerId)
    const p = localPoint(ev)
    if (!rec) {
      // plain hover
      if (pointers.size === 0) {
        const h = hitTest(p.x, p.y)
        if (h !== hovered) {
          hovered = h
          canvas.style.cursor = h ? "pointer" : "grab"
          schedule()
        }
      }
      return
    }
    rec.x = p.x
    rec.y = p.y
    const now = performance.now()
    history.push({ x: p.x, y: p.y, t: now })
    if (history.length > 8) history.shift()

    if (pointers.size >= 2 && pinch) {
      scratchPts.length = 0
      pointers.forEach(function (q) {
        scratchPts.push(q)
      })
      const p0 = scratchPts[0],
        p1 = scratchPts[1]
      const d = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1
      const mx = (p0.x + p1.x) / 2,
        my = (p0.y + p1.y) / 2
      const k = clamp(pinch.k * (d / pinch.d), kMin, kMax)
      cam.k = target.k = k
      cam.x = target.x = mx - pinch.wx * k
      cam.y = target.y = my - pinch.wy * k
      didDrag = true
      schedule()
      return
    }

    if (dragNode) {
      const dx = (p.x - dragNode._down.x) / cam.k
      const dy = (p.y - dragNode._down.y) / cam.k
      if (Math.abs(p.x - downPos.x) > TAP_SLOP || Math.abs(p.y - downPos.y) > TAP_SLOP)
        didDrag = true
      dragNode.bx = dragNode._dragStart.x + dx
      dragNode.by = dragNode._dragStart.y + dy
      dragNode.ox = dragNode.oy = 0
      schedule()
      return
    }

    if (panRef) {
      const ddx = p.x - panRef.x
      const ddy = p.y - panRef.y
      if (Math.abs(ddx) > TAP_SLOP || Math.abs(ddy) > TAP_SLOP) didDrag = true
      cam.x = target.x = panRef.cx + ddx
      cam.y = target.y = panRef.cy + ddy
      schedule()
    }
  }

  function onPointerUp(ev: PointerEvent): void {
    const rec = pointers.get(ev.pointerId)
    pointers.delete(ev.pointerId)
    try {
      canvas.releasePointerCapture(ev.pointerId)
    } catch (e) {}

    if (pointers.size >= 2) {
      beginPinch()
      return
    }
    if (pointers.size === 1) {
      let rest: PointerRec | null = null
      pointers.forEach(function (q) {
        rest = q
      })
      pinch = null
      // The prototype dereferences `rest` unguarded here; control-flow analysis
      // cannot see the assignment made inside the callback, so the value is
      // re-asserted to its declared type before the (unreachable) guard.
      const restPoint = rest as PointerRec | null
      if (!restPoint) return // unreachable: size === 1 guarantees one entry
      panRef = { x: restPoint.x, y: restPoint.y, cx: cam.x, cy: cam.y }
      return
    }
    pinch = null
    const wasNode = dragNode
    const wasPan = panRef
    dragNode = null
    panRef = null
    gesture = false
    lastPoke = performance.now()

    const now = performance.now()
    const isTap = !didDrag && now - downAt < TAP_MS
    if (isTap) {
      if (wasNode) {
        selectNode(wasNode)
        tapConsumed = true
      } else {
        const n = hitTest(downPos.x, downPos.y)
        if (n) {
          selectNode(n)
          tapConsumed = true
        } else if (selected) {
          selectNode(null)
        }
      }
    } else if (wasPan && !reduced) {
      // Projected inertia into the camera target.
      const v = velocity()
      target.x = cam.x + v.x * PAN_INERTIA_MS
      target.y = cam.y + v.y * PAN_INERTIA_MS
    }
    schedule()
  }

  function velocity(): Pt {
    if (history.length < 2) return { x: 0, y: 0 }
    const last = history[history.length - 1]
    let ref: HistPt | null = null
    for (let i = history.length - 2; i >= 0; i--) {
      if (last.t - history[i].t >= 70) {
        ref = history[i]
        break
      }
    }
    if (!ref) ref = history[0]
    const dt = Math.max(1, last.t - ref.t)
    return { x: ((last.x - ref.x) / dt) * 16.6, y: ((last.y - ref.y) / dt) * 16.6 }
  }

  function onWheel(ev: WheelEvent): void {
    ev.preventDefault()
    wake()
    const p = localPoint(ev)
    const unit = ev.deltaMode === 2 ? 400 : ev.deltaMode === 1 ? 16 : 1
    const dy = ev.deltaY * unit
    const gain = ev.ctrlKey ? 0.0075 : 0.0016
    zoomAt(p.x, p.y, Math.exp(-clamp(dy, -220, 220) * gain), true)
  }

  function onKey(ev: KeyboardEvent): void {
    /*
      `ev.target` is an `EventTarget`; the prototype read `.tagName` off it,
      which is undefined for a non-element target and so never matched the
      regex. The element check keeps that reading without an assertion.
    */
    const t = ev.target
    if (t instanceof Element && /INPUT|TEXTAREA/.test(t.tagName)) return
    if (ev.key === "Escape") {
      if (selected) selectNode(null)
      else if (filterType) setFilter(filterType)
    } else if (ev.key === "+" || ev.key === "=") zoomAt(vw / 2, vh / 2, 1.35, true)
    else if (ev.key === "-" || ev.key === "_") zoomAt(vw / 2, vh / 2, 1 / 1.35, true)
    else if (ev.key === "0") home(false)
    else if (ev.key === "f" || ev.key === "F") {
      if (graph.hubNode) selectNode(graph.hubNode)
    }
  }

  /* ── chrome ────────────────────────────────────────────────────── */
  const TYPES = [
    "romance",
    "family",
    "friendship",
    "rivalry",
    "mentor",
    "colleague",
    "secret_identity",
    "adversary",
  ]
  const TYPE_LABEL: Record<string, string> = {
    romance: "Romance",
    family: "Family",
    friendship: "Friendship",
    rivalry: "Rivalry",
    mentor: "Mentor",
    colleague: "Colleague",
    secret_identity: "Secret Identity",
    adversary: "Adversary",
  }
  /*
    The dossier gets the `TYPE_LABEL` *table*: all four themes index it
    (`theme-a.js:612` `d.typeLabel[t.e.type]`), while the frozen
    `DossierContext` declares it as a callable. One object satisfies both
    readings — a function that also carries the table's keys. Reported as a
    contract mismatch.
  */
  const TYPE_LABELS: ((type: string) => string) & Record<string, string> = Object.assign(
    function (type: string) {
      return TYPE_LABEL[type]
    },
    TYPE_LABEL,
  )

  /*
    `Element.getAttribute` is `string | null`; an absent attribute is a lookup
    miss, which is what the prototype's `graph.byId[null]` was too (it found
    nothing). Used by the delegated chrome handlers.
  */
  function nodeByAttr(el: Element, attr: string): EngineNode | undefined {
    const id = el.getAttribute(attr)
    return id == null ? undefined : graph.byId[id]
  }

  function typeCount(t: string): number {
    let c = 0
    for (let i = 0; i < edges.length; i++) if (edges[i].type === t) c++
    return c
  }

  /*
    The legend is a key, so each swatch has to be a truthful sample of the
    thread it names: same bow, same dash, same knot, same cord highlight.
    A row of flat colour chips would teach nothing about a graph whose types
    are distinguished by geometry as much as by hue.
  */
  function swatchSvg(type: string): string {
    /*
      `EdgeStyle.label` is required by the frozen contract and the prototype's
      fallback omits it; `type` is the honest fill and `swatchSvg` never reads
      it.
    */
    const s = theme.edgeStyle ? theme.edgeStyle(type) : { color: "#fff", width: 2, label: type }
    const w = Math.max(1, Math.min(5.5, s.width))
    const bow = s.bow || 0
    const cy = 5 + bow * 20
    const qy = 2.5 + cy * 0.5 // curve's own y at t = 0.5
    const d = bow === 0 ? "M2 5 H28" : "M2 5 Q15 " + cy.toFixed(1) + " 28 5"
    const dash = s.dash ? ' stroke-dasharray="' + s.dash.join(" ") + '"' : ""
    let g =
      '<path d="' +
      d +
      '" stroke="' +
      s.color +
      '" stroke-width="' +
      w.toFixed(1) +
      '" stroke-linecap="round" fill="none"' +
      dash +
      " />"
    if (s.cord) {
      g +=
        '<path d="' +
        d +
        '" stroke="rgba(255,255,255,0.42)" stroke-width="' +
        Math.max(0.6, w * 0.26).toFixed(1) +
        '" stroke-linecap="round" fill="none" transform="translate(0,-0.8)"' +
        dash +
        " />"
    }
    if (s.knot === "loop")
      g +=
        '<circle cx="15" cy="' +
        qy.toFixed(1) +
        '" r="2.3" fill="none" stroke="' +
        s.color +
        '" stroke-width="1.2" />'
    else if (s.knot === "pin")
      g += '<circle cx="15" cy="' + qy.toFixed(1) + '" r="1.7" fill="' + s.color + '" />'
    else if (s.knot === "cross")
      g +=
        '<path d="M12.5 ' +
        (qy - 2.5).toFixed(1) +
        "L17.5 " +
        (qy + 2.5).toFixed(1) +
        "M17.5 " +
        (qy - 2.5).toFixed(1) +
        "L12.5 " +
        (qy + 2.5).toFixed(1) +
        '" stroke="' +
        s.color +
        '" stroke-width="1.3" stroke-linecap="round" />'
    else if (s.knot === "arrow")
      g +=
        '<path d="M24 2.4L27.6 5L24 7.6" fill="none" stroke="' +
        s.color +
        '" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />'
    return '<svg viewBox="0 0 30 10" width="30" height="10" aria-hidden="true">' + g + "</svg>"
  }

  function renderLegend(): void {
    const host = slots.legend
    if (!host) return
    /*
      The panel wrapper belongs to the engine, not the theme: every variant
      styles `.legend` as its own material (card, key box, tray), and a
      legendHead() that had to remember to open the div got it wrong.

      The tray also starts COLLAPSED, behind a small pinned tab. An open key
      panel is ~250x240 of opaque material and, in a graph this evenly dense,
      there is no corner of the board where it hides nothing — so it would
      either cost ~20% of the establishing zoom to reserve a column for it,
      or bury two characters. Collapsed, it costs a tab; opened, it is a
      deliberate act and hiding a node for as long as you read the key is
      exactly what a hand-held card does. This also matches the shipped app,
      where the legend is a popover behind the filter chip.
    */
    const collapsed = theme.legendCollapsible !== false && !legendOpen
    let html =
      '<div class="legend-wrap' +
      (collapsed ? "" : " is-open") +
      '">' +
      '<button type="button" class="legend__tab" data-legend-toggle aria-expanded="' +
      (collapsed ? "false" : "true") +
      '">' +
      (theme.legendTab ? theme.legendTab() : '<span class="legend__tab-label">Thread key</span>') +
      "</button>" +
      '<div class="legend">' +
      (theme.legendHead ? theme.legendHead() : '<div class="legend__head">Threads</div>') +
      '<ul class="legend__list">'
    for (let i = 0; i < TYPES.length; i++) {
      const t = TYPES[i]
      html +=
        '<li><button type="button" class="legend__item' +
        (filterType === t ? " is-active" : "") +
        '" data-type="' +
        t +
        '" aria-pressed="' +
        (filterType === t) +
        '">' +
        '<span class="legend__swatch">' +
        swatchSvg(t) +
        "</span>" +
        '<span class="legend__label">' +
        (theme.typeLabel ? theme.typeLabel(t) : TYPE_LABEL[t]) +
        "</span>" +
        '<span class="legend__count">' +
        typeCount(t) +
        "</span>" +
        "</button></li>"
    }
    html += "</ul>"
    if (filterType) html += '<button type="button" class="legend__clear">Clear filter</button>'
    /*
      The tray is rewritten whole, so the control the user just activated is
      destroyed along with it and focus falls to the body: a keyboard user would
      have to Tab in from the top of the page again after every filter. Note
      which control had focus, then hand it to its replacement — the same
      thread type, or the tab when the control is gone (the filter was
      cleared).
    */
    const prev = document.activeElement
    const held =
      prev instanceof Element && host.contains(prev)
        ? prev.hasAttribute("data-legend-toggle")
          ? "tab"
          : prev.getAttribute("data-type") || "clear"
        : null
    host.innerHTML = html + "</div></div>"
    if (held) {
      const next =
        held === "tab"
          ? host.querySelector("[data-legend-toggle]")
          : host.querySelector('.legend__item[data-type="' + held + '"]') ||
            host.querySelector(".legend__clear") ||
            host.querySelector("[data-legend-toggle]")
      if (next instanceof HTMLElement) next.focus()
    }
  }

  function renderTools(): void {
    const host = slots.tools
    if (!host) return
    host.innerHTML =
      '<div class="tools">' +
      '<button type="button" class="tools__btn" data-act="out" aria-label="Zoom out">–</button>' +
      '<span class="tools__k" data-k>100%</span>' +
      '<button type="button" class="tools__btn" data-act="in" aria-label="Zoom in">+</button>' +
      '<button type="button" class="tools__btn tools__btn--wide" data-act="home">Reset</button>' +
      "</div>"
  }

  /*
    The results list is the only part of the search panel that changes as you
    type, so it is the only part that is rewritten.

    Both the field and the results used to be written in one `innerHTML`
    assignment on every `input` event, which destroyed the `<input>` the user
    was typing into: the browser dropped focus to the body and the field kept
    exactly the first character. The node the user is typing in has to outlive
    the re-render it causes.
  */
  function renderSearchHits(host: HTMLElement): void {
    let list = host.querySelector("[data-search-hits]") as HTMLElement | null
    if (!matches) {
      if (list) list.remove()
      return
    }
    const ids = Object.keys(matches)
    const html = ids.length
      ? ids
          .slice(0, 8)
          .map(function (id) {
            const n = graph.byId[id]
            return (
              '<li><button type="button" class="search__hit" data-id="' +
              id +
              '"><span class="search__dot" style="background:' +
              factionOf(data.factions, n.faction)?.hue +
              '"></span><span class="search__name">' +
              n.label +
              '</span><span class="search__role">' +
              n.role +
              "</span></button></li>"
            )
          })
          .join("")
      : '<li class="search__none">No character matches.</li>'
    if (!list) {
      list = document.createElement("ul")
      list.className = "search__results"
      list.setAttribute("role", "listbox")
      list.setAttribute("data-search-hits", "")
      host.appendChild(list)
    }
    list.innerHTML = html
  }

  function renderSearch(): void {
    const host = slots.search
    if (!host) return
    let input = host.querySelector(".search__input") as HTMLInputElement | null
    if (!input) {
      host.innerHTML =
        (theme.searchHead ? theme.searchHead() : "") +
        '<div class="search">' +
        '<input class="search__input" type="search" placeholder="' +
        (theme.searchPlaceholder || "Search the cast") +
        '" aria-label="Search characters" />' +
        "</div>"
      input = host.querySelector(".search__input") as HTMLInputElement | null
    }
    // Only when the engine changed the query itself; writing the same value
    // back would move the caret to the end mid-word.
    if (input && input.value !== searchQuery) input.value = searchQuery
    renderSearchHits(host)
  }

  function renderHud(): void {
    const host = slots.hud
    if (!host) return
    host.innerHTML = theme.hud
      ? theme.hud()
      : '<div class="hud"><span class="hud__row">zoom <b data-k>100%</b></span>' +
        '<span class="hud__row">labels <b data-labels>0</b></span>' +
        '<span class="hud__row">portraits <b data-progress>0/0</b></span></div>'
  }

  function renderTitle(): void {
    const host = slots.title
    if (!host) return
    host.innerHTML = theme.title()
  }

  function renderDossier(): void {
    if (!dossierEl) return
    if (!selected) {
      dossierEl.classList.remove("is-open")
      dossierEl.innerHTML = ""
      dossierEl.setAttribute("aria-hidden", "true")
      return
    }
    const n = selected
    const inc: DossierThread[] = []
    edges.forEach(function (e) {
      // `other` is the far end of the thread; the edge itself is handed to the
      // theme so it can read the live geometry record.
      if (e.a === n) inc.push({ e: e, other: e.b, dir: "out" })
      else if (e.b === n) inc.push({ e: e, other: e.a, dir: "in" })
    })
    inc.sort(function (p, q) {
      return q.other.degree - p.other.degree
    })
    const fac = factionOf(data.factions, n.faction) || { label: "—", hue: "#888", short: "—" }
    const d: DossierContext = {
      node: n,
      faction: fac,
      threads: inc,
      typeLabel: TYPE_LABELS,
      swatch: swatchSvg,
      edgeStyle: theme.edgeStyle,
      esc: esc,
    }
    /*
      Following a thread replaces the whole file. If the user got here from the
      thread list, the button they pressed is gone with it and focus falls to
      the body; hand it to the new file's first control instead, so a keyboard
      user continues inside the file they just opened rather than at the top of
      the page.
    */
    const heldFocus = dossierEl.contains(document.activeElement)
    dossierEl.innerHTML = theme.dossier(d)
    dossierEl.classList.add("is-open")
    dossierEl.setAttribute("aria-hidden", "false")
    if (heldFocus) {
      const close = dossierEl.querySelector(".dossier__close")
      if (close instanceof HTMLElement) close.focus()
    }
  }

  function esc(s: unknown): string {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }
      return map[c]
    })
  }

  function renderA11y(): void {
    if (!a11yEl) return
    let html = ""
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      html +=
        '<li><button type="button" class="a11y__node" data-id="' +
        n.id +
        '">' +
        esc(n.name) +
        " — " +
        esc(n.role) +
        ", " +
        n.degree +
        " threads</button></li>"
    }
    a11yEl.innerHTML = html
  }

  function updateA11yFocus(): void {
    if (!a11yEl) return
    const btns = a11yEl.querySelectorAll("[data-id]")
    for (let i = 0; i < btns.length; i++) {
      btns[i].setAttribute(
        "aria-current",
        selected && btns[i].getAttribute("data-id") === selected.id ? "true" : "false",
      )
    }
  }

  /* chrome wiring (delegated) */
  function wireChrome(): void {
    on(root, "click", function (ev) {
      /*
        `ev.target` is an `EventTarget`; every branch below tests it with
        `closest`, exactly as the prototype did (which assumed a click target
        is an element). The cast states that assumption once.
      */
      const t = ev.target as Element
      if (t.closest && t.closest("[data-legend-toggle]")) {
        legendOpen = !legendOpen
        renderLegend()
        schedule()
        return
      }
      const legendBtn = t.closest && t.closest(".legend__item")
      if (legendBtn) {
        setFilter(legendBtn.getAttribute("data-type"))
        return
      }
      if (t.closest && t.closest(".legend__clear")) {
        filterType = null
        renderLegend()
        schedule()
        return
      }
      const toolBtn = t.closest && t.closest(".tools__btn")
      if (toolBtn) {
        const act = toolBtn.getAttribute("data-act")
        if (act === "in") zoomAt(vw / 2, vh / 2, 1.35, true)
        else if (act === "out") zoomAt(vw / 2, vh / 2, 1 / 1.35, true)
        else home(false)
        return
      }
      const hit = t.closest && t.closest(".search__hit")
      if (hit) {
        const n = nodeByAttr(hit, "data-id")
        if (n) selectNode(n, { k: Math.max(1.1, cam.k) })
        return
      }
      const a11yBtn = t.closest && t.closest(".a11y__node")
      if (a11yBtn) {
        const an = nodeByAttr(a11yBtn, "data-id")
        if (an) {
          hovered = an
          selectNode(an)
        }
        return
      }
      if (t.closest && t.closest(".dossier__close")) {
        selectNode(null)
        return
      }
      const thread = t.closest && t.closest("[data-goto]")
      if (thread) {
        const tn = nodeByAttr(thread, "data-goto")
        if (tn) selectNode(tn)
      }
    })

    on(root, "input", function (ev) {
      // The prototype read `.value` off the target, which only exists on an
      // input; the class check is what makes that safe.
      const t = ev.target as HTMLInputElement | null
      if (t && t.classList.contains("search__input")) {
        setSearch(t.value)
      }
    })

    on(root, "pointerover", function (ev) {
      const t = ev.target as Element
      const a11yBtn = t.closest && t.closest(".a11y__node")
      if (a11yBtn) {
        const n = nodeByAttr(a11yBtn, "data-id")
        if (n) {
          hovered = n
          schedule()
        }
      }
    })

    on(root, "focusin", function (ev) {
      const t = ev.target as Element
      const a11yBtn = t.closest && t.closest(".a11y__node")
      if (a11yBtn) {
        const n = nodeByAttr(a11yBtn, "data-id")
        if (n) {
          hovered = n
          focusNode(n)
        }
      }
    })
  }

  /* ── boot ──────────────────────────────────────────────────────── */
  function updateHudK(): void {
    const el = slots.tools && slots.tools.querySelector("[data-k]")
    if (el) el.textContent = Math.round(cam.k * 100) + "%"
    const el2 = slots.hud && slots.hud.querySelector("[data-k]")
    if (el2) el2.textContent = Math.round(cam.k * 100) + "%"
  }

  const hudTimer = setInterval(updateHudK, 120)

  function start(): void {
    // The noise tile is generated once and handed to CSS, never re-rendered.
    root.style.setProperty("--noise", 'url("' + bakeNoise() + '")')
    loadPortraits()
    bakeAllNodes()
    renderTitle()
    renderLegend()
    renderTools()
    renderSearch()
    renderHud()
    renderA11y()
    wireChrome()

    on(canvas, "pointerdown", onPointerDown)
    on(canvas, "pointermove", onPointerMove)
    on(canvas, "pointerup", onPointerUp)
    on(canvas, "pointercancel", onPointerUp)
    on(canvas, "pointerleave", function (ev) {
      if (pointers.size === 0 && hovered) {
        hovered = null
        schedule()
      }
    })
    on(canvas, "wheel", onWheel, { passive: false })
    on(canvas, "contextmenu", function (ev) {
      ev.preventDefault()
    })
    on(window, "keydown", onKey)
    on(window, "blur", function () {
      pointers.clear()
      gesture = false
      panRef = dragNode = pinch = null
    })
    on(document, "visibilitychange", function () {
      if (document.hidden) parked = true
      else wake()
    })

    const ro = new ResizeObserver(function () {
      if (resize()) schedule()
    })
    ro.observe(root)
    listeners.push([null, "ro", ro, null])

    resize()
    home(true)
    lastPoke = performance.now()
    schedule()

    /*
      Both label AND node sprites are baked before webfonts land on a cold
      load, and node art routinely carries type (faction codes, seal glyphs,
      plate identifiers). So the font-ready pass has to re-bake nodes too, or
      the first paint silently ships a fallback face in every one of them.
      Guarded because `loadingdone` fires more than once and re-baking 95
      sprites is not free.
    */
    let fontsBaked = false
    function fontsReady(): void {
      if (fontsBaked) return
      fontsBaked = true
      bakeAllLabels()
      bakeAllNodes()
      schedule()
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(fontsReady)
      if (document.fonts.addEventListener)
        document.fonts.addEventListener("loadingdone", fontsReady)
    } else {
      setTimeout(fontsReady, 400)
    }

    // second pass after images settle
    setTimeout(function () {
      resize()
      wake()
    }, 600)
  }

  start()

  return {
    /*
      The frozen `Engine.select` takes an id where the prototype's took a node;
      an unknown id is a no-op, as in `focus`.
    */
    select: function (id) {
      if (id === null) {
        selectNode(null)
        return
      }
      const n = graph.byId[id]
      if (n) selectNode(n)
    },
    focus: function (id) {
      const n = graph.byId[id]
      if (n) selectNode(n)
    },
    /* The frozen `Engine.home` takes no argument; the instant jump
       (`home(true)`) stays internal to `resize()` and `start()`. */
    home: function () {
      home(false)
    },
    setFilter: setFilter,
    setSearch: setSearch,
    graph: graphView,
    theme: theme,
    /*
      QA surface. vw/vh/dpr are what the renderer actually believes the
      viewport to be — which is the only way to tell a layout bug from a
      paint bug from the outside, since a canvas that was never sized
      looks identical to one that painted nothing.
    */
    stats: function (): EngineStats {
      return {
        k: cam.k,
        labels: placed.length,
        portraits: spritesReady,
        vw: vw,
        vh: vh,
        dpr: dpr,
        resizes: resizeCount,
        frames: frameCount,
        queued: portraitQueue.length,
        parked: parked,
        /*
          Union of every nameplate rect placed this frame, in screen space.
          A label is allowed to overhang the frame by a small tolerance, so
          "is anything clipped" cannot be answered from the camera alone --
          this is the measurement that says whether the establishing fit and
          the label halo actually agree with each other.
        */
        labelBounds: (function (): Rect | null {
          if (!placed.length) return null
          let l = Infinity,
            t = Infinity,
            r = -Infinity,
            b = -Infinity
          for (let i = 0; i < placed.length; i++) {
            const q = placed[i]
            if (q[0] < l) l = q[0]
            if (q[1] < t) t = q[1]
            if (q[0] + q[2] > r) r = q[0] + q[2]
            if (q[1] + q[3] > b) b = q[1] + q[3]
          }
          return [Math.round(l), Math.round(t), Math.round(r), Math.round(b)]
        })(),
        /*
          The individual nameplate rects, not just their union. A test that
          samples the canvas has to know where the ink it is NOT looking for
          lives, and every nameplate is opaque plate plus halo.
        */
        labelRects: placed.map(function (q): Rect {
          return [q[0], q[1], q[2], q[3]]
        }),
        rect: [
          Math.round(root.getBoundingClientRect().width),
          Math.round(root.getBoundingClientRect().height),
        ],
        cam: [cam.x, cam.y],
        layerHits: layerHits,
        layerRenders: layerRenders,
      }
    },
    /*
      Advance the loop n frames on a synthetic clock. Headless QA only: an
      occluded or headless tab throttles rAF to nothing, so without this a
      screenshot pass can only ever capture the first frame — no portraits
      drained, no labels placed — and the board looks broken when it is
      merely unpainted. Real browsers never call it.
    */
    tick: function (n, stepMs) {
      const step = stepMs || 16.7
      // Seed from whichever is later so the synthetic clock never runs
      // backwards into the previous frame's timestamp: a negative dt would
      // invert the camera easing and push the view away from its target.
      let t = Math.max(performance.now(), lastFrame)
      stepping = true
      try {
        for (let i = 0; i < (n || 1); i++) {
          t += step
          frame(t)
        }
      } finally {
        stepping = false
      }
      wake()
    },
    destroy: function () {
      clearInterval(hudTimer)
      clearInterval(sizeWatchId)
      sizeWatchId = 0
      if (rafId) cancelAnimationFrame(rafId)
      listeners.forEach(function (l) {
        if (l[0] === null) l[2].disconnect()
        else l[0].removeEventListener(l[1], l[2], l[3])
      })
    },
  }
}
