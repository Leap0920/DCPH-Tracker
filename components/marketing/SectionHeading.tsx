"use client"

import { motion } from "framer-motion"

const EASE = [0.16, 1, 0.3, 1] as const

/** Shared cinematic section header — eyebrow badge, display title, optional
 *  subtitle. Elements reveal in sequence as the section scrolls into view. */
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
  const alignCls =
    align === "center" ? "text-center items-center" : "text-left items-start"

  return (
    <div className={`flex flex-col ${alignCls} max-w-3xl mx-auto ${className ?? ""}`}>
      <motion.span
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.5, ease: EASE }}
        className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent-soft px-3.5 py-1 font-mono text-xs font-semibold uppercase tracking-widest text-accent"
      >
        {eyebrow}
      </motion.span>

      <motion.h2
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.55, delay: 0.08, ease: EASE }}
        className="mt-4 font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-ink"
      >
        {title}
      </motion.h2>

      {subtitle && (
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.55, delay: 0.16, ease: EASE }}
          className="mt-3 text-sm sm:text-base leading-relaxed text-ink-dim max-w-xl"
        >
          {subtitle}
        </motion.p>
      )}
    </div>
  )
}