"use client"

import { Eye, RefreshCw, Clock, Award } from "lucide-react"

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

const statItems = [
  {
    key: "casesSolved" as const,
    icon: Eye,
    label: "Cases Solved",
    color: "text-green-400",
    format: (v: number) => v.toLocaleString(),
    sub: (s: StatsGridProps["stats"]) =>
      `${s.totalCatalogCount.toLocaleString()} total in catalog`,
  },
  {
    key: "totalRewatchViews" as const,
    icon: RefreshCw,
    label: "Total Rewatches",
    color: "text-accent",
    format: (v: number) => v.toLocaleString(),
    sub: () => "Times you hit rewatch",
  },
  {
    key: "totalMinutes" as const,
    icon: Clock,
    label: "Hours Watched",
    color: "text-ink-dim",
    format: (_v: number, s: StatsGridProps["stats"]) => s.timeFormatted,
    sub: (s: StatsGridProps["stats"]) =>
      `${s.totalMinutes.toLocaleString()} minutes`,
  },
  {
    key: "badgeCount" as const,
    icon: Award,
    label: "Badges",
    color: "text-[#9C7A2E]",
    format: (v: number) => v.toLocaleString(),
    sub: () => "Earned achievements",
  },
]

export function StatsGrid({ stats }: StatsGridProps) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
      {statItems.map((item) => {
        const value = stats[item.key]
        const display = item.format(value, stats)
        const sub = item.sub(stats)

        return (
          <div
            key={item.key}
            className="rounded-lg border border-ink-dim/20 bg-surface p-4 text-center shadow-card"
          >
            <item.icon className={`mx-auto mb-2 h-6 w-6 ${item.color}`} />
            <div className="font-display text-2xl text-ink">{display}</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
              {item.label}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-dim">{sub}</div>
          </div>
        )
      })}
    </div>
  )
}
