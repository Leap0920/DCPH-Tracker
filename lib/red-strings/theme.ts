/*
  Variant A — CASE BOARD
  A detective's evidence board in a dark room: cork, steel pins, manila photo
  mounts and crimson thread. The product's own "red strings" metaphor rendered
  as literal material, so the relationship type is carried by thread material,
  width, knot and bow — not by colour alone.

  Typed port of `example-design/lib/theme-a.js`. Every drawing decision is
  preserved exactly; the one integration change is that a relationship's
  COLOUR now comes from the app's single authority (`getRelationshipColor`),
  so the legend chips and the dossier dots cannot drift from the threads. All
  geometry channels (width, dash, bow, knot, cord) stay as authored.
*/

import { getRelationshipColor } from "@/components/characters/graph-theme"
import type { RelationshipType } from "@/lib/characters-guide"
import type {
  BakeContext,
  Edge,
  EdgeState,
  EdgeStyle,
  Node,
  Theme,
  ThemeUtils,
  WorldState,
} from "./types"

/* ── palette ────────────────────────────────────────────────────── */
const C = {
  room: "#14100C",
  board: "#2A2118",
  boardMottle: "#3A2C1E",
  manila: "#E8DCC8",
  manilaHi: "#F2E9D8",
  manilaLo: "#D6C6A8",
  manilaEdge: "#C2AE8A",
  ink: "#1A1410",
  inkDim: "#6B5B45",
  thread: "#C8102E",
  gold: "#D4AF37",
  kraft: "#8A7A5E",
}

/*
  Thread stock per relationship type.

  The board only ever stocks three kinds of string, the way a real evidence
  board does: CRIMSON for the bonds that drive the story, TWINE for the
  professional ones, and BLACK CORD — reserved for the Black Organization,
  because a cold hard black cable against warm cork says "these people are
  not like the others" before you read a single label.

  Everything else that separates the eight types is geometry, which is why
  the board survives a greyscale screenshot: `bow` (resting curvature),
  `dash`, `knot` and `width` are four independent channels.

  `alpha` and `cord` are material flags; `bow`/`dash`/`knot`/`width` are
  also consumed by the legend's swatch renderer, so the key is a real sample.

  Colour is deliberately NOT stored here: it is resolved from the app's
  relationship-colour authority at factory time (see `buildMaterials`).
*/
/*
  Thread stocks. Width is the primary weight channel and it has to survive
  the cork: the board ground is a dark brown, so anything below ~1.5px at
  low alpha disappears into the grain and the board reads as empty. The
  colleague web is by far the most numerous relation, so it sets the
  perceived density of the whole board -- it is the one thread that must be
  faint enough to sit behind the story and strong enough to be seen.
*/
type ThreadStock = {
  width: number
  bow: number
  dash?: number[]
  knot?: string
  alpha?: number
  ribbon?: boolean
  cord?: boolean
  label: string
}

const TYPES: Record<RelationshipType, ThreadStock> = {
  romance: { width: 3.0, bow: 0.16, knot: "loop", label: "Romance" },
  family: { width: 3.0, bow: 0.0, knot: "pin", ribbon: true, label: "Family" },
  friendship: { width: 2.1, bow: 0.1, label: "Friendship" },
  rivalry: { width: 2.3, bow: -0.2, dash: [6, 4], label: "Rivalry" },
  mentor: { width: 2.3, bow: 0.22, knot: "arrow", label: "Mentor" },
  colleague: { width: 1.5, bow: 0.0, alpha: 0.6, label: "Colleague" },
  secret_identity: { width: 1.9, bow: -0.14, dash: [1.5, 5], label: "Secret Identity" },
  adversary: { width: 3.7, bow: 0.05, knot: "cross", cord: true, label: "Adversary" },
}

/** The cold steel specular that separates a cord from the cork. */
const CORD_SPECULAR = "#A6B4C0"

/** The light marker a cord needs, because the cord itself is dark. */
const CORD_MARKER = "#B9AE9E"

/** One relationship type, fully resolved: geometry + the app's colour, with
 *  the shaded strokes it needs precomputed so `drawEdge` allocates nothing. */
