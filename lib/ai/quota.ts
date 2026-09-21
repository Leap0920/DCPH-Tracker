import "server-only"
import { createAdminClient } from "@/utils/supabase/admin"

/** Structural view of the existing rate_limit_hit RPC. */
export interface QuotaClient {
  rpc(
    fn: "rate_limit_hit",
    args: { p_key: string; p_limit: number; p_window_seconds: number }
  ): Promise<{
    data: { allowed: boolean; retry_after_seconds: number } | null
    error: { message: string } | null
  }>
}

export interface QuotaTracker {
  /** Records one request against the target's budget. False = budget spent. */
  consume(targetId: string, dailyRequestBudget: number): Promise<boolean>
}

export interface QuotaTrackerDeps {
  client?: QuotaClient | null
}

const DAY_SECONDS = 86_400

/**
 * Free-tier request budgets, enforced before we burn a call.
 *
 * Reuses the existing rate_limit_hit RPC, which is already atomic and
 * cross-instance. The window is a rolling 24h rather than a calendar day,
 * which is stricter than the providers' own accounting and therefore safe:
 * we can only ever under-use the quota, never overshoot it.
 *
 * Fails OPEN. Free-tier capacity that goes unused because the quota store is
 * down is a worse outcome than an occasional 429 we already handle.
 */
export function createQuotaTracker(deps: QuotaTrackerDeps = {}): QuotaTracker {
  const client =
    deps.client === undefined ? (createAdminClient() as QuotaClient | null) : deps.client

  return {
    async consume(targetId, dailyRequestBudget) {
      if (!client || dailyRequestBudget <= 0) return true
      try {
        const { data, error } = await client.rpc("rate_limit_hit", {
          p_key: `ai:quota:${targetId}`,
          p_limit: dailyRequestBudget,
          p_window_seconds: DAY_SECONDS,
        })
        if (error) throw new Error(error.message)
        const row = Array.isArray(data) ? data[0] : data
        if (!row) throw new Error("rate_limit_hit returned no row")
        return Boolean(row.allowed)
      } catch (err) {
        console.error("[ai-quota] store unavailable, failing open", err)
        return true
      }
    },
  }
}
