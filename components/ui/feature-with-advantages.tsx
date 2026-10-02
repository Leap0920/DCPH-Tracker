"use client"

import Link from "next/link"
import { motion, useReducedMotion, type Variants } from "framer-motion"
import { ArrowUpRight, Check } from "lucide-react"

const EASE = [0.16, 1, 0.3, 1] as const

const gridVariants: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08 },
  },
}

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 24, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
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
    description: "Tick off episodes, movies, specials and OVAs as you watch.",
    href: "/tracker",
  },
  {
    title: "Story Arcs Guide",
    description: "The main plot from S1 to now, spoiler-free.",
    href: "/arcs",
  },
  {
    title: "Detective Rankings",
    description: "See how you rank against fellow detectives.",
    href: "/community/rankings",
  },
  {
    title: "Community Chat Rooms",
    description: "Themed rooms for theories and case talk.",
    href: "/community/chat",
  },
  {
    title: "Comprehensive Database",
    description: "Cases, characters, canon tags, air dates.",
    href: "/tracker",
  },
  {
    title: "Sync Across Devices",
    description: "Progress and badges follow you to any device.",
    href: "/tracker",
  },
]

export function Feature({
  badge = "Platform",
  title = "Your detective toolkit",
  subtitle = "Track, explore, rank, chat.",
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
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent-soft px-3.5 py-1 font-mono text-xs font-semibold uppercase tracking-widest text-accent">
            <span
              aria-hidden
              className="relative flex h-1.5 w-1.5 items-center justify-center"
            >
              <span className="absolute inset-0 rounded-full bg-accent/50 animate-dcph-pulse-ring" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            {badge}
          </span>
        )}
        <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl lg:text-4xl">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-2 font-body text-sm leading-relaxed text-ink-dim sm:text-base">
            {subtitle}
          </p>
        )}
        <motion.span
          aria-hidden
          initial={reduce ? false : { scaleX: 0, opacity: 0 }}
          whileInView={{ scaleX: 1, opacity: 1 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.8, delay: 0.12, ease: EASE }}
          className="mt-6 block h-[2px] w-24 origin-left rounded-full bg-gradient-to-r from-accent via-accent-bright to-transparent"
        />
      </motion.div>

      {/* Advantages Grid — 2 columns on mobile, 3 on desktop */}
      <motion.div
        initial={reduce ? "show" : "hidden"}
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        variants={gridVariants}
        className="mt-8 grid grid-cols-2 gap-3 sm:mt-16 sm:gap-5 lg:grid-cols-3"
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
            className="group relative flex items-start gap-2.5 overflow-hidden rounded-2xl border border-ink-dim/20 bg-surface p-3.5 shadow-card transition-[box-shadow,border-color] duration-300 hover:border-accent/30 hover:shadow-lift sm:gap-3.5 sm:p-6"
          >
            {/* Accent strip that grows down the left edge on hover — echoes
                the .dossier-card signature without duplicating it. */}
            <span
              aria-hidden
              className="pointer-events-none absolute left-0 top-0 h-0 w-[3px] bg-accent transition-[height] duration-500 ease-out group-hover:h-full"
            />
            {/* Corner wash, kept below the content. */}
            <span
              aria-hidden
              className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-accent/[0.07] opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
            />

            <span className="relative mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent transition-all duration-300 group-hover:bg-accent group-hover:text-white sm:h-9 sm:w-9">
              <Check className="h-3.5 w-3.5 transition-transform duration-200 group-hover:scale-110 sm:h-5 sm:w-5" />
            </span>

            <div className="relative min-w-0 flex-1">
              {item.href ? (
                <Link
                  href={item.href}
                  className="flex items-start gap-1 font-display text-xs font-semibold leading-snug text-ink transition-colors group-hover:text-accent sm:text-base"
                >
                  <span className="min-w-0">{item.title}</span>
                  <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100 sm:h-3.5 sm:w-3.5" />
                </Link>
              ) : (
                <h3 className="font-display text-xs font-semibold leading-snug text-ink sm:text-base">
                  {item.title}
                </h3>
              )}
              <p className="mt-1 font-body text-[11px] leading-snug text-ink-dim sm:text-sm sm:leading-relaxed">
                {item.description}
              </p>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </section>
  )
}