type Material = ThreadStock & {
  color: string
  /** `shade(color, -0.5)` — the bed stroke under the thread. */
  core: string
  /** `shade(color, 0.52)` — the top-light along the upper side. */
  light: string
  /** `shade(color, 0.34)` — the woven ribbon pass. */
  ribbonInk: string
}

/* Pin-head shape per faction — the fourth encoding channel, so affiliation
   survives a greyscale screenshot. */
const PIN_SHAPE: Record<string, string> = {
  JDL: "round", KUDO: "round", OSAKA: "hex", MOURI: "hex", SUZUKI: "shield",
  KID: "star", TMPD: "square", POLICE: "square", PSB: "hex", FBI: "shield",
  MI6: "shield", CIA: "round", BO: "star", MIYANO: "round", CIVILIAN: "round",
}

const FACTION_INK: Record<string, string> = {
  JDL: "#1E8FA6", KUDO: "#2E7FA8", OSAKA: "#B06A2A", MOURI: "#1E8A7A",
  SUZUKI: "#A83A72", KID: "#4A5AA8", TMPD: "#B8862A", POLICE: "#8A6A2A",
  PSB: "#8A4FA8", FBI: "#6A5AA8", MI6: "#5A6AB8", CIA: "#5A6A72",
  BO: "#A81E2E", MIYANO: "#A8527A", CIVILIAN: "#4A7FA8",
}

function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v))
}

/** Local `#RGB` / `#RRGGBB` parse, matching the engine's `hexToRgb` for the
 *  shapes this theme ever feeds it (relationship colours and faction inks). */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.charCodeAt(0) === 35 ? hex.slice(1) : hex
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ]
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function shade(hex: string, amt: number): string {
  const c = hexToRgb(hex)
  const f = function (v: number): number {
    return Math.round(clamp(amt > 0 ? v + (255 - v) * amt : v * (1 + amt), 0, 255))
  }
  return "rgb(" + f(c[0]) + "," + f(c[1]) + "," + f(c[2]) + ")"
}

/* `edgeStyle` receives a plain string; this is the single boundary where the
   renderer's string meets the app's `RelationshipType` union. */
function asType(type: string): RelationshipType {
  return type as RelationshipType
}

/** Resolve every relationship type once: geometry from `TYPES`, colour from
 *  the app's authority. Doing this at factory time is what lets `drawEdge`
 *  read finished strings instead of building `shade()` calls per frame. */
function buildMaterials(isDark: boolean): Record<RelationshipType, Material> {
  const out = {} as Record<RelationshipType, Material>
  const keys = Object.keys(TYPES) as RelationshipType[]
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const stock = TYPES[key]
    const color = getRelationshipColor(key, isDark)
    out[key] = {
      width: stock.width,
      bow: stock.bow,
      dash: stock.dash,
      knot: stock.knot,
      alpha: stock.alpha,
      ribbon: stock.ribbon,
      cord: stock.cord,
      label: stock.label,
      color: color,
      core: shade(color, -0.5),
      light: shade(color, 0.52),
      ribbonInk: shade(color, 0.34),
    }
  }
  return out
}

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

/** Escape an interpolated value before it goes into a chrome HTML string.
 *  The engine's `d.esc` is used for the dossier; this covers the members the
 *  theme builds itself. */
function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, function (c) {
    return ESC[c] || c
  })
}

/* ── pin heads ──────────────────────────────────────────────────── */
function pinPath(
  ctx: CanvasRenderingContext2D,
  h: ThemeUtils,
  x: number,
  y: number,
  r: number,
  shape: string,
): void {
  ctx.beginPath()
  if (shape === "square") {
    h.roundRect(ctx, x - r, y - r, r * 2, r * 2, r * 0.28)
  } else if (shape === "hex") {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2
      const px = x + Math.cos(a) * r
      const py = y + Math.sin(a) * r
      if (i) ctx.lineTo(px, py)
      else ctx.moveTo(px, py)
    }
    ctx.closePath()
  } else if (shape === "star") {
    for (let j = 0; j < 10; j++) {
      const a2 = (Math.PI / 5) * j - Math.PI / 2
      const rr = j % 2 ? r * 0.48 : r
      const qx = x + Math.cos(a2) * rr
      const qy = y + Math.sin(a2) * rr
      if (j) ctx.lineTo(qx, qy)
      else ctx.moveTo(qx, qy)
    }
    ctx.closePath()
  } else if (shape === "shield") {
    ctx.moveTo(x - r, y - r * 0.82)
    ctx.lineTo(x + r, y - r * 0.82)
    ctx.lineTo(x + r, y + r * 0.18)
    ctx.quadraticCurveTo(x, y + r * 1.25, x - r, y + r * 0.18)
    ctx.closePath()
  } else {
    ctx.arc(x, y, r, 0, 6.2832)
  }
}

