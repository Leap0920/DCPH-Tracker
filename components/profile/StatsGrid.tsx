"use client"

import Link from "next/link"
import { Eye, RefreshCw, Clock, Award } from "lucide-react"
import { getDetectiveRank } from "@/lib/ranks"

interface StatsGridProps {
  stats: {
    casesSolved: number
    totalRewatchViews: number
    totalMinutes: number
    timeFormatted: string
    totalCatalogCount: number
    badgeCount: number
  }
}

export function StatsGrid({ stats }: StatsGridProps) {
  const rank = getDetectiveRank(stats.casesSolved)

  const statItems = [
    {
      key: "casesSolved",
      icon: Eye,
      label: "Cases Solved",
      color: "text-green-400",
      display: stats.casesSolved.toLocaleString(),
      sub: `${stats.totalCatalogCount.toLocaleString()} total in catalog`,
      href: undefined,
    },
    {
      key: "totalRewatchViews",
      icon: RefreshCw,
      label: "Total Rewatches",
      color: "text-accent",
      display: stats.totalRewatchViews.toLocaleString(),
      sub: "Times you hit rewatch",
      href: undefined,
    },
    {
      key: "totalMinutes",
      icon: Clock,
      label: "Hours Watched",
      color: "text-ink-dim",
      display: stats.timeFormatted,
      sub: `${stats.totalMinutes.toLocaleString()} minutes`,
      href: undefined,
    },
    {
      key: "detectiveRank",
      icon: Award,
      label: "Detective Rank",
      color: "text-gold-seal",
      display: `Lv. ${rank.level}`,
      sub: rank.title.replace(/\s*\(.*\)/, ""),
      href: "/community/rankings",
    },
  ]

  return (
    <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
      {statItems.map((item) => {
        const content = (
          <div
            className={`rounded-lg border border-ink-dim/20 bg-surface p-4 text-center shadow-card transition-all ${
              item.href
                ? "cursor-pointer hover:border-accent/40 hover:bg-surface-muted"
                : ""
            }`}
          >
            <item.icon className={`mx-auto mb-2 h-6 w-6 ${item.color}`} />
            <div className="font-display text-2xl text-ink">{item.display}</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
              {item.label}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-ink-dim" title={item.sub}>
              {item.sub}
            </div>
          </div>
        )

        return item.href ? (
          <Link key={item.key} href={item.href} className="block">
            {content}
          </Link>
        ) : (
          <div key={item.key}>{content}</div>
        )
      })}
    </div>
  )
}
