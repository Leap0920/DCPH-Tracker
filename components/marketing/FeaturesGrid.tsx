"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { BookOpen, Trophy, MessagesSquare, ListChecks, ArrowRight } from "lucide-react"
import { SectionHeading } from "./SectionHeading"

const EASE = [0.16, 1, 0.3, 1] as const

const features = [
  {
    icon: ListChecks,
    title: "Track Episodes",
    body: "Log every case you watch — episodes, movies, specials and more — and watch your progress fill in.",
    href: "/tracker",
  },
  {
    icon: BookOpen,
    title: "Story Arcs",
    body: "Follow the main plot from Season 1 to the latest era with a clean guide and watch order.",
    href: "/arcs",
  },
  {
    icon: Trophy,
    title: "Detective Rankings",
    body: "See how many episodes fellow detectives have cracked and climb the leaderboard yourself.",
    href: "/community/rankings",
  },
  {
    icon: MessagesSquare,
    title: "Community Chat",
    body: "Drop into themed rooms, talk cases, and connect with other detectives.",
    href: "/community/chat",
  },
]

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12 } },
}

const cardVariants = {
  hidden: { opacity: 0, y: 32 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: EASE },
  },
}

export function FeaturesGrid() {
  return (
    <section className="mx-auto max-w-5xl px-6">
      <SectionHeading
        eyebrow="What you can do"
        title="Everything you need to follow the case"
        subtitle="Track, explore, rank, and talk — all in one place."
      />

      <motion.div
        variants={containerVariants}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {features.map((f) => {
          const Icon = f.icon
          return (
            <motion.div key={f.href} variants={cardVariants} whileHover={{ y: -6 }}>
              <Link
                href={f.href}
                className="group relative flex h-full flex-col rounded-xl border border-slate-200 bg-surface p-6 shadow-card transition-colors hover:border-accent/30 hover:bg-surface-muted"
              >
                {/* Accent edge on hover */}
                <span
                  aria-hidden
                  className="absolute left-0 top-6 h-8 w-[3px] origin-top scale-y-0 rounded-r bg-accent transition-transform duration-300 group-hover:scale-y-100"
                />

                <span className="flex h-10 w-10 items-center justify-center rounded-md bg-accent-soft text-accent transition-all duration-300 group-hover:scale-110 group-hover:bg-accent group-hover:text-white">
                  <Icon className="h-5 w-5" />
                </span>

                <h3 className="mt-4 font-display text-lg text-ink">{f.title}</h3>
                <p className="mt-2 flex-1 text-sm text-ink-dim">{f.body}</p>

                <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-accent opacity-0 transition-all duration-300 group-hover:opacity-100">
                  Open
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </motion.div>
          )
        })}
      </motion.div>
    </section>
  )
}