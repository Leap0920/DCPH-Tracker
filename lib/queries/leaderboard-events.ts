import type { SupabaseClient } from "@supabase/supabase-js"
import {
  MONTH_DAYS,
  aggregatePeriods,
  type PeriodEvent,
  type UserPeriodTotals,
} from "@/lib/leaderboard-periods"

const PAGE_SIZE = 1000

/**
 * Fetches watch_events for the rolling window and returns per-user totals.
 *
 * Unlike getRankings, which must paginate the whole watch_status table, this is
 * bounded by the created_at filter and served by watch_events_created_at_idx —
 * only the last MONTH_DAYS of rows are read regardless of how large the log grows.
 *
 * Reads with the ordinary (anon/authenticated) client: no service-role key exists
 * in this project's runtime, which is why watch_events has a public SELECT policy.
 */
export async function fetchPeriodTotals(
  supabase: SupabaseClient,
  { now = new Date() }: { now?: Date } = {},
): Promise<Map<string, UserPeriodTotals>> {
  const cutoff = new Date(now.getTime() - MONTH_DAYS * 86_400_000).toISOString()
  const events: PeriodEvent[] = []

  for (let page = 0; ; page += 1) {
    const { data, error } = await supabase
      .from("watch_events")
      .select("user_id, content_id, created_at, content_entries(runtime_minutes, type)")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    for (const row of data as unknown as Array<{
      user_id: string
      content_id: string
      created_at: string
      // PostgREST returns an object for a to-one embed, but the generated types
      // sometimes widen it to an array — handle both.
      content_entries:
        | { runtime_minutes: number | null; type: string | null }
        | Array<{ runtime_minutes: number | null; type: string | null }>
        | null
    }>) {
      const entry = Array.isArray(row.content_entries)
        ? row.content_entries[0]
        : row.content_entries
      events.push({
        user_id: row.user_id,
        content_id: row.content_id,
        created_at: row.created_at,
        runtime_minutes: entry?.runtime_minutes ?? null,
        type: entry?.type ?? null,
      })
    }

    if (data.length < PAGE_SIZE) break
  }

  return aggregatePeriods(events, { now })
}
