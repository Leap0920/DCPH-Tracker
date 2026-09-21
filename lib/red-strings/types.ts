/*
  red-strings/types — the contract between the renderer and an art direction.

  FROZEN. `engine.ts` is written against these types and `theme.ts` implements
  them; the two must not be edited into agreement, because the whole point of
  the split is that one renderer drives four different boards. If the renderer
  needs something a theme cannot supply, that is a contract change and it
  belongs here first.

  The shapes below are read off the prototype (`example-design/lib/engine.js`),
  not invented — every field is one the engine actually reads. `THEME-API.md`
  is the prose version of this file.

  The engine's own record types (`Node`, `Edge`, `Graph`) are declared here
  rather than in `engine.ts` because a theme reads them too: `bakeNode` gets a
  node, `drawEdge` gets an edge, `dossier` gets the selected node and its
  threads. A theme that had to re-declare them would drift.
*/

/** `hexToRgb` returns a tuple, not an object — it is indexed in hot loops. */
export type RGB = [number, number, number]

/** `{r,g,b}` at 0-255. The prototype's data file stores hues as hex strings and
 *  the engine converts once, at build time. */
export type Faction = {
  /** Human label, shown in the legend and the dossier. */
  label: string
  /** 2-4 characters, drawn as the node's faction chip. */
  short: string
  /** `#RRGGBB`. The only channel a theme gets for faction identity. */
  hue: string
}

/**
 * One character, as the renderer sees it.
 *
 * `r` is data, not style: it is derived from degree by `nodeRadius()` and
 * encodes importance. A theme must not draw a node smaller or larger than `r`
 * says (THEME-API hard rule 4) — `nodeScale` exists for art directions that
 * want every mark bigger without rewriting the ranking.
 */
export type Node = {
  id: string
  name: string
  /** What the label draws by default; `theme.label.text` may override. */
  label: string
  role: string
  bio: string
  aliases: string[]
  /** Path under `public/`, e.g. `/characters/conan-edogawa.webp`. `""` if none. */
  img: string
  /** Key into `Graph.factions`. */
  faction: string

  /** Authored layout position, in world units. */
  bx: number
  by: number
  degree: number
  /** World-space radius, 11-26. */
  r: number
  /** 0 | 1 | 2, derived from `r`. Drives which label band the node is in. */
  tier: 0 | 1 | 2
  seed: number
  /** Adjacent node ids, in authored order. */
  adj: string[]

  /** Screen position and radius, recomputed every frame. */
  sx: number
  sy: number
  sr: number
  alpha: number
  visible: boolean

  /** Baked node art, device pixels. `null` until `bakeNode` has run. */
  sprite: HTMLCanvasElement | null
  /** Baked nameplate, device pixels. */
  labelSprite: { w: number; h: number; canvas: HTMLCanvasElement } | null
  /** Last winning label offset index, or -1. Placement hysteresis. */
  labelOff: number

  /** The graded portrait, filled in by the engine before `bakeNode`. */
  portrait: HTMLCanvasElement | null
}

/**
 * One relationship, as the renderer sees it.
 *
 * `a`/`b` are resolved node records, not ids. The port first declared them as
 * ids and both the engine and the theme had to assert across the difference:
 * `EdgeState` carries no node table, so a theme's `drawEdge` has no other route
 * to the endpoint geometry it needs to build the thread — and every theme built
 * for this engine reads `e.a.sx`, `e.a.sr` and so on. The runtime shape was
 * always node records; the type was wrong.
 */
export type Edge = {
  id: string
  type: string
  /** Endpoint node records. `a` is the source, `b` the target. */
  a: Node
  b: Node
  detail: string
  /** True when this is the only thread between the pair — `solo` edges take
   *  their bow from `edgeStyle(type).bow` instead of the authored `curvature`. */
  solo: boolean
  /** Authored bow for parallel threads, signed so siblings alternate sides. */
  curvature: number
  alpha: number
  emphasis: number
  dash: number[] | null
}

/**
 * The built graph: what the renderer draws. `buildGraph` derives all of this
 * from an `AuthoredGraph` — degree, radius, tier, the parallel-thread bow — so
 * a data adapter must not precompute any of it.
 */
export type Graph = {
  nodes: Node[]
  edges: Edge[]
  factions: Record<string, Faction>
  /** Node id the establishing shot centres on. */
  hub: string
  world: { width: number; height: number }
}

/* ── authored graph: what a data adapter supplies ─────────────────── */