function drawPin(
  ctx: CanvasRenderingContext2D,
  h: ThemeUtils,
  x: number,
  y: number,
  r: number,
  color: string,
  shape: string,
): void {
  ctx.save()
  ctx.shadowColor = "rgba(0,0,0,0.55)"
  ctx.shadowBlur = r * 1.1
  ctx.shadowOffsetX = r * 0.35
  ctx.shadowOffsetY = r * 0.55
  pinPath(ctx, h, x, y, r, shape)
  ctx.fillStyle = shade(color, -0.45)
  ctx.fill()
  ctx.restore()

  const g = ctx.createRadialGradient(x - r * 0.38, y - r * 0.45, r * 0.08, x, y, r * 1.15)
  g.addColorStop(0, shade(color, 0.62))
  g.addColorStop(0.5, color)
  g.addColorStop(1, shade(color, -0.42))
  pinPath(ctx, h, x, y, r, shape)
  ctx.fillStyle = g
  ctx.fill()

  ctx.beginPath()
  ctx.arc(x - r * 0.3, y - r * 0.38, r * 0.26, 0, 6.2832)
  ctx.fillStyle = "rgba(255,255,255,0.9)"
  ctx.fill()
}

/* ── thread geometry ────────────────────────────────────────────── */
/* Eased 0..1: threads straighten when their subgraph is selected. */
let tension = 0

/** Geometry of the last `threadPath` call. A module-scope scratch object so
 *  `drawEdge` allocates nothing per frame; it is read immediately by its
 *  caller and never retained. */
type ThreadGeom = {
  x0: number
  y0: number
  x1: number
  y1: number
  cx: number
  cy: number
  mx: number
  my: number
  span: number
}

const threadGeom: ThreadGeom = {
  x0: 0, y0: 0, x1: 0, y1: 0, cx: 0, cy: 0, mx: 0, my: 0, span: 0,
}

/*
  Build the thread's quadratic into the current path.

  `dyOff` shifts the whole curve in screen pixels — used to lay a highlight
  or a shadow along one side of a thread, which is what turns a flat stroke
  into something that looks like it has a diameter. It must not be confused
  with the endpoint delta below. Naming the locals `dx`/`dy` here silently
  shadowed the parameter, so `o` became the edge's entire vertical span and
  every thread was drawn displaced by that much: horizontal threads landed
  correctly, steep ones did not, and the board read as a network that was
  subtly wrong rather than obviously broken.
*/
function threadPath(
  ctx: CanvasRenderingContext2D,
  a: Node,
  b: Node,
  e: Edge,
  st: EdgeState,
  sagScale: number,
  dyOff?: number,
): ThreadGeom {
  const ax = a.sx,
    ay = a.sy,
    bx = b.sx,
    by = b.sy
  const ddx = bx - ax,
    ddy = by - ay
  const len = Math.hypot(ddx, ddy) || 1
  const ux = ddx / len,
    uy = ddy / len
  const trimA = Math.min(a.sr * 0.94, len * 0.4)
  const trimB = Math.min(b.sr * 0.94, len * 0.4)
  const x0 = ax + ux * trimA,
    y0 = ay + uy * trimA
  const x1 = bx - ux * trimB,
    y1 = by - uy * trimB
  const mx = (x0 + x1) / 2,
    my = (y0 + y1) / 2
  const span = Math.hypot(x1 - x0, y1 - y0) || 1
  const curv = e.solo ? TYPES[asType(e.type)].bow || 0 : e.curvature
  const off = curv * span
  const cxp = mx + -uy * off
  let cyp = my + ux * off
  // gravity: a slack thread sags, a taut one does not
  const sag = clamp(span * 0.075, 5, 30) * (1 - tension) * sagScale
  cyp += sag * 2
  const o = dyOff || 0
  ctx.beginPath()
  ctx.moveTo(x0, y0 + o)
  ctx.quadraticCurveTo(cxp, cyp + o, x1, y1 + o)
  threadGeom.x0 = x0
  threadGeom.y0 = y0
  threadGeom.x1 = x1
  threadGeom.y1 = y1
  threadGeom.cx = cxp
  threadGeom.cy = cyp
  threadGeom.mx = mx
  threadGeom.my = my
  threadGeom.span = span
  return threadGeom
}

