/**
 * Pure aggregation of watch_events rows into rolling-window leaderboard totals.
 *
 * Separated from lib/queries/leaderboard.ts so the two rules that matter can be
 * unit-tested without a database:
 *
 *  1. ROLLING WINDOWS, not calendar periods. "Last 30 days" rather than "this
 *     month" because a calendar month leaves the board near-empty for the first
 *     days of every month — which would read as the multiplier bug returning —
 *     and because a rolling cutoff has no timezone boundary to get wrong.
 *
 *  2. DISTINCT content per window. Events are append-only and unwatching does not
 *     remove them, so counting raw events would let anyone farm the board with
 *     mark-all / unwatch / mark-all. Deduping by content_id closes that. The
 *     cost: a genuine rewatch inside one window counts once.
 */
import { defaultRuntimeMinutes } from "@/lib/runtime-defaults"

/** One watch_events row joined to its content entry. */
export interface PeriodEvent {
  user_id: string
  content_id: string
  /** ISO 8601 timestamp from watch_events.created_at. */
  created_at: string
  /** From content_entries.runtime_minutes. Null falls back to the type default. */
  runtime_minutes: number | null
  /** From content_entries.type — used to isolate the Movies and Episodes categories. */
  type: string | null
}

export interface PeriodTotals {
  /** Distinct entries watched in the window, of every type. */
  count: number
  /** Summed runtime of those distinct entries. */
  minutes: number
  /** Distinct entries of type 'movie'. */
  movieCount: number
  /** Distinct entries of type 'episode'. */
  episodeCount: number
}

export interface UserPeriodTotals {
  week: PeriodTotals
  month: PeriodTotals
}

export const WEEK_DAYS = 7
export const MONTH_DAYS = 30
export const MOVIE_TYPE = "movie"
export const EPISODE_TYPE = "episode"

const DAY_MS = 86_400_000

function emptyTotals(): PeriodTotals {
  return { count: 0, minutes: 0, movieCount: 0, episodeCount: 0 }
}

/**
 * Minutes to credit an event whose runtime_minutes is missing: either a fixed
 * number or a resolver over the entry's type.
 */
export type RuntimeFallback = number | ((type: string | null) => number)

/**
 * Buckets events into rolling week and month totals per user.
 *
 * Every event inside the week window is also inside the month window, so each
 * event is counted into both — the two are nested, not exclusive.
 *
 * @param events   rows already filtered to roughly the last MONTH_DAYS server-side
 * @param now      evaluation instant; injected so tests are not clock-dependent
 * @param fallbackRuntimeMinutes used when runtime_minutes is missing. Defaults to
 *        the entry's own type default (lib/runtime-defaults.ts), so a row that
 *        slipped through without a runtime still contributes a bounded, sane
 *        number of minutes. Crediting 0 here while the all-time board credits the
 *        type default is how one user showed two different watch times depending
 *        on which tab you looked at. Pass a number to force one value.
 */
export function aggregatePeriods(
  events: readonly PeriodEvent[],
  {
    now = new Date(),
    fallbackRuntimeMinutes = (type: string | null) => defaultRuntimeMinutes(type ?? ""),
  }: { now?: Date; fallbackRuntimeMinutes?: RuntimeFallback } = {},
): Map<string, UserPeriodTotals> {
  const nowMs = now.getTime()
  const weekCutoff = nowMs - WEEK_DAYS * DAY_MS
  const monthCutoff = nowMs - MONTH_DAYS * DAY_MS

  const totals = new Map<string, UserPeriodTotals>()
  // Dedupe sets keyed "userId\u0000contentId" — \u0000 cannot occur in a uuid, so
  // no separator collision is possible.
  const seenWeek = new Set<string>()
  const seenMonth = new Set<string>()

  for (const event of events) {
    const at = Date.parse(event.created_at)
    // Unparseable or future timestamps are dropped rather than clamped: a bad
    // timestamp must never inflate a ranking.
    if (Number.isNaN(at) || at > nowMs || at < monthCutoff) continue

    const minutes =
      typeof event.runtime_minutes === "number" && event.runtime_minutes > 0
        ? event.runtime_minutes
        : typeof fallbackRuntimeMinutes === "number"
          ? fallbackRuntimeMinutes
          : fallbackRuntimeMinutes(event.type)
    const isMovie = event.type === MOVIE_TYPE
    const isEpisode = event.type === EPISODE_TYPE
    const dedupeKey = `${event.user_id}\u0000${event.content_id}`

    let bucket = totals.get(event.user_id)
    if (!bucket) {
      bucket = { week: emptyTotals(), month: emptyTotals() }
      totals.set(event.user_id, bucket)
    }

    if (!seenMonth.has(dedupeKey)) {
      seenMonth.add(dedupeKey)
      bucket.month.count += 1
      bucket.month.minutes += minutes
      if (isMovie) bucket.month.movieCount += 1
      if (isEpisode) bucket.month.episodeCount += 1
    }

    if (at >= weekCutoff && !seenWeek.has(dedupeKey)) {
      seenWeek.add(dedupeKey)
      bucket.week.count += 1
      bucket.week.minutes += minutes
      if (isMovie) bucket.week.movieCount += 1
      if (isEpisode) bucket.week.episodeCount += 1
    }
  }

  return totals
}

/** Totals for a user with no events in the window. */
export function zeroPeriodTotals(): UserPeriodTotals {
  return { week: emptyTotals(), month: emptyTotals() }
}
