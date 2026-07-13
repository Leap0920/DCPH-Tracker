"use client"

import { Eye, EyeOff, Play, Award } from "lucide-react"

interface StatsGridProps {
  stats: {
    watchedCount: number
    watchingCount: number
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
    key: "watchingCount" as const,
    icon: Play,
    label: "In Progress",
    color: "text-poison-red-bright",
  },
  {
    key: "totalMinutes" as const,
    icon: EyeOff,
    label: "Hours Watched",
    color: "text-silver-steel",
    format: (v: number) => `${Math.floor(v / 60)}h ${v % 60}m`,
  },
  {
    key: "badgeCount" as const,
    icon: Award,
    label: "Badges",
    color: "text-gold-seal",
  },
]

export function StatsGrid({ stats }: StatsGridProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {statItems.map((item) => {
        const value = stats[item.key]
        const display = item.format ? item.format(value) : value

        return (
          <div key={item.key} className="dossier-card p-4 text-center">
            <item.icon className={`h-6 w-6 mx-auto mb-2 ${item.color}`} />
            <div className="font-display text-2xl text-dossier-cream">{display}</div>
            <div className="case-number mt-1">{item.label}</div>
          </div>
        )
      })}
    </div>
  )
}
