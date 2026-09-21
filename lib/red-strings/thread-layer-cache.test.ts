/*
  The thread layer cache's two decisions.

  A pan on empty space moves the camera without moving anything in the scene, so
  the thread pass is the same pixels translated and can be rendered once and
  blitted. Both halves of that bargain are pure functions, and both are worth
  testing directly because both fail silently: a validity test that lets one
  scene input through keeps serving a stale layer, and an offset that is wrong
  by a margin detaches every thread from the node it is tied to. Neither throws,
  and neither looks wrong in a screenshot until you compare it with the board.
*/

import { describe, expect, it } from "vitest"
import {
  threadLayerBlitOffset,
  threadLayerServes,
  type ThreadLayerAnchor,
  type ThreadScene,
} from "@/lib/red-strings/engine"

const MARGIN = 180

const scene = (over: Partial<ThreadScene> = {}): ThreadScene => ({
  selected: null,
  hovered: null,
  filter: null,
  focus: null,
  ...over,
})

const anchor = (over: Partial<ThreadLayerAnchor> = {}): ThreadLayerAnchor => ({
  x: 100,
  y: 50,
  k: 0.9341,
  scene: scene(),
  ...over,
})

describe("threadLayerServes", () => {
  it("serves a frame at the camera it was rendered from", () => {
    expect(threadLayerServes(anchor(), { x: 100, y: 50, k: 0.9341 }, scene(), MARGIN)).toBe(true)
  })

  it("serves a pan that stays inside the margin on both axes", () => {
    const a = anchor()
    for (const [dx, dy] of [
      [MARGIN, 0],
      [-MARGIN, 0],
      [0, MARGIN],
      [0, -MARGIN],
      [MARGIN, MARGIN],
      [-MARGIN, -MARGIN],
    ]) {
      expect(threadLayerServes(a, { x: 100 + dx, y: 50 + dy, k: 0.9341 }, scene(), MARGIN)).toBe(true)
    }
  })

  it("refuses a pan one step past the margin, on either axis", () => {
    const a = anchor()
    expect(threadLayerServes(a, { x: 100 + MARGIN + 0.5, y: 50, k: 0.9341 }, scene(), MARGIN)).toBe(false)
    expect(threadLayerServes(a, { x: 100, y: 50 + MARGIN + 0.5, k: 0.9341 }, scene(), MARGIN)).toBe(false)
    expect(threadLayerServes(a, { x: 100 - MARGIN - 0.5, y: 50, k: 0.9341 }, scene(), MARGIN)).toBe(false)
  })

  it("refuses any zoom change, however small", () => {
    // A blit cannot rescale, so this has to be exact rather than approximate.
    const a = anchor()
    expect(threadLayerServes(a, { x: 100, y: 50, k: 0.9341 + 1e-9 }, scene(), MARGIN)).toBe(false)
    expect(threadLayerServes(a, { x: 100, y: 50, k: 1 }, scene(), MARGIN)).toBe(false)
  })

  it("refuses a layer whose scene has changed, on every field", () => {
    const fields: (keyof ThreadScene)[] = ["selected", "hovered", "filter", "focus"]
    for (const field of fields) {
      const a = anchor({ scene: scene({ [field]: "before" }) })
      expect(threadLayerServes(a, { x: 100, y: 50, k: 0.9341 }, scene({ [field]: "before" }), MARGIN)).toBe(true)
      expect(threadLayerServes(a, { x: 100, y: 50, k: 0.9341 }, scene({ [field]: "after" }), MARGIN)).toBe(false)
      // Clearing it back to null is a change too, not a return to a default.
      expect(threadLayerServes(a, { x: 100, y: 50, k: 0.9341 }, scene(), MARGIN)).toBe(false)
    }
  })

  it("treats null and undefined-free empty strings as different scenes", () => {
    // The engine never produces "", but the comparison is by identity rather
    // than by truthiness, and this pins that down: a falsy filter is not
    // interchangeable with no filter.
    const a = anchor({ scene: scene({ filter: "" }) })
    expect(threadLayerServes(a, { x: 100, y: 50, k: 0.9341 }, scene({ filter: "" }), MARGIN)).toBe(true)
    expect(threadLayerServes(a, { x: 100, y: 50, k: 0.9341 }, scene({ filter: null }), MARGIN)).toBe(false)
  })

  it("checks the scene and the scale even when the camera has not moved", () => {
    // The failure this guards: a pan that starts and ends at the same place
    // while the selection changed underneath it.
    const a = anchor({ scene: scene({ selected: "a" }) })
    expect(threadLayerServes(a, { x: 100, y: 50, k: 0.9341 }, scene({ selected: "b" }), MARGIN)).toBe(false)
    expect(threadLayerServes(a, { x: 100, y: 50, k: 1 }, scene({ selected: "a" }), MARGIN)).toBe(false)
  })
})

describe("threadLayerBlitOffset", () => {
  it("is the camera's travel when it is already a whole device pixel", () => {
    const a = anchor({ x: 100, y: 50 })
    expect(threadLayerBlitOffset(a, { x: 260, y: 140, k: 0.9341 }, 1)).toEqual({ x: 160, y: 90 })
    expect(threadLayerBlitOffset(a, { x: 260, y: 140, k: 0.9341 }, 2)).toEqual({ x: 160, y: 90 })
  })

  it("snaps to whole device pixels at dpr 2", () => {
    const a = anchor({ x: 0, y: 0 })
    // A half device pixel is representable at dpr 2 and must survive intact.
    expect(threadLayerBlitOffset(a, { x: 0.5, y: 1.5, k: 1 }, 2)).toEqual({ x: 0.5, y: 1.5 })
    // Anything else rounds to the nearest half, never further than that away.
    const off = threadLayerBlitOffset(a, { x: 10.3, y: -10.3, k: 1 }, 2)
    expect(off).toEqual({ x: 10.5, y: -10.5 })
  })

  it("snaps to whole pixels at dpr 1", () => {
    const a = anchor({ x: 0, y: 0 })
    expect(threadLayerBlitOffset(a, { x: 10.4, y: -10.6, k: 1 }, 1)).toEqual({ x: 10, y: -11 })
  })

  it("never moves a pixel by more than half a device pixel", () => {
    const a = anchor({ x: 0, y: 0 })
    for (const dpr of [1, 2, 3]) {
      for (let v = -300; v <= 300; v += 0.37) {
        const off = threadLayerBlitOffset(a, { x: v, y: -v, k: 1 }, dpr)
        expect(Math.abs(off.x - v)).toBeLessThanOrEqual(1 / (2 * dpr) + 1e-9)
        expect(Math.abs(off.y - -v)).toBeLessThanOrEqual(1 / (2 * dpr) + 1e-9)
        // And the result is on the device grid, which is what keeps the blit a
        // 1:1 copy rather than a resample.
        expect(Math.abs(off.x / (1 / dpr) - Math.round(off.x / (1 / dpr)))).toBeLessThan(1e-9)
      }
    }
  })

  it("is the negated travel when the camera moves back", () => {
    const a = anchor({ x: 100, y: 50 })
    expect(threadLayerBlitOffset(a, { x: 40, y: 20, k: 0.9341 }, 2)).toEqual({ x: -60, y: -30 })
  })
})