/**
 * A node before the engine has derived anything: no radius, no tier, no
 * degree, no screen position, no sprites. Just what the guide knows.
 *
 * This is deliberately a separate type from `Node` rather than `Node` with
 * extra fields — the two are different stages of the same record, and
 * pretending the authored one has `sprite`/`labelSprite` is what let a first
 * attempt at the adapter emit the built shape and hand the engine `NaN`
 * coordinates.
 */
export type AuthoredNode = {
  id: string
  name: string
  /** What the label draws. */
  label: string
  role: string
  bio: string
  aliases: string[]
  /** Path under `public/`, or `""` when the character has no portrait. */
  img: string
  /** Free-text affiliation, as authored. */
  affiliation: string
  /** Key into `AuthoredGraph.factions`. */
  faction: string
  /** Authored layout position, in world units. */
  x: number
  y: number
}

export type AuthoredEdge = {
  id: string
  type: string
  /** Endpoint node ids. */
  s: string
  t: string
  detail: string
}

/** What `createEngine` is given. */
export type AuthoredGraph = {
  nodes: AuthoredNode[]
  edges: AuthoredEdge[]
  factions: Record<string, Faction>
  hub: string
  world: { width: number; height: number }
}

/* ── theme utilities ──────────────────────────────────────────────── */

export type GradePortraitOptions = {
  /** Duotone shadow end. */
  dark?: string
  /** Duotone highlight end. */
  light?: string
  contrast?: number
  gamma?: number
  /** 0 leaves the photograph alone, 1 is a pure duotone. */
  mix?: number
  /** Luminance bias, added before gamma. */
  lift?: number
}

/**
 * Handed to every theme callback as `h` so a theme never reaches for a global.
 *
 * These are the *engine's* implementations, shared deliberately: a theme that
 * reimplements `roundRect` or `measureTracked` locally will disagree with the
 * engine's label measurement, and the disagreement shows up as nameplates that
 * are a few pixels too small for their own text.
 */
export type ThemeUtils = {
  clamp(v: number, a: number, b: number): number
  lerp(a: number, b: number, t: number): number
  easeOutCubic(t: number): number
  easeOutQuint(t: number): number
  hash32(s: string): number
  rand01(seed: number, salt: number): number
  hexToRgb(hex: string): RGB
  rgba(hex: string, a: number): string
  makeCanvas(w: number, h: number): HTMLCanvasElement
  roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void
  gradePortrait(
    canvas: HTMLCanvasElement,
    opts: GradePortraitOptions,
  ): HTMLCanvasElement
  setFont(ctx: CanvasRenderingContext2D, font: string): void
  setCaps(ctx: CanvasRenderingContext2D, on: boolean): void
  measureTracked(
    ctx: CanvasRenderingContext2D,
    text: string,
    tracking: number,
  ): number
  paintTracked(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    tracking: number,
    mode: "fill" | "stroke",
  ): void
}

/** Camera state, passed to the world callbacks. */
export type Camera = { x: number; y: number; k: number }

/**
 * Bands the establishing shot fits the graph into. All optional — the engine
 * has defaults — but `labelPadX`/`labelPadY` must cover the *widest* nameplate,
 * not a typical one: labels are placed on either side of their node, so the
 * outermost node can carry its label outward.
 */
export type CameraConfig = {
  anchorX?: number
  anchorY?: number
  mobileK?: number
  desktopMin?: number
  desktopMax?: number
  labelPadX?: number
  labelPadY?: number
}

/** Screen-space strips the chrome panels occupy, per viewport. */
export type SafeInset = {
  left?: number
  right?: number
  top?: number
  bottom?: number
}

export type BgMotion = {
  mode: "world"
  /** World-space tile size in px; the engine translates `.tile` by cam. */
  tile: number
  layers?: number
  secondSize?: number
}

export type Noise = { color: RGB; alpha: number; block?: number }

/* ── per-frame callback state ─────────────────────────────────────── */

export type WorldState = {
  vw: number
  vh: number
  cam: Camera
  dpr: number
  /** Milliseconds since boot. */
  t: number
  /** Milliseconds since the previous frame, clamped to 50. */
  dt: number
  selected: Node | null
  hovered: Node | null
  filterType: string | null
  /** Present on `beforeWorld` only. */
  focusId?: string
  /** The built graph the engine is drawing. */
  graph: Graph
  /** The authored graph it was built from — the prototype's `window.DCPH_DATA`. */
  data: AuthoredGraph
}

export type EdgeState = {
  alpha: number
  k: number
  t: number
  emphasis: number
  selected: Node | null
  hovered: Node | null
  filterType: string | null
  /** Focused node id, or null. */
  focused: string | null
}

