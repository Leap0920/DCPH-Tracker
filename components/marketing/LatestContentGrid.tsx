"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import {
  CONTENT_TYPE_LABELS,
  CONTENT_TYPE_ICONS,
} from "@/lib/constants"
import type { ContentType } from "@/lib/constants"
import { SectionHeading } from "./SectionHeading"

const EASE = [0.16, 1, 0.3, 1] as const

type LatestEntry = {
  id: string
  title: string
  type: string
  episode_number: number | null
  air_date: string
  slug: string | null
}

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1 } },
}

const cardVariants = {
  hidden: { opacity: 0, y: 28 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: EASE },
  },
}

export function LatestContentGrid({ entries }: { entries: LatestEntry[] }) {
  return (
    <section className="mx-auto max-w-5xl px-6">
      <SectionHeading
        eyebrow="Fresh off the air"
        title="Latest content"
        subtitle="Jump back in where the case left off."
      />

      <motion.div
        variants={containerVariants}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {entries.map((entry) => {
          // DB type union is narrower than ContentType (no "yaiba") — upcast is
          // safe because lookups below fall back to a sensible default.
          const type = entry.type as ContentType
          const label = CONTENT_TYPE_LABELS[type] ?? "Content"
          const icon = CONTENT_TYPE_ICONS[type] ?? "📕"

          return (
            <motion.div key={entry.id} variants={cardVariants} whileHover={{ y: -5 }}>
              <Link
                href={`/tracker?type=${entry.type}`}
                className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-surface p-5 shadow-card transition-colors hover:border-slate-300 hover:bg-surface-muted"
              >
                {/* Accent edge on hover */}
                <span
                  aria-hidden
                  className="absolute left-0 top-0 h-full w-[3px] origin-top scale-y-0 bg-accent transition-transform duration-300 group-hover:scale-y-100"
                />

                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-ink-faint">
                    {icon} {label}
                  </span>
                  <span className="font-mono text-xs text-ink-faint whitespace-nowrap">
                    {entry.air_date}
                  </span>
                </div>
                <h3 className="mt-3 font-display text-base text-ink leading-snug line-clamp-2 transition-colors group-hover:text-accent">
                  {entry.title}
                </h3>
                {entry.episode_number != null && (
                  <p className="mt-2 text-sm text-ink-dim">
                    Ep. {entry.episode_number}
                  </p>
                )}
              </Link>
            </motion.div>
          )
        })}
      </motion.div>
    </section>
  )
}