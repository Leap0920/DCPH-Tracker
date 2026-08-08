import Link from "next/link"
import { redirect } from "next/navigation"
import {
  Eye,
  RefreshCw,
  Play,
  Clock,
  Heart,
  BarChart3,
  Film,
  BookOpen,
} from "lucide-react"
import { createClient } from "@/utils/supabase/server"
import { getSelfAnalytics } from "@/lib/queries/analytics"
import { cn, formatHours } from "@/lib/utils"

export const metadata = {
  title: "Self Analytics — Detective Conan PH",
  description: "Your personal Detective Conan watching statistics: views, rewatches, favorites, and time spent.",
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  episode: BookOpen,
  movie: Film,
  special: Play,
}

export default async function AnalyticsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login?redirectTo=/analytics")
  }

  const analytics = await getSelfAnalytics(user.id)

  const stats = [
    {
      key: "watched",
      label: "Cases Solved",
      value: analytics.watchedCount.toLocaleString(),
      icon: Eye,
      color: "text-green-600",
    },
    {
      key: "rewatched",
      label: "Rewatched",
      value: analytics.rewatchedCount.toLocaleString(),
      icon: RefreshCw,
      color: "text-gray-900",
    },
    {
      key: "views",
      label: "Total Views",
      value: analytics.totalViews.toLocaleString(),
      icon: Play,
      color: "text-[#A5202D]",
    },
    {
      key: "minutes",
      label: "Time Spent",
      value: formatHours(analytics.minutesWatched),
      icon: Clock,
      color: "text-gray-500",
    },
    {
      key: "favorites",
      label: "Favorites",
      value: analytics.favoriteCount.toLocaleString(),
      icon: Heart,
      color: "text-[#A5202D]",
    },
  ]

  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <span className="case-number">FILE NO. 005 — SELF ANALYTICS</span>
          <span className="redacted-bar w-16" />
        </div>
        <h1 className="font-display text-3xl sm:text-4xl uppercase tracking-wide text-gray-900">
          Self Analytics
        </h1>
        <p className="mt-2 max-w-2xl text-gray-500">
          Your personal Detective Conan case file — every view, rewatch,
          favorite, and minute logged in the tracker.
        </p>

        {/* Stat tiles */}
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map((stat) => (
            <div
              key={stat.key}
              className="rounded-lg border border-gray-200 bg-white p-4 text-center shadow-sm"
            >
              <stat.icon className={cn("mx-auto mb-2 h-6 w-6", stat.color)} />
              <div className="font-display text-2xl text-gray-900">{stat.value}</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-gray-500">
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* Per-type breakdown + favorites */}
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          {/* Per-type breakdown */}
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 font-display text-sm uppercase tracking-widest text-gray-900">
              <BarChart3 className="h-4 w-4 text-[#A5202D]" />
              By Type
            </h2>
            {analytics.perType.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">
                Nothing tracked yet — mark episodes or movies as watched in the tracker.
              </p>
            ) : (
              <div className="space-y-3">
                {analytics.perType.map((stat) => {
                  const Icon = TYPE_ICONS[stat.type] ?? Play
                  const maxViews = Math.max(1, ...analytics.perType.map((p) => p.totalViews))
                  return (
                    <div key={stat.type} className="flex items-center gap-3">
                      <Icon className="h-4 w-4 shrink-0 text-gray-400" />
                      <div className="flex-1">
                        <div className="mb-0.5 flex items-center justify-between">
                          <span className="text-xs text-gray-600">{stat.label}</span>
                          <span className="font-mono text-[10px] text-gray-500">
                            {stat.totalViews} view{stat.totalViews === 1 ? "" : "s"}
                            {stat.rewatched > 0 && (
                              <span className="text-gray-400">
                                {" "}
                                · {stat.watched} seen · {stat.rewatched} rewatched
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                          <div
                            className="h-full rounded-full bg-[#A5202D]"
                            style={{ width: `${(stat.totalViews / maxViews) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Favorites */}
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 font-display text-sm uppercase tracking-widest text-gray-900">
              <Heart className="h-4 w-4 text-[#A5202D]" />
              Favorites
            </h2>
            {analytics.favorites.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">
                No favorites yet — tap the heart on any card in the tracker.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {analytics.favorites.map((fav) => (
                  <Link
                    key={fav.id}
                    href={`/tracker?q=${encodeURIComponent(fav.title)}`}
                    className="group rounded-lg border border-gray-200 p-3 transition-colors hover:border-[#A5202D]/40 hover:bg-[#A5202D]/5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900 group-hover:text-[#A5202D]">
                        {fav.title}
                      </p>
                      <Heart className="h-3.5 w-3.5 shrink-0 fill-current text-[#A5202D]" />
                    </div>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-gray-500">
                      {fav.type === "episode"
                        ? `Episode ${fav.episode_number}`
                        : fav.type === "movie"
                          ? `Movie ${fav.movie_number}`
                          : fav.type.replace(/_/g, " ")}
                      {fav.watch_count > 1 && ` · ×${fav.watch_count}`}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
