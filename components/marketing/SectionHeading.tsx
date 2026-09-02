"use client"

import { motion, useReducedMotion, type Variants } from "framer-motion"

const EASE = [0.16, 1, 0.3, 1] as const

const group: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09 } },
}

const eyebrowV: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.96 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.55, ease: EASE },
  },
}

const titleV: Variants = {
  hidden: { opacity: 0, y: 26, filter: "blur(8px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.7, ease: EASE },
  },
}

const subtitleV: Variants = {
  hidden: { opacity: 0, y: 20, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.7, ease: EASE },
  },
}

const ruleV: Variants = {
  hidden: { scaleX: 0, opacity: 0 },
  show: {
    scaleX: 1,
    opacity: 1,
    transition: { duration: 0.8, ease: EASE },
  },
}

/** Shared cinematic section header — eyebrow badge, display title, optional
 *  subtitle, plus a hairline accent rule that draws itself under the block.
 *  Elements reveal in sequence as the section scrolls into view. */
export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
  className,
}: {
  eyebrow: React.ReactNode
  title: string
  subtitle?: string
  align?: "center" | "left"
  className?: string
}) {
  const reduce = useReducedMotion()
  const centered = align === "center"

  return (
    <motion.div
      variants={group}
      initial={reduce ? "show" : "hidden"}
      whileInView="show"
      viewport={{ once: true, margin: "-60px" }}
      className={`flex flex-col ${
        centered ? "items-center text-center" : "items-start text-left"
      } max-w-3xl ${centered ? "mx-auto" : ""} ${className ?? ""}`}
    >
      <motion.span
        variants={eyebrowV}
        className="group inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent-soft px-3.5 py-1 font-mono text-xs font-semibold uppercase tracking-widest text-accent dark:text-accent-bright"
      >
        <span
          aria-hidden
          className="relative flex h-1.5 w-1.5 shrink-0 items-center justify-center"
        >
          <span className="absolute inset-0 rounded-full bg-accent/50 animate-dcph-pulse-ring" />
          <span className="relative h-1.5 w-1.5 rounded-full bg-accent" />
        </span>
        {eyebrow}
      </motion.span>

      <motion.h2
        variants={titleV}
        className="mt-5 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl lg:text-5xl"
      >
        {title}
      </motion.h2>

      <motion.span
        aria-hidden
        variants={ruleV}
        style={{ transformOrigin: centered ? "center" : "left" }}
        className="mt-4 h-[2px] w-24 rounded-full bg-gradient-to-r from-accent via-accent-bright to-transparent"
      />

      {subtitle && (
        <motion.p
          variants={subtitleV}
          className="mt-4 max-w-xl text-sm leading-relaxed text-ink-dim sm:text-base"
        >
          {subtitle}
        </motion.p>
      )}
    </motion.div>
  )
}