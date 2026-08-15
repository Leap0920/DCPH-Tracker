"use client"

import { motion } from "framer-motion"

type Direction = "up" | "down" | "left" | "right"

const OFFSET = 28

function offsetFor(direction: Direction) {
  switch (direction) {
    case "up":
      return { y: OFFSET, x: 0 }
    case "down":
      return { y: -OFFSET, x: 0 }
    case "left":
      return { x: OFFSET, y: 0 }
    case "right":
      return { x: -OFFSET, y: 0 }
  }
}

/** Scroll-reveal wrapper — fades content in as it enters the viewport.
 *  `direction` controls the slide axis, `blur` adds a cinematic focus-in. */
export function Reveal({
  children,
  delay = 0,
  direction = "up",
  blur = false,
  className,
}: {
  children: React.ReactNode
  delay?: number
  direction?: Direction
  blur?: boolean
  className?: string
}) {
  const offset = offsetFor(direction)

  return (
    <motion.div
      initial={{ opacity: 0, ...offset, ...(blur ? { filter: "blur(8px)" } : {}) }}
      whileInView={{
        opacity: 1,
        x: 0,
        y: 0,
        ...(blur ? { filter: "blur(0px)" } : {}),
      }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}