export type NodeState = {
  alpha: number
  scale: number
  k: number
  t: number
  /** Sprite width in CSS px, already multiplied by `scale`. */
  size: number
  /** On-screen radius, already multiplied by `scale`. */
  screenR: number
  selected: boolean
  hovered: boolean
  focused: boolean
  isMatch: boolean
  hasFilter: boolean
  dimmed: boolean
  dpr: number
}

/** The `h` passed to `bakeNode`, on top of `ThemeUtils`. */
export type BakeContext = ThemeUtils & {
  dpr: number
  /** Device px per world unit. */
  unit: number
  /** Sprite bleed factor. */
  pad: number
  /** The already-graded portrait, or null while portraits stream in. */
  portrait: HTMLCanvasElement | null
  faction: Faction
  graph: Graph
}

/* ── labels ───────────────────────────────────────────────────────── */

export type LabelPlate = {
  bg: string
  border?: string
  borderWidth?: number
  radius: number
  padX: number
  padY: number
  shadow?: string
  shadowBlur?: number
  shadowY?: number
  /** Optional rule drawn under the text. */
  rule?: string
}

export type LabelHalo = { color: string; width: number }

/**
 * Nameplates are drawn at **constant device size** — they do not scale with
 * zoom. That is the main legibility win over an SVG graph whose `<text>` is
 * laid out by the browser, and it is why `labelPadX/Y` in the home fit is
 * exact rather than approximate.
 */
export type LabelSpec = {
  family: string
  size: number | ((n: Node) => number)
  weight: number | string | ((n: Node) => number | string)
  /** Fraction of the font size. */
  tracking?: number
  color: string | ((n: Node) => string)
  smallCaps?: boolean
  upper?: boolean
  /** Screen-space distance from the node edge to the plate. */
  gap?: number
  /** Draw the leader line for non-below placements. Default true. */
  leader?: boolean
  leaderColor?: string
  /** Candidate order: 0 below, 1 above, 2 right, 3 left. */
  offsets?: number[]
  plate?: ((n: Node) => LabelPlate | null) | null
  halo?: ((n: Node) => LabelHalo | null) | null
  text?: (n: Node) => string
}

/* ── edge styling ─────────────────────────────────────────────────── */

/**
 * The single source of truth for one relationship type.
 *
 * Colour alone is not an encoding — every type must carry at least two of
 * width, dash, bow, knot, material. Any geometry channel returned here is also
 * drawn in the legend swatch, so the legend cannot drift from the threads.
 */
export type EdgeStyle = {
  color: string
  width: number
  dash?: number[]
  /** Signed bow, as a fraction of thread length. */
  bow?: number
  /** Marker drawn at the thread's midpoint. */
  knot?: string
  /** Highlight line laid along one side of the cord. */
  cord?: string
  label: string
}

/* ── chrome ───────────────────────────────────────────────────────── */

/** One thread as the dossier lists it: `dir` is the reading direction. */
export type DossierThread = { e: Edge; other: Node; dir: "in" | "out" }

export type DossierContext = {
  node: Node
  faction: Faction
  threads: DossierThread[]
  typeLabel: (type: string) => string
  /** Inline SVG thread sample — use this, do not hand-roll a colour chip. */
  swatch: (type: string) => string
  edgeStyle: (type: string) => EdgeStyle
  esc: (s: unknown) => string
}

/**
 * An art direction.
 *
 * Chrome members return HTML strings. They are re-rendered on state change, not
 * per frame, so they must be pure functions of nothing (or of the graph): live
 * state is read from the `[data-k]`, `[data-labels]` and `[data-progress]`
 * hooks the engine updates in place. Every interpolated value must go through
 * `esc` — these strings bypass React's escaping.
 */
