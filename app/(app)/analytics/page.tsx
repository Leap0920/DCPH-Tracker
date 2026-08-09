import Link from "next/link"
import { redirect } from "next/navigation"
import {
  Eye,
  RefreshCw,
  Play,
  Clock,
  Heart,
  Star,
  BarChart3,
  Film,
  BookOpen,
  GitBranch,
} from "lucide-react"
import { createClient } from "@/utils/supabase/server"
import { getSelfAnalytics } from "@/lib/queries/analytics"
import { cn, formatHours, timeAgo } from "@/lib/utils"

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
      color: "text-ink",
    },
    {
      key: "views",
      label: "Total Views",
      value: analytics.totalViews.toLocaleString(),
      icon: Play,
      color: "text-accent",
    },
    {
      key: "minutes",
      label: "Time Spent",
      value: formatHours(analytics.minutesWatched),
      icon: Clock,
      color: "text-ink-dim",
    },
    {
      key: "favorites",
      label: "Favorites",
      value: analytics.favoriteCount.toLocaleString(),
      icon: Heart,
      color: "text-accent",
    },
    {
      key: "avgRating",
      label: "Avg Rating",
      value: analytics.avgRating > 0 ? analytics.avgRating.toFixed(1) : "—",
      icon: Star,
      color: "text-accent",
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
        <h1 className="font-display text-3xl sm:text-4xl  text-ink">
          Self Analytics
        </h1>
        <p className="mt-2 max-w-2xl text-ink-dim">
          Your personal Detective Conan case file — every view, rewatch,
          favorite, and minute logged in the tracker.
        </p>

        {/* Stat tiles */}
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map((stat) => (
            <div
              key={stat.key}
              className="rounded-lg border border-slate-200 bg-surface p-4 text-center shadow-card"
            >
              <stat.icon className={cn("mx-auto mb-2 h-6 w-6", stat.color)} />
              <div className="font-display text-2xl text-ink">{stat.value}</div>
              <div className="mt-1 font-mono text-[10px]  text-ink-dim">
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* Per-type breakdown + favorites */}
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          {/* Per-type breakdown */}
          <div className="rounded-lg border border-slate-200 bg-surface p-6 shadow-card">
            <h2 className="mb-4 flex items-center gap-2 font-display text-sm  text-ink">
              <BarChart3 className="h-4 w-4 text-accent" />
              By Type
            </h2>
            {analytics.perType.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-dim">
                Nothing tracked yet — mark episodes or movies as watched in the tracker.
              </p>
            ) : (
              <div className="space-y-3">
                {analytics.perType.map((stat) => {
                  const Icon = TYPE_ICONS[stat.type] ?? Play
                  const maxViews = Math.max(1, ...analytics.perType.map((p) => p.totalViews))
                  return (
                    <div key={stat.type} className="flex items-center gap-3">
                      <Icon className="h-4 w-4 shrink-0 text-ink-faint" />
                      <div className="flex-1">
                        <div className="mb-0.5 flex items-center justify-between">
                          <span className="text-xs text-ink-dim">{stat.label}</span>
                          <span className="font-mono text-[10px] text-ink-dim">
                            {stat.totalViews} view{stat.totalViews === 1 ? "" : "s"}
                            {stat.rewatched > 0 && (
                              <span className="text-ink-faint">
                                {" "}
                                · {stat.watched} seen · {stat.rewatched} rewatched
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                          <div
                            className="h-full rounded-full bg-accent"
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
          <div className="rounded-lg border border-slate-200 bg-surface p-6 shadow-card">
            <h2 className="mb-4 flex items-center gap-2 font-display text-sm  text-ink">
              <Heart className="h-4 w-4 text-accent" />
              Favorites
            </h2>
            {analytics.favorites.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-dim">
                No favorites yet — tap the heart on any card in the tracker.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {analytics.favorites.map((fav) => (
                  <Link
                    key={fav.id}
                    href={`/tracker?q=${encodeURIComponent(fav.title)}`}
                    className="group rounded-lg border border-slate-200 p-3 transition-colors hover:border-accent/40 hover:bg-accent/5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-ink group-hover:text-accent">
                        {fav.title}
                      </p>
                      <Heart className="h-3.5 w-3.5 shrink-0 fill-current text-accent" />
                    </div>
                    <p className="mt-1 font-mono text-[10px]  text-ink-dim">
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

        {/* Top rated + most rewatched + recently watched */}
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {/* Top Rated */}
          <div className="rounded-lg border border-slate-200 bg-surface p-6 shadow-card">
            <h2 className="mb-4 flex items-center gap-2 font-display text-sm  text-ink">
              <Star className="h-4 w-4 text-accent" />
              Top Rated
            </h2>
            {analytics.topRated.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-dim">
                No ratings yet — rate episodes or movies with the stars on their cards.
              </p>
            ) : (
              <ul className="space-y-3">
                {analytics.topRated.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{item.title}</p>
                      <p className="mt-0.5 font-mono text-[10px]  text-ink-dim">
                        {item.type === "episode"
                          ? "Episode"
                          : item.type === "movie"
                            ? "Movie"
                            : item.type.replace(/_/g, " ")}
                        {item.views > 0 && ` · ×${item.views}`}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-xs font-semibold text-accent">
                      {(item.rating / 2).toFixed(1)}/5
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Most Rewatched */}
          <div className="rounded-lg border border-slate-200 bg-surface p-6 shadow-card">
            <h2 className="mb-4 flex items-center gap-2 font-display text-sm  text-ink">
              <RefreshCw className="h-4 w-4 text-ink" />
              Most Rewatched
            </h2>
            {analytics.mostRewatched.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-dim">No rewatches yet.</p>
            ) : (
              <ul className="space-y-3">
                {analytics.mostRewatched.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{item.title}</p>
                      <p className="mt-0.5 font-mono text-[10px]  text-ink-dim">
                        {item.type === "episode"
                          ? "Episode"
                          : item.type === "movie"
                            ? "Movie"
                            : item.type.replace(/_/g, " ")}
                      </p>
                    </div>
                    <span className="shrink-0 inline-flex items-center gap-1 rounded bg-gray-900 px-1.5 py-0.5 font-mono text-[10px] text-white">
                      <RefreshCw className="h-2.5 w-2.5" />
                      ×{item.watch_count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Recently Watched */}
          <div className="rounded-lg border border-slate-200 bg-surface p-6 shadow-card">
            <h2 className="mb-4 flex items-center gap-2 font-display text-sm  text-ink">
              <Clock className="h-4 w-4 text-ink-dim" />
              Recently Watched
            </h2>
            {analytics.recentlyWatched.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-dim">Nothing watched recently.</p>
            ) : (
              <ul className="space-y-3">
                {analytics.recentlyWatched.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{item.title}</p>
                      <p className="mt-0.5 font-mono text-[10px]  text-ink-dim">
                        {item.status === "rewatched" ? "Rewatched" : "Watched"} ·{" "}
                        <span className="text-ink-faint">{timeAgo(item.updated_at)}</span>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* By release year + arc completion */}
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          {/* By Release Year */}
          <div className="rounded-lg border border-slate-200 bg-surface p-6 shadow-card">
            <h2 className="mb-4 flex items-center gap-2 font-display text-sm  text-ink">
              <BarChart3 className="h-4 w-4 text-accent" />
              Watched by Release Year
            </h2>
            {analytics.perYear.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-dim">No watch data yet.</p>
            ) : (
              <div className="space-y-2.5">
                {analytics.perYear.map((row) => {
                  const maxViews = Math.max(1, ...analytics.perYear.map((y) => y.views))
                  return (
                    <div key={row.year} className="flex items-center gap-3">
                      <span className="w-10 shrink-0 font-mono text-[10px] text-ink-dim">
                        {row.year}
                      </span>
                      <div className="flex-1">
                        <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                          <div
                            className="h-full rounded-full bg-accent"
                            style={{ width: `${(row.views / maxViews) * 100}%` }}
                          />
                        </div>
                      </div>
                      <span className="w-24 shrink-0 text-right font-mono text-[10px] text-ink-dim">
                        {row.views} view{row.views === 1 ? "" : "s"} · {row.watched} seen
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Arc Completion */}
          <div className="rounded-lg border border-slate-200 bg-surface p-6 shadow-card">
            <h2 className="mb-4 flex items-center gap-2 font-display text-sm  text-ink">
              <GitBranch className="h-4 w-4 text-accent" />
              Arc Completion
            </h2>
            {analytics.perArc.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-dim">No arc progress yet.</p>
            ) : (
              <ul className="space-y-3">
                {analytics.perArc.map((arc) => {
                  const complete = arc.total > 0 && arc.watched >= arc.total
                  return (
                    <li key={arc.id}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-ink">
                          {arc.title}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-ink-dim">
                          {arc.watched}/{arc.total} · {arc.progress}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            complete ? "bg-green-500" : "bg-gray-900"
                          )}
                          style={{ width: `${arc.progress}%` }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
