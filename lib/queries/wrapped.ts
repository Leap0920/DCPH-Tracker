import { getSelfAnalytics } from "@/lib/queries/analytics"

export type WrappedTypeSlice = { type: string; count: number }

export type WrappedStats = {
  casesSolved: number
  totalRewatchViews: number
  totalViews: number
  totalMinutes: number
  timeFormatted: string
  totalCatalogCount: number
  completionPct: number
  rankTitle?: string
  avgRating: number
  ratedCount: number
  byType: WrappedTypeSlice[]
  uniqueRewatched?: number
}

const TYPE_ORDER = [
  "episode",
  "movie",
  "special",
  "ova",
  "live_action",
  "magic_kaito",
  "hanzawa",
  "zero_tea_time",
  "yaiba",
  "other",
]

const TYPE_LABELS: Record<string, string> = {
  episode: "Episodes",
  movie: "Movies",
  special: "Specials",
  ova: "OVAs",
  live_action: "Live Action",
  magic_kaito: "Magic Kaito",
  hanzawa: "Hanzawa",
  zero_tea_time: "Zero's Tea Time",
  yaiba: "Yaiba",
  other: "Other",
}

export function wrappedTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

export async function getWrappedStats(userId: string): Promise<WrappedStats> {
  const analytics = await getSelfAnalytics(userId)

  // Cases Solved = unique entries watched or rewatched (matches Self Analytics)
  const casesSolved = analytics.watchedCount + analytics.rewatchedCount
  const completionPct =
    analytics.totalCatalogCount > 0
      ? Math.round((casesSolved / analytics.totalCatalogCount) * 1000) / 10
      : 0

  const counts = new Map<string, number>()
  for (const pt of analytics.perType) {
    const seen = pt.watched + pt.rewatched
    if (seen > 0) {
      const key = TYPE_ORDER.includes(pt.type) ? pt.type : "other"
      counts.set(key, (counts.get(key) ?? 0) + seen)
    }
  }

  const byType: WrappedTypeSlice[] = TYPE_ORDER
    .map((type) => ({ type, count: counts.get(type) ?? 0 }))
    .filter((s) => s.count > 0)

  return {
    casesSolved,
    totalRewatchViews: analytics.rewatchedCount,
    totalViews: analytics.totalViews,
    totalMinutes: analytics.minutesWatched,
    timeFormatted: analytics.timeFormatted.formatted,
    totalCatalogCount: analytics.totalCatalogCount,
    completionPct,
    rankTitle: analytics.detectiveRank?.title,
    avgRating: analytics.avgRating,
    ratedCount: analytics.ratedCount,
    byType,
  }
}
