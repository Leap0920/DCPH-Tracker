"use client"

import Link from "next/link"
import { Check } from "lucide-react"

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
  return (
    <section className="mx-auto max-w-6xl px-6 py-12">
      {/* Header Area */}
      <div className="max-w-2xl">
        {badge && (
          <span className="inline-block rounded-full bg-slate-900 px-3.5 py-1 text-xs font-semibold uppercase tracking-wider text-white shadow-sm">
            {badge}
          </span>
        )}
        <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-2 font-body text-base leading-relaxed text-slate-500">
            {subtitle}
          </p>
        )}
      </div>

      {/* Advantages Grid (3 Columns, Checkmarks on Left) */}
      <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {advantages.map((item, idx) => (
          <div key={idx} className="group flex items-start gap-3.5">
            <Check className="mt-0.5 h-5 w-5 shrink-0 text-slate-900 transition-transform duration-200 group-hover:scale-110" />
            <div>
              {item.href ? (
                <Link
                  href={item.href}
                  className="font-display text-base font-semibold text-slate-900 transition-colors group-hover:text-accent"
                >
                  {item.title}
                </Link>
              ) : (
                <h3 className="font-display text-base font-semibold text-slate-900">
                  {item.title}
                </h3>
              )}
              <p className="mt-1 font-body text-sm leading-relaxed text-slate-500">
                {item.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
