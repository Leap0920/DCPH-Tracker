"use client"

import { useState } from "react"
import Link from "next/link"
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
  Award,
  Search,
  Calendar,
  Layers,
  TrendingUp,
} from "lucide-react"
import type { SelfAnalytics } from "@/lib/queries/analytics"
import { cn, timeAgo } from "@/lib/utils"

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  episode: BookOpen,
  movie: Film,
  special: Play,
}

interface AnalyticsDashboardProps {
  analytics: SelfAnalytics
}

export function AnalyticsDashboard({ analytics }: AnalyticsDashboardProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "breakdown" | "arcs" | "top">("overview")
  const [arcFilter, setArcFilter] = useState("")

  const { detectiveRank } = analytics

  const statsList = [
    {
      key: "watched",
      label: "Cases Solved",
      value: analytics.watchedCount.toLocaleString(),
      sub: `${analytics.totalCatalogCount} total in catalog`,
      icon: Eye,
    },
    {
      key: "rewatched",
      label: "Rewatched Cases",
      value: analytics.rewatchedCount.toLocaleString(),
      sub: "Repeated viewings",
      icon: RefreshCw,
    },
    {
      key: "views",
      label: "Total Views",
      value: analytics.totalViews.toLocaleString(),
      sub: "Total watch logs",
      icon: Play,
    },
    {
      key: "minutes",
      label: "Time Spent",
      value: analytics.timeFormatted.formatted,
      sub: `${analytics.minutesWatched.toLocaleString()} minutes`,
      icon: Clock,
    },
    {
      key: "favorites",
      label: "Favorites",
      value: analytics.favoriteCount.toLocaleString(),
      sub: "Bookmarked cases",
      icon: Heart,
    },
    {
      key: "avgRating",
      label: "Avg Rating",
      value: analytics.avgRating > 0 ? `${analytics.avgRating.toFixed(1)} / 10` : "0.0 / 10",
      sub: `${analytics.ratedCount} cases rated`,
      icon: Star,
    },
  ]

  const filteredArcs = analytics.perArc.filter((arc) =>
    arc.title.toLowerCase().includes(arcFilter.toLowerCase()) ||
    arc.slug.toLowerCase().includes(arcFilter.toLowerCase())
  )

  const completedArcsCount = analytics.perArc.filter((a) => a.progress === 100).length

  return (
    <div className="space-y-8">
      {/* Hero Banner with Custom Background Image */}
      <div className="relative min-h-[220px] overflow-hidden rounded-2xl border border-slate-200 shadow-md">
        {/* Banner background image */}
        <img
          src="/analytics-banner.jpg"
          alt="Analytics Banner"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
        {/* Dark overlay for contrast */}
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/75 to-slate-900/40" />

        <div className="relative z-10 flex flex-col justify-between gap-6 p-6 text-white sm:p-8 lg:flex-row lg:items-center">
          <div className="space-y-3 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-0.5 text-xs font-semibold text-white backdrop-blur-sm">
                <Award className="h-3.5 w-3.5 text-amber-400" />
                {detectiveRank.title}
              </span>
            </div>

            <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Self Analytics
            </h1>
            <p className="text-sm text-slate-200 sm:text-base">
              Your personal Detective Conan watch log, arc progression, and series telemetry.
            </p>

            {/* Rank Progress */}
            {detectiveRank.nextRankTitle && (
              <div className="pt-1 max-w-md">
                <div className="mb-1 flex items-center justify-between text-xs text-slate-300">
                  <span>Next Rank: <strong className="text-white">{detectiveRank.nextRankTitle}</strong></span>
                  <span>{detectiveRank.progressToNext}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800/80 border border-white/10">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-500"
                    style={{ width: `${detectiveRank.progressToNext}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Franchise Completion Box */}
          <div className="flex shrink-0 flex-col items-center justify-center rounded-xl border border-white/15 bg-slate-950/60 p-5 backdrop-blur-md text-center">
            <div className="font-display text-4xl font-extrabold text-white sm:text-5xl">
              {analytics.catalogCompletionProgress}%
            </div>
            <div className="mt-1 text-xs font-semibold tracking-wider text-slate-300 uppercase">
              Franchise Solved
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {analytics.watchedCount + analytics.rewatchedCount} of {analytics.totalCatalogCount} cases
            </div>
          </div>
        </div>
      </div>

      {/* KPI Stats Grid (Uniform Sleek Cards) */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {statsList.map((stat) => (
          <div
            key={stat.key}
            className="rounded-xl border border-slate-200 bg-surface p-4 shadow-card transition-all hover:border-slate-300"
          >
            <div className="flex items-center justify-between">
              <stat.icon className="h-4 w-4 text-ink-dim" />
            </div>

            <div className="mt-3 font-display text-2xl font-bold text-ink">
              {stat.value}
            </div>

            <div className="mt-0.5 text-xs font-medium text-ink">{stat.label}</div>
            <div className="mt-1 truncate font-mono text-[10px] text-ink-dim">{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-slate-200">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab("overview")}
            className={cn(
              "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
              activeTab === "overview"
                ? "border-accent text-accent"
                : "border-transparent text-ink-dim hover:text-ink"
            )}
          >
            <BarChart3 className="h-4 w-4" />
            Overview
          </button>

          <button
            onClick={() => setActiveTab("breakdown")}
            className={cn(
              "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
              activeTab === "breakdown"
                ? "border-accent text-accent"
                : "border-transparent text-ink-dim hover:text-ink"
            )}
          >
            <Layers className="h-4 w-4" />
            By Type
          </button>

          <button
            onClick={() => setActiveTab("arcs")}
            className={cn(
              "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
              activeTab === "arcs"
                ? "border-accent text-accent"
                : "border-transparent text-ink-dim hover:text-ink"
            )}
          >
            <GitBranch className="h-4 w-4" />
            Story Arcs ({completedArcsCount}/{analytics.perArc.length})
          </button>

          <button
            onClick={() => setActiveTab("top")}
            className={cn(
              "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
              activeTab === "top"
                ? "border-accent text-accent"
                : "border-transparent text-ink-dim hover:text-ink"
            )}
          >
            <Star className="h-4 w-4" />
            Top & Favorites
          </button>
        </div>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Overall Franchise Progress */}
            <div className="rounded-xl border border-slate-200 bg-surface p-6 shadow-card lg:col-span-2">
              <h2 className="mb-4 flex items-center justify-between font-display text-base font-bold text-ink">
                <span className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-accent" />
                  Franchise Progress
                </span>
                <span className="font-mono text-xs text-ink-dim">
                  {analytics.catalogCompletionProgress}% Complete
                </span>
              </h2>

              <div className="space-y-4">
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-500"
                    style={{ width: `${analytics.catalogCompletionProgress}%` }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4 text-center sm:grid-cols-4 pt-2">
                  <div className="rounded-lg bg-slate-50 p-3 border border-slate-100">
                    <div className="text-xs text-ink-dim">Total Entries</div>
                    <div className="font-display text-xl font-bold text-ink">{analytics.totalCatalogCount}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 border border-slate-100">
                    <div className="text-xs text-ink-dim">Unique Watched</div>
                    <div className="font-display text-xl font-bold text-ink">{analytics.watchedCount + analytics.rewatchedCount}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 border border-slate-100">
                    <div className="text-xs text-ink-dim">Rewatched</div>
                    <div className="font-display text-xl font-bold text-ink">{analytics.rewatchedCount}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 border border-slate-100">
                    <div className="text-xs text-ink-dim">Completed Arcs</div>
                    <div className="font-display text-xl font-bold text-ink">{completedArcsCount}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Rating Distribution */}
            <div className="rounded-xl border border-slate-200 bg-surface p-6 shadow-card">
              <h2 className="mb-4 flex items-center gap-2 font-display text-base font-bold text-ink">
                <Star className="h-4 w-4 text-ink-dim" />
                Rating Breakdown
              </h2>

              {analytics.ratedCount === 0 ? (
                <p className="py-8 text-center text-sm text-ink-dim">
                  No rated cases yet. Rate episodes in the tracker.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {analytics.ratingDistribution.map((item) => (
                    <div key={item.stars} className="flex items-center gap-3">
                      <div className="flex w-14 items-center gap-1 font-mono text-xs text-ink-dim shrink-0">
                        <span>{item.stars} ★</span>
                      </div>
                      <div className="flex-1">
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-slate-800"
                            style={{ width: `${item.percentage}%` }}
                          />
                        </div>
                      </div>
                      <span className="w-8 text-right font-mono text-xs text-ink-dim">
                        {item.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Timeline & Release Years */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Release Years */}
            <div className="rounded-xl border border-slate-200 bg-surface p-6 shadow-card">
              <h2 className="mb-4 flex items-center justify-between font-display text-base font-bold text-ink">
                <span className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-ink-dim" />
                  Watched by Release Year
                </span>
                <span className="font-mono text-xs text-ink-dim">
                  {analytics.perYear.length} Years Active
                </span>
              </h2>

              {analytics.perYear.length === 0 ? (
                <p className="py-12 text-center text-sm text-ink-dim">No watch history by release year.</p>
              ) : (
                <div className="max-h-80 overflow-y-auto pr-2 space-y-3 no-scrollbar">
                  {analytics.perYear.map((row) => {
                    const maxViews = Math.max(1, ...analytics.perYear.map((y) => y.views))
                    return (
                      <div key={row.year} className="flex items-center gap-3">
                        <span className="w-12 shrink-0 font-mono text-xs font-medium text-ink">
                          {row.year}
                        </span>
                        <div className="flex-1">
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-slate-800"
                              style={{ width: `${(row.views / maxViews) * 100}%` }}
                            />
                          </div>
                        </div>
                        <span className="w-28 shrink-0 text-right font-mono text-xs text-ink-dim">
                          {row.views} view{row.views === 1 ? "" : "s"} · {row.watched} seen
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Recently Watched Logs */}
            <div className="rounded-xl border border-slate-200 bg-surface p-6 shadow-card">
              <h2 className="mb-4 flex items-center justify-between font-display text-base font-bold text-ink">
                <span className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-ink-dim" />
                  Recent Activity Logs
                </span>
                <Link href="/tracker" className="text-xs font-medium text-accent hover:underline">
                  View Tracker →
                </Link>
              </h2>

              {analytics.recentlyWatched.length === 0 ? (
                <p className="py-12 text-center text-sm text-ink-dim">No recent watch activity.</p>
              ) : (
                <div className="space-y-3">
                  {analytics.recentlyWatched.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">{item.title}</p>
                        <p className="mt-0.5 flex items-center gap-2 font-mono text-xs text-ink-dim">
                          <span className="capitalize text-accent">{item.type.replace(/_/g, " ")}</span>
                          <span>·</span>
                          <span className="text-ink-faint">{timeAgo(item.updated_at)}</span>
                        </p>
                      </div>
                      <span className="shrink-0 rounded bg-slate-200 px-2 py-0.5 font-mono text-[10px] font-medium text-slate-700">
                        {item.status === "rewatched" ? "Rewatched" : "Watched"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: FRANCHISE BREAKDOWN */}
      {activeTab === "breakdown" && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {analytics.perType.map((stat) => {
            const Icon = TYPE_ICONS[stat.type] ?? Play
            return (
              <div
                key={stat.type}
                className="rounded-xl border border-slate-200 bg-surface p-6 shadow-card"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-slate-100 p-2.5 text-slate-700">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-display text-base font-bold text-ink">{stat.label}</h3>
                      <p className="font-mono text-xs text-ink-dim">
                        {stat.totalInCatalog} Total in Catalog
                      </p>
                    </div>
                  </div>

                  <span className="font-mono text-sm font-bold text-accent">
                    {stat.completionProgress}%
                  </span>
                </div>

                <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-500"
                    style={{ width: `${stat.completionProgress}%` }}
                  />
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded bg-slate-50 p-2 border border-slate-100">
                    <div className="font-mono text-ink-dim">Watched</div>
                    <div className="font-bold text-ink mt-0.5">{stat.watched}</div>
                  </div>
                  <div className="rounded bg-slate-50 p-2 border border-slate-100">
                    <div className="font-mono text-ink-dim">Rewatched</div>
                    <div className="font-bold text-ink mt-0.5">{stat.rewatched}</div>
                  </div>
                  <div className="rounded bg-slate-50 p-2 border border-slate-100">
                    <div className="font-mono text-ink-dim">Total Views</div>
                    <div className="font-bold text-ink mt-0.5">{stat.totalViews}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* TAB 3: STORY ARCS */}
      {activeTab === "arcs" && (
        <div className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-dim" />
              <input
                type="text"
                placeholder="Search story arcs..."
                value={arcFilter}
                onChange={(e) => setArcFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-surface py-2 pl-9 pr-4 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
              />
            </div>
            <div className="font-mono text-xs text-ink-dim">
              Showing {filteredArcs.length} of {analytics.perArc.length} Story Arcs
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredArcs.map((arc) => {
              const isComplete = arc.progress === 100
              const isInProgress = arc.progress > 0 && arc.progress < 100
              return (
                <div
                  key={arc.id}
                  className="flex flex-col justify-between rounded-xl border border-slate-200 bg-surface p-5 shadow-card"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-display text-base font-bold text-ink">{arc.title}</h3>
                      <span
                        className={cn(
                          "shrink-0 rounded px-2 py-0.5 font-mono text-[10px] font-semibold border",
                          isComplete
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : isInProgress
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-slate-100 text-slate-600 border-slate-200"
                        )}
                      >
                        {isComplete ? "Completed" : isInProgress ? "In Progress" : "Unopened"}
                      </span>
                    </div>

                    <p className="mt-1 font-mono text-xs text-ink-dim">
                      Episodes {arc.start_episode} – {arc.end_episode}
                    </p>

                    {arc.description && (
                      <p className="mt-2 text-xs text-ink-dim line-clamp-2">{arc.description}</p>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="font-mono text-ink-dim">
                        {arc.watched} / {arc.total} Solved
                      </span>
                      <span className="font-mono font-bold text-ink">{arc.progress}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          isComplete ? "bg-emerald-600" : "bg-accent"
                        )}
                        style={{ width: `${arc.progress}%` }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* TAB 4: TOP & FAVORITES */}
      {activeTab === "top" && (
        <div className="space-y-8">
          {/* Favorites */}
          <div>
            <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-ink">
              <Heart className="h-5 w-5 text-accent fill-accent" />
              Favorited Case Files ({analytics.favorites.length})
            </h2>

            {analytics.favorites.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-surface p-12 text-center">
                <Heart className="mx-auto h-8 w-8 text-ink-faint" />
                <p className="mt-2 text-sm text-ink-dim">No favorited cases yet.</p>
                <Link
                  href="/tracker"
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white"
                >
                  Browse Tracker Cases
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {analytics.favorites.map((fav) => (
                  <Link
                    key={fav.id}
                    href={`/tracker?q=${encodeURIComponent(fav.title)}`}
                    className="group flex items-center justify-between rounded-xl border border-slate-200 bg-surface p-4 transition-all hover:border-accent/40 shadow-card"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink group-hover:text-accent">
                        {fav.title}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-ink-dim">
                        {fav.type === "episode"
                          ? `Episode ${fav.episode_number}`
                          : fav.type === "movie"
                            ? `Movie ${fav.movie_number}`
                            : fav.type.replace(/_/g, " ")}
                        {fav.watch_count > 1 && ` · ×${fav.watch_count} views`}
                      </p>
                    </div>
                    <Heart className="h-4 w-4 shrink-0 text-accent fill-accent" />
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Top Rated */}
            <div className="rounded-xl border border-slate-200 bg-surface p-6 shadow-card">
              <h2 className="mb-4 flex items-center justify-between font-display text-base font-bold text-ink">
                <span className="flex items-center gap-2">
                  <Star className="h-4 w-4 text-ink-dim" />
                  Top Rated Cases
                </span>
              </h2>

              {analytics.topRated.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-dim">No rated cases yet.</p>
              ) : (
                <div className="space-y-3">
                  {analytics.topRated.map((item, idx) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono text-xs font-bold text-ink-dim">
                          #{idx + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink">{item.title}</p>
                          <p className="font-mono text-xs text-ink-dim capitalize">
                            {item.type.replace(/_/g, " ")}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-sm font-bold text-ink">
                        {(item.rating / 2).toFixed(1)} ★
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Most Rewatched */}
            <div className="rounded-xl border border-slate-200 bg-surface p-6 shadow-card">
              <h2 className="mb-4 flex items-center justify-between font-display text-base font-bold text-ink">
                <span className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-ink-dim" />
                  Most Rewatched Cases
                </span>
              </h2>

              {analytics.mostRewatched.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-dim">No rewatches logged yet.</p>
              ) : (
                <div className="space-y-3">
                  {analytics.mostRewatched.map((item, idx) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono text-xs font-bold text-ink-dim">
                          #{idx + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink">{item.title}</p>
                          <p className="font-mono text-xs text-ink-dim capitalize">
                            {item.type.replace(/_/g, " ")}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-xs font-semibold text-ink">
                        ×{item.watch_count} views
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AnalyticsDashboard

