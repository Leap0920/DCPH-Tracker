"use client"

import { motion, useReducedMotion } from "framer-motion"

type Direction = "up" | "down" | "left" | "right" | "none"

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
    case "none":
      return { x: 0, y: 0 }
  }
}

/** Scroll-reveal wrapper — fades content in as it enters the viewport.
 *  `direction` controls the slide axis, `blur` adds a cinematic focus-in,
 *  `scale` adds a subtle push-forward, and `stagger` turns the wrapper into
 *  a parent that sequences any nested <Reveal.Item> children. */
export function Reveal({
  children,
  delay = 0,
  direction = "up",
  blur = false,
  scale = false,
  once = true,
  className,
}: {
  children: React.ReactNode
  delay?: number
  direction?: Direction
  blur?: boolean
  scale?: boolean
  once?: boolean
  className?: string
}) {
  const reduce = useReducedMotion()
  const offset = offsetFor(direction)

  return (
    <motion.div
      initial={
        reduce
          ? false
          : {
              opacity: 0,
              ...offset,
              ...(blur ? { filter: "blur(8px)" } : {}),
              ...(scale ? { scale: 0.97 } : {}),
            }
      }
      whileInView={{
        opacity: 1,
        x: 0,
        y: 0,
        ...(blur ? { filter: "blur(0px)" } : {}),
        ...(scale ? { scale: 1 } : {}),
      }}
      viewport={{ once, margin: "-60px" }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/** Container that staggers its <RevealItem> children into view. */
export function RevealGroup({
  children,
  stagger = 0.08,
  delayChildren = 0.05,
  className,
}: {
  children: React.ReactNode
  stagger?: number
  delayChildren?: number
  className?: string
}) {
  const reduce = useReducedMotion()

  return (
    <motion.div
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: stagger, delayChildren } },
      }}
      initial={reduce ? "show" : "hidden"}
      whileInView="show"
      viewport={{ once: true, margin: "-60px" }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/** A single staggered child of <RevealGroup>. */
export function RevealItem({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 22, filter: "blur(6px)" },
        show: {
          opacity: 1,
          y: 0,
          filter: "blur(0px)",
          transition: { duration: 0.65, ease: [0.16, 1, 0.3, 1] },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}