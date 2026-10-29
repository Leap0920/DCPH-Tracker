"use client"

import Link from "next/link"
import { motion, useReducedMotion, type Variants } from "framer-motion"

const EASE = [0.16, 1, 0.3, 1] as const

const listV: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
}

const rowV: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
}

/**
 * The toolkit, set as a numbered index rather than a card grid.
 *
 * Six equal icon cards is how a generated page fills a features section when
 * there is nothing to show. A numbered list with hairline rules carries the
 * same six destinations with typographic hierarchy instead of boxes, and the
 * numbers give the section a reading order.
 */
const ITEMS = [
  {
    n: "01",
    title: "Track every episode",
    body: "Episodes, movies, specials and OVAs in one grid, ticked off as you watch.",
    href: "/tracker",
  },
  {
    n: "02",
    title: "Read the arcs",
    body: "The main plot from season one to now, spoiler free.",
    href: "/arcs",
  },
  {
    n: "03",
    title: "Open a dossier",
    body: "The whole cast on one red string web, with a page for every name.",
    href: "/characters",
  },
  {
    n: "04",
    title: "Climb the rankings",
    body: "See where you sit against every other detective on the board.",
    href: "/community/rankings",
  },
  {
    n: "05",
    title: "Talk cases",
    body: "Themed rooms for theories, episode talk and screening plans.",
    href: "/community/chat",
  },
  {
    n: "06",
    title: "Keep your progress",
    body: "Your tracker and badges follow you to any device you sign in on.",
    href: "/tracker",
  },
]

export function FeaturesGrid() {
  const reduce = useReducedMotion()

  return (
    <section className="mx-auto max-w-6xl px-6 sm:px-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-faint sm:text-[11px]">
            Toolkit
          </span>
          <h2 className="mt-3 max-w-[18ch] font-display text-[clamp(1.6rem,3.4vw,2.75rem)] font-medium leading-[1.06] tracking-[-0.02em] text-ink">
            Six ways in.
          </h2>
        </div>
        <p className="max-w-[34ch] text-sm leading-relaxed text-ink-dim">
          Everything the community uses, in the order you will reach for it.
        </p>
      </div>

      <motion.ul
        initial={reduce ? "show" : "hidden"}
        whileInView="show"
        viewport={{ once: true, margin: "-80px" }}
        variants={listV}
        className="mt-10 grid grid-cols-1 gap-x-12 sm:mt-14 sm:grid-cols-2"
      >
        {ITEMS.map((item) => (
          <motion.li key={item.n} variants={rowV}>
            <Link
              href={item.href}
              className="group flex items-baseline gap-5 border-t border-line py-5 transition-colors hover:border-accent/40 sm:py-6"
            >
              <span className="w-6 shrink-0 font-mono text-[11px] tabular-nums text-ink-faint transition-colors group-hover:text-accent">
                {item.n}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-base font-medium leading-snug text-ink transition-colors group-hover:text-accent sm:text-lg">
                  {item.title}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-ink-dim sm:text-sm">
                  {item.body}
                </span>
              </span>
              <span
                aria-hidden
                className="mt-1 shrink-0 font-mono text-xs text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
              >
                →
              </span>
            </Link>
          </motion.li>
        ))}
      </motion.ul>
    </section>
  )
}
