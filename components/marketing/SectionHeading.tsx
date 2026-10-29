"use client"

import { motion, useReducedMotion, type Variants } from "framer-motion"

const EASE = [0.16, 1, 0.3, 1] as const

const group: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
}

const kickerV: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
}

const titleV: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
}

const ruleV: Variants = {
  hidden: { scaleX: 0, opacity: 0 },
  show: { scaleX: 1, opacity: 1, transition: { duration: 0.9, ease: EASE } },
}

const subtitleV: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
}

/**
 * Section header, editorial rather than promotional.
 *
 * A mono kicker sits on the same baseline as a hairline, the title is set at a
 * medium weight so size and spacing carry the hierarchy instead of font-bold,
 * and the accent rule underneath is a single hairline rather than a badge.
 * There is deliberately no pill, no icon and no pulsing dot above the title:
 * that stack is the first line of every generated hero.
 */
export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "left",
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
      viewport={{ once: true, margin: "-80px" }}
      className={`flex flex-col ${centered ? "items-center text-center" : "items-start text-left"} ${
        className ?? ""
      }`}
    >
      <motion.div variants={kickerV} className="flex w-full items-center gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-faint sm:text-[11px]">
          {eyebrow}
        </span>
        <span aria-hidden className="h-px flex-1 bg-line" />
      </motion.div>

      <motion.h2
        variants={titleV}
        className="mt-4 max-w-[22ch] font-display text-[clamp(1.6rem,3.4vw,2.75rem)] font-medium leading-[1.06] tracking-[-0.02em] text-ink"
      >
        {title}
      </motion.h2>

      <motion.span
        aria-hidden
        variants={ruleV}
        style={{ transformOrigin: centered ? "center" : "left" }}
        className="mt-5 h-px w-full max-w-[16rem] bg-gradient-to-r from-accent/70 via-line to-transparent"
      />

      {subtitle && (
        <motion.p
          variants={subtitleV}
          className="mt-4 max-w-[46ch] text-sm leading-relaxed text-ink-dim sm:text-base"
        >
          {subtitle}
        </motion.p>
      )}
    </motion.div>
  )
}
