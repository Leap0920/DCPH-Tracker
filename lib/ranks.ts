/**
 * Detective rank system, shared by /analytics and /community/rankings.
 * A rank is derived purely from the number of unique cases a user has seen
 * (rows with status "watched" or "rewatched" in watch_status).
 */

export interface DetectiveRank {
  title: string
  level: number
  nextRankTitle: string | null
  nextRankThreshold: number | null
  remainingToNext: number | null
  progressToNext: number
  badgeColor: string
}

export const RANKS = [
  { threshold: 0, title: "Civilian Observer", level: 1, color: "text-slate-600 bg-slate-100/80 border-slate-200/80" },
  { threshold: 1, title: "Apprentice Detective", level: 2, color: "text-blue-700 bg-blue-50/80 border-blue-200/80" },
  { threshold: 25, title: "Junior Detective (Detective Boys)", level: 3, color: "text-emerald-700 bg-emerald-50/80 border-emerald-200/80" },
  { threshold: 100, title: "High School Sleuth", level: 4, color: "text-indigo-700 bg-indigo-50/80 border-indigo-200/80" },
  { threshold: 300, title: "Metropolitan Police Investigator", level: 5, color: "text-purple-700 bg-purple-50/80 border-purple-200/80" },
  { threshold: 600, title: "Public Security Agent (Zero)", level: 6, color: "text-amber-700 bg-amber-50/80 border-amber-200/80" },
  { threshold: 1000, title: "Master Detective (Silver Bullet)", level: 7, color: "text-rose-700 bg-rose-50/80 border-rose-200/80" },
]

export function getDetectiveRank(watchedCount: number): DetectiveRank {
  let currentRankIndex = 0
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (watchedCount >= RANKS[i].threshold) {
      currentRankIndex = i
      break
    }
  }

  const current = RANKS[currentRankIndex]
  const next = RANKS[currentRankIndex + 1] ?? null

  let progressToNext = 100
  let remainingToNext: number | null = null

  if (next) {
    const currentBase = current.threshold
    const span = next.threshold - currentBase
    remainingToNext = Math.max(0, next.threshold - watchedCount)
    progressToNext = Math.min(100, Math.round(((watchedCount - currentBase) / span) * 100))
  }

  return {
    title: current.title,
    level: current.level,
    nextRankTitle: next?.title ?? null,
    nextRankThreshold: next?.threshold ?? null,
    remainingToNext,
    progressToNext,
    badgeColor: current.color,
  }
}