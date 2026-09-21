/*
  red-strings/utils — the small-math and bake-time helpers, plus `THEME_UTILS`,
  the bundle handed to every theme callback.

  Ported from `example-design/lib/engine.js:41-320` with no behaviour change.

  These are the *engine's* implementations, shared deliberately: a theme that
  reimplements `roundRect` or `measureTracked` locally will disagree with the
  engine's label measurement, and the disagreement shows up as nameplates that
  are a few pixels too small for their own text.
*/

import type { GradePortraitOptions, RGB, ThemeUtils } from "./types"

/* ── small math ─────────────────────────────────────────────────── */
export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5)
}

export function hash32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function rand01(seed: number, salt: number): number {
  let x = (seed ^ Math.imul(salt + 1, 2654435761)) >>> 0
  x ^= x << 13
  x >>>= 0
  x ^= x >>> 17
  x ^= x << 5
  x >>>= 0
  return x / 4294967296
}

export function hexToRgb(hex: string): RGB {
  let h = hex.replace("#", "")
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = parseInt(h.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgba(hex: string, a: number): string {
  const c = hexToRgb(hex)
  return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"
}

/* ── tracked text (canvas letterSpacing is patchy; do it by hand) ── */
export function measureTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  tracking: number,
): number {
  if (!text) return 0
  let w = 0
  for (let i = 0; i < text.length; i++) w += ctx.measureText(text[i]).width + tracking
  return w - tracking
}

export function paintTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  mode: "fill" | "stroke",
): void {
  let cx = x
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (mode === "stroke") ctx.strokeText(ch, cx, y)
    else ctx.fillText(ch, cx, y)
    cx += ctx.measureText(ch).width + tracking
  }
}

export function setFont(ctx: CanvasRenderingContext2D, font: string): void {
  ctx.font = font
}

export function setCaps(ctx: CanvasRenderingContext2D, on: boolean): void {
  try {
    ctx.fontVariantCaps = on ? "small-caps" : "normal"
  } catch (e) {
    /* older engines ignore it */
  }
}

/* ── portrait grading (bake-time only, never per frame) ─────────── */
export function gradePortrait(
  canvas: HTMLCanvasElement,
  opts: GradePortraitOptions,
): HTMLCanvasElement {
  const w = canvas.width,
    h = canvas.height
  if (!w || !h) return canvas
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return canvas // no context at all — keep the ungraded draw
  let data: ImageData
  try {
    data = ctx.getImageData(0, 0, w, h)
  } catch (e) {
    return canvas // tainted (file://) — keep the ungraded draw
  }
  const px = data.data
  const dark = hexToRgb(opts.dark || "#000000")
  const light = hexToRgb(opts.light || "#ffffff")
  const contrast = opts.contrast == null ? 1 : opts.contrast
  const gamma = opts.gamma == null ? 1 : opts.gamma
  const mix = opts.mix == null ? 1 : opts.mix
  const lift = opts.lift == null ? 0 : opts.lift
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue
    const r = px[i] / 255,
      g = px[i + 1] / 255,
      b = px[i + 2] / 255
    let l = 0.2126 * r + 0.7152 * g + 0.0722 * b
    l = clamp((l - 0.5) * contrast + 0.5 + lift, 0, 1)
    if (gamma !== 1) l = Math.pow(l, gamma)
    const nr = (dark[0] + (light[0] - dark[0]) * l) / 255
    const ng = (dark[1] + (light[1] - dark[1]) * l) / 255
    const nb = (dark[2] + (light[2] - dark[2]) * l) / 255
    px[i] = (r + (nr - r) * mix) * 255
    px[i + 1] = (g + (ng - g) * mix) * 255
    px[i + 2] = (b + (nb - b) * mix) * 255
  }
  ctx.putImageData(data, 0, 0)
  return canvas
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  r = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas")
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

/* Handed to every theme callback (and re-exported from `engine.ts`) so a theme
   never has to reach for a global or reimplement bake-time helpers. */
export const THEME_UTILS: ThemeUtils = {
  clamp: clamp,
  lerp: lerp,
  easeOutCubic: easeOutCubic,
  easeOutQuint: easeOutQuint,
  hash32: hash32,
  rand01: rand01,
  hexToRgb: hexToRgb,
  rgba: rgba,
  makeCanvas: makeCanvas,
  roundRect: roundRect,
  gradePortrait: gradePortrait,
  setFont: setFont,
  setCaps: setCaps,
  measureTracked: measureTracked,
  paintTracked: paintTracked,
}
