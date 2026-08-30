"use client"

import { useEffect, useRef, useState } from "react"
import { CARD_HEIGHT, CARD_WIDTH } from "@/lib/wrapped/export"

export function CardFrame({ children }: { children: React.ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)

  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    const update = () => setScale(el.clientWidth / CARD_WIDTH)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      ref={outerRef}
      className="w-full"
      style={{ height: scale ? CARD_HEIGHT * scale : undefined }}
    >
      <div
        style={{
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
