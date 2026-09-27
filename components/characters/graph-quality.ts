/**
 * Graph quality — what each device tier is allowed to draw.
 *
 * The graph is ~95 nodes × ~5 SVG shapes + 153 strings, and the animation loop
 * rewrites node transforms and every string path each frame. That is affordable
 * on a desktop and ruinous on a budget phone, so the frame-by-frame work itself
 * is what tiers buy back:
 *
 *  - `driftAmp: 0` is the big one. With no drift the nodes never move on their
 *    own, so the loop stops rewriting 95 transforms and 153 `d` attributes:
 *    panning and zooming only rewrite the single world <g> transform, and an
 *    idle graph parks after IDLE_PARK_MS with zero CPU.
 *  - `breathe` removes 95 infinitely-running CSS keyframe animations. They are
 *    not composited (SVG opacity animates on the main thread), so each one is a
 *    repaint source on every frame.
 *  - `labels` stops painting the small-character labels while zoomed out, where
 *    they are illegible anyway. Hidden labels are `display:none`d (not just
 *    faded to 0) so the renderer can skip them entirely.
 */

import type { QualityTier } from "@/lib/device-tier"

export interface GraphQuality {
  /** Ambient motes behind the graph. 0 = none. */
  particles: number
  /** Node drift amplitude in world px. 0 = the graph is still when idle. */
  driftAmp: number
  /** Breathing halo on every node (95 infinite CSS animations). */
  breathe: boolean
  /** The expanding ring on the Conan hub node. */
  ripple: boolean
  /** Gauss-Seidel separation passes per frame while dragging/settling. */
  collideIters: number
  /** Minimum ms between frames. 0 = uncapped. */
  frameBudgetMs: number
  /** Recompute string paths every Nth frame while the graph is idle. */
  edgeFrameDivisor: number
  /** Reposition particles every Nth frame. */
  particleCadence: number
  /** Which node labels are painted while zoomed out. */
  labels: LabelPolicy
  /** The dot-matrix backdrop (a full-viewport pattern fill). */
  dotGrid: boolean
}

export type LabelPolicy =
  /** Every label, as authored. */
  | "all"
  /** Hide the small (tier-2) labels until zoom reveals them. */
  | "major"
  /** Only the principal characters' labels while zoomed out. */
  | "principal"

export const GRAPH_QUALITY: Record<QualityTier, GraphQuality> = {
  high: {
    particles: 30,
    driftAmp: 3.5,
    breathe: true,
    ripple: true,
    collideIters: 4,
    frameBudgetMs: 0,
    edgeFrameDivisor: 2,
    particleCadence: 2,
    labels: "all",
    dotGrid: true,
  },
  balanced: {
    particles: 10,
    driftAmp: 2.2,
    breathe: false,
    ripple: false,
    collideIters: 2,
    frameBudgetMs: 0,
    edgeFrameDivisor: 3,
    particleCadence: 3,
    labels: "major",
    dotGrid: true,
  },
  low: {
    particles: 0,
    driftAmp: 0,
    breathe: false,
    ripple: false,
    collideIters: 2,
    frameBudgetMs: 0,
    edgeFrameDivisor: 4,
    particleCadence: 4,
    labels: "principal",
    dotGrid: false,
  },
}

/**
 * The weakest node tier whose label is painted while zoomed out, or `null` for
 * "paint them all". Node tiers come from node radius: 0 = hub, 1 = major,
 * 2 = supporting cast.
 */
export function labelTierLimit(policy: LabelPolicy): 0 | 1 | null {
  if (policy === "principal") return 0
  if (policy === "major") return 1
  return null
}