const quadScratch = { x: 0, y: 0 }

function quadPoint(
  ax: number,
  ay: number,
  cx: number,
  cy: number,
  bx: number,
  by: number,
  t: number,
): { x: number; y: number } {
  const it = 1 - t
  quadScratch.x = it * it * ax + 2 * it * t * cx + t * t * bx
  quadScratch.y = it * it * ay + 2 * it * t * cy + t * t * by
  return quadScratch
}

/* ── markers ──────────────────────────────────────────────────────── */
function knot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  kind: string,
): void {
  if (kind === "dot") {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, 6.2832)
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, 6.2832)
    ctx.lineWidth = 1.6
    ctx.stroke()
  }
}

function arrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ang: number,
  size: number,
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(ang)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(-size, -size * 0.52)
  ctx.lineTo(-size * 0.72, 0)
  ctx.lineTo(-size, size * 0.52)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function initials(label: string): string {
  const parts = label.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return label.slice(0, 2).toUpperCase()
}

/*
  The selection glow is the one radial gradient the per-frame path needs. It
  is created ONCE and reused under a translate/scale, so its user-space radii
  (0.6 / 2.4) land on `screenR * 0.6` / `screenR * 2.4` exactly as the
  prototype's per-frame `createRadialGradient(n.sx, n.sy, …)` did — but with
  no per-frame gradient allocation.
*/
let selectionGlow: CanvasGradient | null = null

function selectionGlowGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
  if (selectionGlow) return selectionGlow
  const g = ctx.createRadialGradient(0, 0, 0.6, 0, 0, 2.4)
  g.addColorStop(0, "rgba(255,232,190,0.4)")
  g.addColorStop(1, "rgba(255,232,190,0)")
  selectionGlow = g
  return g
}

/** Build the art direction. `isDark` selects only the relationship colour;
 *  the board material itself is deliberately the same dark room in both app
 *  themes, which is how it was reviewed and approved. */
