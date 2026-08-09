"use client"

import { Eye, RefreshCw, Clock, Award } from "lucide-react"

interface StatsGridProps {
  stats: {
    watchedCount: number
    rewatchedCount: number
    totalMinutes: number
    badgeCount: number
  }
}

const statItems = [
  {
    key: "watchedCount" as const,
    icon: Eye,
    label: "Cases Solved",
    color: "text-green-500",
  },
  {
    key: "rewatchedCount" as const,
    icon: RefreshCw,
    label: "Rewatched",
    color: "text-accent",
  },
  {
    key: "totalMinutes" as const,
    icon: Clock,
    label: "Hours Watched",
    color: "text-ink-dim",
    format: (v: number) => `${Math.floor(v / 60)}h ${v % 60}m`,
  },
  {
    key: "badgeCount" as const,
    icon: Award,
    label: "Badges",
    color: "text-[#9C7A2E]",
  },
]

export function StatsGrid({ stats }: StatsGridProps) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
      {statItems.map((item) => {
        const value = stats[item.key]
        const display = item.format ? item.format(value) : value

        return (
          <div
            key={item.key}
            className="rounded-lg border border-slate-200 bg-surface p-4 text-center shadow-card"
          >
            <item.icon className={`mx-auto mb-2 h-6 w-6 ${item.color}`} />
            <div className="font-display text-2xl text-ink">{display}</div>
            <div className="case-number mt-1">{item.label}</div>
          </div>
        )
      })}
    </div>
  )
}
