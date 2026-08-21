import { describe, expect, it } from "vitest"
import {
  MONTH_DAYS,
  WEEK_DAYS,
  aggregatePeriods,
  type PeriodEvent,
} from "@/lib/leaderboard-periods"

const NOW = new Date("2026-08-21T12:00:00.000Z")
const DAY_MS = 86_400_000

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString()
}

function event(overrides: Partial<PeriodEvent> = {}): PeriodEvent {
  return {
    user_id: "user-a",
    content_id: "content-1",
    created_at: daysAgo(1),
    runtime_minutes: 25,
    type: "episode",
    ...overrides,
  }
}

describe("aggregatePeriods", () => {
  it("counts a recent event into both week and month", () => {
    const totals = aggregatePeriods([event()], { now: NOW })
    expect(totals.get("user-a")).toEqual({
      week: { count: 1, minutes: 25, movieCount: 0 },
      month: { count: 1, minutes: 25, movieCount: 0 },
    })
  })

  it("counts an event older than a week into month only", () => {
    const totals = aggregatePeriods([event({ created_at: daysAgo(10) })], { now: NOW })
    const bucket = totals.get("user-a")
    expect(bucket?.week).toEqual({ count: 0, minutes: 0, movieCount: 0 })
    expect(bucket?.month).toEqual({ count: 1, minutes: 25, movieCount: 0 })
  })

  it("excludes events outside the month window entirely", () => {
    const totals = aggregatePeriods([event({ created_at: daysAgo(MONTH_DAYS + 1) })], { now: NOW })
    expect(totals.has("user-a")).toBe(false)
  })

  it("deduplicates repeat events on the same content — the anti-farming rule", () => {
    // mark-all -> unwatch -> mark-all again must not multiply the count.
    const events = [
      event({ created_at: daysAgo(1) }),
      event({ created_at: daysAgo(2) }),
      event({ created_at: daysAgo(3) }),
    ]
    const totals = aggregatePeriods(events, { now: NOW })
    expect(totals.get("user-a")?.week).toEqual({ count: 1, minutes: 25, movieCount: 0 })
    expect(totals.get("user-a")?.month).toEqual({ count: 1, minutes: 25, movieCount: 0 })
  })

  it("keeps distinct content separate and sums their runtimes", () => {
    const events = [
      event({ content_id: "c1", runtime_minutes: 25 }),
      event({ content_id: "c2", runtime_minutes: 110, type: "movie" }),
    ]
    const totals = aggregatePeriods(events, { now: NOW })
    expect(totals.get("user-a")?.week).toEqual({ count: 2, minutes: 135, movieCount: 1 })
  })

  it("isolates movies from episodes in movieCount", () => {
    const events = [
      event({ content_id: "m1", type: "movie", runtime_minutes: 100 }),
      event({ content_id: "m2", type: "movie", runtime_minutes: 100 }),
      event({ content_id: "e1", type: "episode", runtime_minutes: 25 }),
      event({ content_id: "s1", type: "special", runtime_minutes: 46 }),
    ]
    const totals = aggregatePeriods(events, { now: NOW })
    expect(totals.get("user-a")?.month).toEqual({ count: 4, minutes: 271, movieCount: 2 })
  })

  it("keeps users independent, including identical content ids", () => {
    const events = [
      event({ user_id: "user-a", content_id: "shared" }),
      event({ user_id: "user-b", content_id: "shared" }),
      event({ user_id: "user-b", content_id: "other", runtime_minutes: 46 }),
    ]
    const totals = aggregatePeriods(events, { now: NOW })
    expect(totals.get("user-a")?.week.count).toBe(1)
    expect(totals.get("user-b")?.week).toEqual({ count: 2, minutes: 71, movieCount: 0 })
  })

  it("treats null runtime as zero minutes but still counts the entry", () => {
    const totals = aggregatePeriods([event({ runtime_minutes: null })], { now: NOW })
    expect(totals.get("user-a")?.week).toEqual({ count: 1, minutes: 0, movieCount: 0 })
  })

  it("honours an explicit runtime fallback", () => {
    const totals = aggregatePeriods([event({ runtime_minutes: null })], {
      now: NOW,
      fallbackRuntimeMinutes: 25,
    })
    expect(totals.get("user-a")?.week.minutes).toBe(25)
  })

  it("drops future and unparseable timestamps rather than counting them", () => {
    const events = [
      event({ content_id: "c1", created_at: daysAgo(-5) }),
      event({ content_id: "c2", created_at: "not-a-date" }),
    ]
    expect(aggregatePeriods(events, { now: NOW }).size).toBe(0)
  })

  it("includes an event exactly on the week boundary", () => {
    const totals = aggregatePeriods([event({ created_at: daysAgo(WEEK_DAYS) })], { now: NOW })
    expect(totals.get("user-a")?.week.count).toBe(1)
  })

  it("returns an empty map for no events", () => {
    expect(aggregatePeriods([], { now: NOW }).size).toBe(0)
  })
})
