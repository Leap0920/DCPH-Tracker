"use client"

import { useEffect, useRef, useState } from "react"
import { CARD_HEIGHT, CARD_WIDTH } from "@/lib/wrapped/export"

/**
 * Fits the fixed 1080×1350 card into the container by scaling it down.
 *
 * The scale is measured repeatedly after mount instead of once: on real
 * phones the container width can settle late — fonts loading, the URL bar
 * collapsing, or the page stream finishing all shift layout after the
 * first ResizeObserver tick. A single stale measurement leaves the card
 * overflowing the viewport edge (the classic "card edge cut off in the
 * mobile view" symptom), so we re-measure on a short rAF settle loop plus
 * ResizeObserver, window resize, and fonts.ready, and always clamp the
 * result to the available width.
 *
 * The outer box uses aspect-ratio (not a JS height) so the reserved space
 * is correct from first paint, and the 1080px child is absolutely
 * positioned so it never inflates the document scroll height.
 */
export function CardFrame({ children }: { children: React.ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)

  useEffect(() => {
    const el = outerRef.current
    if (!el) return

    const update = () => {
      const w = el.getBoundingClientRect().width
      if (!Number.isFinite(w) || w <= 0) return
      const next = Math.min(w / CARD_WIDTH, 1)
      setScale((prev) => (Math.abs(next - prev) < 0.0005 ? prev : next))
    }

    // Settle loop: keep re-measuring for a short window after mount so a
    // transient width (pre-font fallback, streamed layout, browser chrome)
    // self-corrects instead of sticking forever.
    const start = performance.now()
    let raf = 0
    const loop = () => {
      update()
      if (performance.now() - start < 750) raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener("resize", update)
    if (document.fonts?.ready) document.fonts.ready.then(update).catch(() => {})

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [])

  return (
    <div
      ref={outerRef}
      className="relative w-full"
      style={{ aspectRatio: `${CARD_WIDTH} / ${CARD_HEIGHT}` }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          transform: `scale(${scale || 0.001})`,
          transformOrigin: "top left",
          visibility: scale ? "visible" : "hidden",
        }}
      >
        {children}
      </div>
    </div>
  )
}
