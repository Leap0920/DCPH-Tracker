"use client"

import { motion, useReducedMotion } from "framer-motion"

const EASE = [0.16, 1, 0.3, 1] as const

/** Shared cinematic section header — eyebrow badge, display title, optional
 *  subtitle. Elements reveal in sequence (slide + fade + focus-in) as the
 *  section scrolls into view. */
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
  const alignCls =
    align === "center" ? "text-center items-center" : "text-left items-start"

  return (
    <div className={`flex flex-col ${alignCls} max-w-3xl mx-auto ${className ?? ""}`}>
      <motion.span
        initial={reduce ? false : { opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.6, ease: EASE }}
        className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent-soft px-3.5 py-1 font-mono text-xs font-semibold uppercase tracking-widest text-accent"
      >
        {eyebrow}
      </motion.span>

      <motion.h2
        initial={reduce ? false : { opacity: 0, y: 28, filter: "blur(8px)" }}
        whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.7, delay: 0.08, ease: EASE }}
        className="mt-5 font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-ink"
      >
        {title}
      </motion.h2>

      {subtitle && (
        <motion.p
          initial={reduce ? false : { opacity: 0, y: 24, filter: "blur(6px)" }}
          whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.7, delay: 0.16, ease: EASE }}
          className="mt-4 text-sm sm:text-base leading-relaxed text-ink-dim max-w-xl"
        >
          {subtitle}
        </motion.p>
      )}
    </div>
  )
}