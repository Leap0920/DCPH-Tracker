"use client"

import Link from "next/link"
import { motion, useReducedMotion, type Variants } from "framer-motion"
import { Check } from "lucide-react"

const EASE = [0.16, 1, 0.3, 1] as const

const gridVariants: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08 },
  },
}

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: EASE },
  },
}

export interface AdvantageItem {
  title: string
  description: string
  href?: string
}

const defaultAdvantages: AdvantageItem[] = [
  {
    title: "Track Episodes",
    description: "Log every case you watch - episodes, movies, specials and OVAs - and watch your progress fill in.",
    href: "/tracker",
  },
  {
    title: "Story Arcs Guide",
    description: "Follow the main plot from Season 1 to the latest era with a clean, spoiler-free watch guide.",
    href: "/arcs",
  },
  {
    title: "Detective Rankings",
    description: "Climb the community leaderboards and compete with fellow detectives based on solved cases.",
    href: "/community/rankings",
  },
  {
    title: "Community Chat Rooms",
    description: "Drop into themed discussion rooms, talk theories, and solve cases together in real time.",
    href: "/community/chat",
  },
  {
    title: "Comprehensive Database",
    description: "Search through detailed case metadata, character profiles, canon episode tags, and release dates.",
    href: "/tracker",
  },
  {
    title: "Sync Across Devices",
    description: "Your viewing history, rank badges, and bookmarks stay synced seamlessly everywhere you log in.",
    href: "/tracker",
  },
]

export function Feature({
  badge = "Platform",
  title = "Everything you need to follow the case",
  subtitle = "Track, explore, rank, and talk - all in one place.",
  advantages = defaultAdvantages,
}: {
  badge?: string
  title?: string
  subtitle?: string
  advantages?: AdvantageItem[]
}) {
  const reduce = useReducedMotion()

  return (
    <section className="mx-auto max-w-6xl px-6 sm:px-12">
      {/* Header Area */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 24, filter: "blur(6px)" }}
        whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.7, ease: EASE }}
        className="max-w-2xl"
      >
        {badge && (
          <span className="inline-block rounded-full border border-accent/20 bg-accent-soft px-3.5 py-1 font-mono text-xs font-semibold uppercase tracking-widest text-accent">
            {badge}
          </span>
        )}
        <h2 className="mt-4 font-display text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-ink">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-2 font-body text-sm sm:text-base leading-relaxed text-ink-dim">
            {subtitle}
          </p>
        )}
      </motion.div>

      {/* Advantages Grid — 3 rows x 2 columns on mobile, 3 columns on desktop */}
      <motion.div
        initial={reduce ? "show" : "hidden"}
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        variants={gridVariants}
        className="mt-8 sm:mt-16 grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5"
      >
        {advantages.map((item, idx) => (
          <motion.div
            key={idx}
            variants={cardVariants}
            whileHover={
              reduce
                ? undefined
                : { y: -6, transition: { type: "spring", stiffness: 300, damping: 22 } }
            }
            className="group flex items-start gap-2.5 sm:gap-3.5 rounded-2xl border border-ink-dim/20 bg-surface p-3.5 sm:p-6 shadow-card transition-[box-shadow,border-color] duration-300 hover:shadow-xl hover:border-ink-dim/30"
          >
            <span className="mt-0.5 flex h-7 w-7 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent transition-all duration-300 group-hover:bg-accent group-hover:text-white">
              <Check className="h-3.5 w-3.5 sm:h-5 sm:w-5 transition-transform duration-200 group-hover:scale-110" />
            </span>
            <div className="min-w-0 flex-1">
              {item.href ? (
                <Link
                  href={item.href}
                  className="font-display text-xs sm:text-base font-semibold text-ink transition-colors group-hover:text-accent block leading-snug"
                >
                  {item.title}
                </Link>
              ) : (
                <h3 className="font-display text-xs sm:text-base font-semibold text-ink leading-snug">
                  {item.title}
                </h3>
              )}
              <p className="mt-1 font-body text-[11px] sm:text-sm leading-snug sm:leading-relaxed text-ink-dim">
                {item.description}
              </p>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </section>
  )
}