export function createThemeA(opts?: { isDark?: boolean }): Theme {
  const isDark = opts && typeof opts.isDark === "boolean" ? opts.isDark : true
  const materials = buildMaterials(isDark)

  const theme: Theme = {
    id: "a",
    name: "Case Board",

    /*
      labelPad is the screen-space halo the establishing fit reserves around
      the outermost node, so a nameplate can never be cropped by the frame.
      It has to cover the WIDEST card, not a typical one: labels are placed on
      either side of their pin, so the leftmost node can carry its card out to
      the left and the reserved margin has to be a full card wide. At the
      default 52 the outer column of names sat about 8px off the frame edge.
    */
    camera: { anchorX: 0.42, anchorY: 0.5, mobileK: 0.5, desktopMax: 1.25, labelPadX: 70, labelPadY: 30 },
    // On a real board the photographs are the largest thing on the wall and
    // the slips of tape beside them are small. The default radius makes the
    // pinned photo smaller than its own caption, which inverts that.
    nodeScale: 1.25,
    // Strips the index card, pin tray, search slip and brass dials occupy, so
    // the establishing shot frames the board instead of sliding under them.
    /*
      Insets are measured from the live chrome, not guessed. At mobile the
      index card becomes a banner across the top and the search slip and brass
      dials share the bottom, so the usable rect is a tall narrow band and the
      desktop 18px ring would centre the cluster under the card.
    */
    safe: function (vw: number) {
      if (vw < 900) return { left: 14, right: 14, top: 118, bottom: 82 }
      return { left: 18, right: 18, top: 18, bottom: 18 }
    },
    bgMotion: { mode: "world", tile: 220 },
    // warm grain, baked into the tile that pans with the board
    noise: { color: [255, 236, 205], alpha: 0.22, block: 2 },

    /* Once per frame: ease the board's thread tension toward the selection. */
    beforeWorld: function (_ctx: CanvasRenderingContext2D, st: WorldState) {
      tension += ((st.selected ? 1 : 0) - tension) * 0.16
    },

    edgeStyle: function (t: string): EdgeStyle {
      const m = materials[asType(t)]
      return {
        color: m.color,
        width: m.width,
        dash: m.dash,
        bow: m.bow,
        knot: m.knot,
        // The frozen `EdgeStyle` types `cord` as a string — the highlight
        // line's colour — where the prototype stored a boolean material flag.
        // Presence is preserved exactly: only the cord type carries it, and
        // the colour is the specular the threads themselves are drawn with.
        cord: m.cord ? CORD_SPECULAR : undefined,
        label: m.label,
      }
    },
    typeLabel: function (t: string): string {
      return TYPES[asType(t)].label
    },

    gradePortrait: function (canvas: HTMLCanvasElement, _n: Node, h: ThemeUtils) {
      return h.gradePortrait(canvas, {
        dark: "#241A12",
        light: "#FBF1DE",
        contrast: 1.06,
        gamma: 1.04,
        mix: 0.42,
      })
    },

    /* ── node: a mounted photograph held by a steel pin ───────────── */
    bakeNode: function (n: Node, px: number, h: BakeContext) {
      const c = h.makeCanvas(px, px)
      const ctx = c.getContext("2d")
      if (!ctx) return c
      const cx = px / 2,
        cy = px / 2
      const R = n.r * h.unit
      const ink = FACTION_INK[n.faction] || "#8A8073"

      const w = R * 2
      const ht = R * 2.1
      const x = cx - w / 2,
        y = cy - ht / 2
      const border = Math.max(1.6, R * 0.088)
      const rad = Math.max(1, R * 0.055)

      // cast shadow on the cork
      ctx.save()
      ctx.shadowColor = "rgba(0,0,0,0.62)"
      ctx.shadowBlur = R * 0.34
      ctx.shadowOffsetX = R * 0.07
      ctx.shadowOffsetY = R * 0.14
      ctx.fillStyle = C.manila
      h.roundRect(ctx, x, y, w, ht, rad)
      ctx.fill()
      ctx.restore()

      // manila stock
      const g = ctx.createLinearGradient(x, y, x + w * 0.6, y + ht)
      g.addColorStop(0, C.manilaHi)
      g.addColorStop(0.55, C.manila)
      g.addColorStop(1, C.manilaLo)
      h.roundRect(ctx, x, y, w, ht, rad)
      ctx.fillStyle = g
      ctx.fill()
      ctx.strokeStyle = C.manilaEdge
      ctx.lineWidth = Math.max(0.7, R * 0.022)
      ctx.stroke()

      // photo well (extra stock left at the bottom for the classic lip)
      const ix = x + border,
        iy = y + border
      const iw = w - border * 2,
        ih = ht - border * 2 - R * 0.2

      ctx.save()
      ctx.beginPath()
      ctx.rect(ix, iy, iw, ih)
      ctx.clip()
      if (h.portrait) {
        ctx.drawImage(h.portrait, ix, iy, iw, ih)
        // inner vignette so the chaotic source crops sit back in the mount
        const vg = ctx.createRadialGradient(ix + iw / 2, iy + ih * 0.45, iw * 0.15, ix + iw / 2, iy + ih / 2, iw * 0.78)
        vg.addColorStop(0, "rgba(0,0,0,0)")
        vg.addColorStop(1, "rgba(26,18,10,0.5)")
        ctx.fillStyle = vg
        ctx.fillRect(ix, iy, iw, ih)
      } else {
        const fg = ctx.createLinearGradient(ix, iy, ix, iy + ih)
        fg.addColorStop(0, shade(ink, 0.1))
        fg.addColorStop(1, shade(ink, -0.5))
        ctx.fillStyle = fg
        ctx.fillRect(ix, iy, iw, ih)
        ctx.fillStyle = "rgba(255,255,255,0.86)"
        ctx.font = "700 " + ih * 0.46 + "px Inter, system-ui, sans-serif"
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText(initials(n.label), ix + iw / 2, iy + ih / 2)
      }
      ctx.restore()

      // photo edge
      ctx.strokeStyle = "rgba(26,18,10,0.55)"
      ctx.lineWidth = Math.max(0.6, R * 0.02)
      ctx.strokeRect(ix + 0.5, iy + 0.5, iw - 1, ih - 1)

      // a concealed identity tears the mount corner
      if (n.aliases && n.aliases.length) {
        ctx.beginPath()
        ctx.moveTo(x + w, y + ht * 0.62)
        ctx.lineTo(x + w, y + ht)
        ctx.lineTo(x + w * 0.66, y + ht)
        ctx.closePath()
        ctx.fillStyle = "rgba(20,16,12,0.82)"
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(x + w, y + ht * 0.62)
        ctx.lineTo(x + w * 0.66, y + ht)
        ctx.strokeStyle = "rgba(200,16,46,0.55)"
        ctx.lineWidth = Math.max(0.6, R * 0.03)
        ctx.stroke()
      }

      // pin head, top-centre, faction shape + ink
      drawPin(ctx, h, cx, y + border * 0.5, Math.max(3.4, R * 0.21), ink, PIN_SHAPE[n.faction] || "round")

      return c
    },

    drawNode: function (ctx: CanvasRenderingContext2D, n: Node, st) {
      if (!n.sprite) return
      ctx.save()
      ctx.globalAlpha = st.alpha
      const lift = st.hovered || st.selected ? -st.screenR * 0.07 : 0
      ctx.drawImage(n.sprite, n.sx - st.size / 2, n.sy - st.size / 2 + lift, st.size, st.size)

      if (st.selected) {
        ctx.globalCompositeOperation = "lighter"
        // the baked gradient is in units of `screenR`, so scale it into place
        ctx.save()
        ctx.translate(n.sx, n.sy)
        ctx.scale(st.screenR, st.screenR)
        ctx.fillStyle = selectionGlowGradient(ctx)
        ctx.beginPath()
        ctx.arc(0, 0, 2.4, 0, 6.2832)
        ctx.fill()
        ctx.restore()
        ctx.globalCompositeOperation = "source-over"
      } else if (st.hovered || st.focused) {
        ctx.strokeStyle = "rgba(255,236,196,0.5)"
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.arc(n.sx, n.sy, st.screenR * 1.36, 0, 6.2832)
        ctx.stroke()
      } else if (st.isMatch) {
        ctx.strokeStyle = "rgba(200,16,46,0.85)"
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(n.sx, n.sy, st.screenR * 1.3, 0, 6.2832)
        ctx.stroke()
      }
      ctx.restore()
    },

    /* ── threads ──────────────────────────────────────────────────── */
    /*
      Three strokes over ONE path, then one more over a lifted path. The path
      is built twice per edge at most; the width changes are free because a
      stroke reuses the current path. That is what buys the round-cord read
      without a per-frame allocation or a second geometry pass.
    */
    drawEdge: function (ctx: CanvasRenderingContext2D, e: Edge, st: EdgeState) {
      const def = materials[asType(e.type)]
      const isTaut = st.emphasis > 0
      const alpha = st.alpha * (def.alpha || 1) * (isTaut ? 1 : 0.92)
      const lw = def.width * (isTaut ? 1.22 : 1)
      ctx.save()
      if (def.dash) ctx.setLineDash(def.dash)

      if (def.cord) {
        // black cord: a hard dark core with one pale specular edge. No bed
        // shadow — a black cable on dark cork already has all the contrast it
        // needs, and a shadow would only smear its silhouette.
        ctx.globalAlpha = alpha
        ctx.strokeStyle = def.color
        ctx.lineWidth = lw
        threadPath(ctx, e.a, e.b, e, st, 1)
        ctx.stroke()
        // The specular has to do all the separating work: black cord on dark
        // cork has no silhouette of its own, so the cold steel edge IS the
        // thread as far as the eye is concerned.
        ctx.globalAlpha = alpha * 0.66
        ctx.strokeStyle = CORD_SPECULAR
        ctx.lineWidth = Math.max(1, lw * 0.3)
        threadPath(ctx, e.a, e.b, e, st, 1, -lw * 0.28)
        ctx.stroke()
      } else {
        ctx.lineWidth = lw + 1.7
        ctx.globalAlpha = alpha * 0.55
        ctx.strokeStyle = "rgba(16,9,4,0.9)"
        threadPath(ctx, e.a, e.b, e, st, 1)
        ctx.stroke()

        ctx.lineWidth = lw + 0.7
        ctx.strokeStyle = def.core
        ctx.stroke()

        ctx.globalAlpha = alpha
        ctx.strokeStyle = def.color
        ctx.lineWidth = lw
        ctx.stroke()

        if (def.width >= 1.8) {
          // top-light along the upper side of the cord
          ctx.globalAlpha = alpha * 0.38
          ctx.strokeStyle = def.light
          ctx.lineWidth = Math.max(0.7, lw * 0.28)
          threadPath(ctx, e.a, e.b, e, st, 1, -lw * 0.3)
          ctx.stroke()
        }
      }
      ctx.setLineDash([])

      if (def.ribbon) {
        // a second, offset pass reads as woven ribbon rather than thread
        ctx.globalAlpha = alpha * 0.5
        ctx.lineWidth = def.width * 0.42
        ctx.strokeStyle = def.ribbonInk
        threadPath(ctx, e.a, e.b, e, st, 1)
        ctx.stroke()
      }

      if (!st.emphasis && e.type !== "colleague") {
        // knots / markers only read on the emphasised subgraph or at rest for
        // the loud types — keeps the idle board calm
        if (st.k > 0.42 || isTaut) {
          // markers need the on-curve geometry, and the last stroke above drew
          // a lifted path — so rebuild. Only knot types pay for this.
          const geom = threadPath(ctx, e.a, e.b, e, st, 1)
          ctx.globalAlpha = alpha * 0.95
          // markers sit ON the thread, so a black cord needs a light marker
          ctx.strokeStyle = def.cord ? CORD_MARKER : def.color
          ctx.fillStyle = ctx.strokeStyle
          if (def.knot === "loop") {
            knot(ctx, geom.x0, geom.y0, 3.1, "loop")
            knot(ctx, geom.x1, geom.y1, 3.1, "loop")
          } else if (def.knot === "pin") {
            knot(ctx, geom.x0, geom.y0, 2.6, "dot")
            knot(ctx, geom.x1, geom.y1, 2.6, "dot")
          } else if (def.knot === "arrow") {
            arrow(ctx, geom.x1, geom.y1, Math.atan2(geom.y1 - geom.my, geom.x1 - geom.mx), 5.4)
          } else if (def.knot === "cross") {
            const p = quadPoint(geom.x0, geom.y0, geom.cx, geom.cy, geom.x1, geom.y1, 0.5)
            ctx.lineWidth = 1.8
            ctx.beginPath()
            ctx.moveTo(p.x - 4, p.y - 4)
            ctx.lineTo(p.x + 4, p.y + 4)
            ctx.moveTo(p.x + 4, p.y - 4)
            ctx.lineTo(p.x - 4, p.y + 4)
            ctx.stroke()
          }
        }
      }
      ctx.restore()
    },

    /* ── labels: manila plates ────────────────────────────────────── */
    /*
      Only the characters who carry the story get a physical index card; the
      rest of the cast is written straight onto the board.

      A board where all 95 names are cards is a wall of paper, because on dark
      cork the cream card is the highest-contrast object on screen and it
      out-shouts both the photographs and the thread — the two things anyone
      is actually reading. The cards are therefore the accent: roughly the
      fifteen people the case is about, against seventy names chalked onto the
      board and the whole cast of pinned photographs.
    */
    label: {
      family: "Inter, system-ui, sans-serif",
      size: function (n: Node) {
        return n.tier === 0 ? 12 : n.tier === 1 ? 11 : 10.5
      },
      weight: function (n: Node) {
        return n.tier === 0 ? 700 : 600
      },
      tracking: 0.012,
      color: function (n: Node) {
        return n.tier === 2 ? "rgba(238,228,208,0.94)" : C.ink
      },
      gap: 6,
      leaderColor: "rgba(232,220,200,0.4)",
      offsets: [0, 2, 1, 3],
      plate: function (n: Node) {
        if (n.tier === 2) return null
        return {
          bg: C.manila,
          border: C.manilaEdge,
          borderWidth: 1,
          radius: 2.5,
          padX: 5,
          padY: 2.5,
          shadow: "rgba(0,0,0,0.5)",
          shadowBlur: 4,
          shadowY: 2,
        }
      },
      // Chalked names need to hold up where they cross a thread or a pin, so
      // they carry a dark stroke rather than a plate.
      halo: function (n: Node) {
        return n.tier === 2 ? { color: "rgba(14,9,4,0.86)", width: 3.6 } : null
      },
    },

    title: function () {
      return (
        '<div class="brand">' +
        '<div class="brand__card">' +
        '<span class="brand__case">Case File 001</span>' +
        '<h1 class="brand__title">The Red Strings</h1>' +
        '<p class="brand__sub">95 subjects · 153 threads · Beika Ward</p>' +
        "</div>" +
        "</div>"
      )
    },
    legendHead: function () {
      return '<div class="legend__head"><span>Spare Pins</span><em>tap to isolate a thread</em></div>'
    },
    /* Collapsed state: the spool label, plus one dot per thread stock so the
       three materials are still readable without opening the tray. */
    legendTab: function () {
      const order: RelationshipType[] = ["romance", "family", "friendship", "rivalry", "mentor", "colleague", "secret_identity", "adversary"]
      const dots = order
        .map(function (t) {
          const d = materials[t]
          return (
            '<i style="background:' + esc(d.color) + (d.cord ? ";box-shadow:0 0 0 1px " + CORD_SPECULAR + " inset" : "") + '"></i>'
          )
        })
        .join("")
      return (
        '<span class="legend__tab-label">Spare Pins</span>' +
        '<span class="legend__tab-dots" aria-hidden="true">' + dots + "</span>" +
        '<span class="legend__tab-hint">8 threads</span>'
      )
    },
    searchPlaceholder: "Search the case board…",
    searchHead: function () {
      return '<div class="search__head">Subject index</div>'
    },
    hud: function () {
      return (
        '<div class="hud">' +
        '<span class="hud__row"><b data-k>100%</b></span>' +
        '<span class="hud__row"><b data-labels>0</b> plates</span>' +
        '<span class="hud__row"><b data-progress>0/0</b> prints</span>' +
        "</div>"
      )
    },

    dossier: function (d) {
      const n = d.node
      const rows = d.threads
        .map(function (t) {
          return (
            '<li><button type="button" class="thread" data-goto="' +
            d.esc(t.other.id) +
            '">' +
            '<span class="thread__swatch">' +
            d.swatch(t.e.type) +
            "</span>" +
            '<span class="thread__body">' +
            '<span class="thread__type">' +
            d.esc(d.typeLabel(t.e.type)) +
            "</span>" +
            '<span class="thread__name">' +
            d.esc(t.other.label) +
            "</span>" +
            '<span class="thread__detail">' +
            d.esc(t.e.detail) +
            "</span>" +
            "</span></button></li>"
          )
        })
        .join("")
      return (
        '<div class="file">' +
        '<button type="button" class="dossier__close" aria-label="Close case file">✕</button>' +
        '<header class="file__head">' +
        '<span class="file__stamp">' +
        d.esc(d.faction.label) +
        "</span>" +
        '<h2 class="file__name">' +
        d.esc(n.label) +
        "</h2>" +
        (n.aliases.length ? '<p class="file__alias">also known as ' + d.esc(n.aliases.join(", ")) + "</p>" : "") +
        '<p class="file__role">' +
        d.esc(n.role) +
        "</p>" +
        "</header>" +
        '<p class="file__bio">' +
        d.esc(n.bio) +
        "</p>" +
        '<div class="file__rule"><span>' +
        d.threads.length +
        " threads on file</span></div>" +
        '<ul class="file__threads">' +
        rows +
        "</ul>" +
        "</div>"
      )
    },
  }

  return theme
}

/** Variant A as the app ships it: the dark-room board. */
export const themeA = createThemeA({ isDark: true })

export default themeA