export type Theme = {
  id: string
  name: string

  camera?: CameraConfig
  /** Function whenever the chrome changes shape between desktop and mobile. */
  safe?: SafeInset | ((vw: number, vh: number) => SafeInset)
  /** How large this theme draws its marks. Tier is read from the unscaled `r`. */
  nodeScale?: number
  noise?: Noise
  bgMotion?: BgMotion
  /** Default true; the tray starts behind a tab. */
  legendCollapsible?: boolean

  /**
   * Bake-time duotone, called by the engine **once per portrait, in place**,
   * immediately before `bakeNode` receives it. `bakeNode` must draw
   * `h.portrait` as-is and must not grade it again — a second pass stacks two
   * duotones and crushes the face.
   */
  gradePortrait?: (
    canvas: HTMLCanvasElement,
    node: Node,
    h: ThemeUtils,
  ) => HTMLCanvasElement

  /**
   * The node's full art: mount, frame, ring, pin, seal. `px` is the square
   * sprite size in device px. Bake-time `ctx.filter` and `ctx.shadowBlur` are
   * encouraged here and forbidden per frame. Re-baked on resize and once after
   * webfonts land, so keep it idempotent.
   */
  bakeNode: (node: Node, px: number, h: BakeContext) => HTMLCanvasElement

  beforeWorld?: (ctx: CanvasRenderingContext2D, st: WorldState) => void
  afterWorld?: (ctx: CanvasRenderingContext2D, st: WorldState) => void

  /**
   * Called once per visible edge. **Budget: a handful of stroke calls.** Build
   * the path once and restroke it at different widths rather than rebuilding
   * geometry; the frame budget at 153 edges is real. No allocation.
   */
  drawEdge: (ctx: CanvasRenderingContext2D, edge: Edge, st: EdgeState) => void

  /** Blit `node.sprite` centred on `(node.sx, node.sy)`. Honour `st.alpha`. */
  drawNode: (ctx: CanvasRenderingContext2D, node: Node, st: NodeState) => void

  edgeStyle: (type: string) => EdgeStyle
  typeLabel: (type: string) => string

  label: LabelSpec

  /** Wrapped in `.brand`; slot is `.slot-title`. */
  title: () => string
  /** Inner head of the tray. The engine owns the `.legend` wrapper. */
  legendHead: () => string
  /** The collapsed tab's inner HTML. */
  legendTab: () => string
  searchPlaceholder?: string
  /** Inner head of the search panel. */
  searchHead: () => string
  /** Wrapped in `.hud`; must contain `[data-k]`, `[data-labels]`, `[data-progress]`. */
  hud: () => string
  dossier: (d: DossierContext) => string
}

/** What `stats()` returns — the only way to tell a layout bug from a paint bug
 *  from outside the page. */
export type EngineStats = {
  k: number
  labels: number
  portraits: number
  vw: number
  vh: number
  dpr: number
  resizes: number
  frames: number
  queued: number
  parked: boolean
  /** Union of every placed nameplate. Outside `[0, 0, vw, vh]` means names are
   *  being sliced by the frame edge. */
  labelBounds: [number, number, number, number] | null
  /** The individual plates, which is what a canvas-sampling test needs in order
   *  to know where the ink it is *not* looking for lives. */
  labelRects: [number, number, number, number][]
  rect: [number, number]
  /** The camera, as `[x, y]`. Screen position is `world * k + cam`, so a test
   *  comparing two frames has to be able to say how far the camera moved
   *  between them. */
  cam: [number, number]
  /** Frames that took the cached thread layer. */
  layerHits: number
  /** Frames that redrew the thread layer from scratch. */
  layerRenders: number
}

export type EngineConfig = {
  theme: Theme
  /** The graph to render, as the data adapter supplies it. The engine derives
   *  the drawn graph from this — do not hand it a pre-built `Graph`. */
  data: AuthoredGraph
  root: HTMLElement
  canvas: HTMLCanvasElement
  /** World-anchored CSS layer the engine translates each frame. */
  bg?: HTMLElement | null
  dossier?: HTMLElement | null
  a11y?: HTMLElement | null
  slots?: {
    title?: HTMLElement | null
    legend?: HTMLElement | null
    search?: HTMLElement | null
    tools?: HTMLElement | null
    hud?: HTMLElement | null
  }
  /** Called on every selection change, with `null` on deselect. The engine
   *  reports the id rather than the record: the host already owns the
   *  character data and must not be handed a record it does not own. */
  onSelect?: (id: string | null) => void
  /** Called when the legend changes the active relationship filter. The engine
   *  owns the filter — its legend is the filter UI — so a host that needs to
   *  mirror it (to filter a thread list, say) listens here. */
  onFilter?: (type: string | null) => void
}

/** The object `createEngine` returns. Only `destroy` is used by React; the rest
 *  exists for the theme's own chrome delegation and for QA. */
export type Engine = {
  select(id: string | null): void
  focus(id: string): void
  /** Return the camera to the establishing shot. */
  home(): void
  setFilter(type: string | null): void
  /** Drive the search panel from outside the engine's own input handler. */
  setSearch(query: string): void
  graph: Graph
  theme: Theme
  stats(): EngineStats
  /** Advance `n` frames on a synthetic clock. Headless verification only —
   *  a real browser never calls it. */
  tick(n: number, stepMs?: number): void
  destroy(): void
}
