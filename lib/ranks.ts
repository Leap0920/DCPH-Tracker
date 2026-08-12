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
  progressToNext: number
}

export const RANKS = [
  { threshold: 0, title: "Civilian Observer", level: 1 },
  { threshold: 1, title: "Apprentice Detective", level: 2 },
  { threshold: 25, title: "Junior Detective (Detective Boys)", level: 3 },
  { threshold: 100, title: "High School Sleuth", level: 4 },
  { threshold: 300, title: "Metropolitan Police Investigator", level: 5 },
  { threshold: 600, title: "Public Security Agent (Zero)", level: 6 },
  { threshold: 1000, title: "Master Detective (Silver Bullet)", level: 7 },
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
  if (next) {
    const currentBase = current.threshold
    const span = next.threshold - currentBase
    progressToNext = Math.min(100, Math.round(((watchedCount - currentBase) / span) * 100))
  }

  return {
    title: current.title,
    level: current.level,
    nextRankTitle: next?.title ?? null,
    nextRankThreshold: next?.threshold ?? null,
    progressToNext,
  }
}