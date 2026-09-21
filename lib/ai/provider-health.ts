import "server-only"
import { createAdminClient } from "@/utils/supabase/admin"
import {
  initialTargetState,
  recordSuccess as recordSuccessTransition,
  recordFailure as recordFailureTransition,
  type TargetState,
} from "@/lib/ai/circuit"
import type { FailureDecision } from "@/lib/ai/failure"

/**
 * Structural view of the admin client, covering only the two calls this module
 * makes. Declared locally because generated Supabase types omit
 * ai_provider_state until `supabase gen types` is re-run — the same reason
 * lib/rate-limit-db.ts declares RateLimitRpcClient.
 */
export interface HealthClient {
  from(table: string): {
    select(columns: string): {
      in(column: string, values: string[]): Promise<{
        data: Record<string, unknown>[] | null
        error: { message: string } | null
      }>
    }
    upsert(values: Record<string, unknown>): Promise<{ error: { message: string } | null }>
  }
}

export interface ProviderHealth {
  load(targetIds: string[]): Promise<Map<string, TargetState>>
  isAvailable(state: TargetState, now: number): boolean
  recordFailure(state: TargetState, decision: FailureDecision, status?: number | null): Promise<void>
  recordSuccess(state: TargetState): Promise<void>
}

export interface ProviderHealthDeps {
  client?: HealthClient | null
  now?: () => number
  random?: () => number
}

/** In-process fallback, used when no service-role key is configured. */
const memory = new Map<string, TargetState>()

function rowToState(row: Record<string, unknown>): TargetState {
  const openUntil = row.open_until
  return {
    targetId: String(row.target),
    consecutiveFailures: Number(row.consecutive_failures ?? 0),
    openUntil:
      typeof openUntil === "string" ? Date.parse(openUntil) : openUntil instanceof Date ? openUntil.getTime() : null,
    lastFailureKind: (row.last_failure_kind as TargetState["lastFailureKind"]) ?? null,
    lastStatus: row.last_status == null ? null : Number(row.last_status),
    lastError: row.last_error == null ? null : String(row.last_error),
    lastUsedAt: row.last_used_at ? Date.parse(String(row.last_used_at)) : null,
    successCount: Number(row.success_count ?? 0),
    failureCount: Number(row.failure_count ?? 0),
  }
}

function stateToRow(state: TargetState): Record<string, unknown> {
  return {
    target: state.targetId,
    consecutive_failures: state.consecutiveFailures,
    open_until: state.openUntil === null ? null : new Date(state.openUntil).toISOString(),
    last_failure_kind: state.lastFailureKind,
    last_status: state.lastStatus,
    last_error: state.lastError,
    last_used_at: state.lastUsedAt === null ? null : new Date(state.lastUsedAt).toISOString(),
    success_count: state.successCount,
    failure_count: state.failureCount,
    updated_at: new Date().toISOString(),
  }
}

/**
 * Circuit state, shared across instances when a service-role key is present.
 *
 * Every method degrades to the in-process map rather than throwing. This layer
 * is an optimisation — a cold or unavailable health store must cost efficiency,
 * never availability.
 */
export function createProviderHealth(deps: ProviderHealthDeps = {}): ProviderHealth {
  const client = deps.client === undefined ? (createAdminClient() as HealthClient | null) : deps.client
  const now = deps.now ?? Date.now
  const random = deps.random ?? Math.random

  async function persist(state: TargetState): Promise<void> {
    memory.set(state.targetId, state)
    if (!client) return
    try {
      const { error } = await client.from("ai_provider_state").upsert(stateToRow(state))
      if (error) console.error("[ai-health] upsert failed", error.message)
    } catch (err) {
      console.error("[ai-health] upsert threw", err)
    }
  }

  return {
    async load(targetIds) {
      const states = new Map<string, TargetState>()
      for (const id of targetIds) {
        const cached = memory.get(id)
        if (cached) states.set(id, cached)
      }
      if (!client || targetIds.length === 0) {
        for (const id of targetIds) if (!states.has(id)) states.set(id, initialTargetState(id))
        return states
      }

      try {
        const { data, error } = await client
          .from("ai_provider_state")
          .select("*")
          .in("target", targetIds)
        if (error) throw new Error(error.message)
        for (const row of data ?? []) {
          const state = rowToState(row)
          states.set(state.targetId, state)
        }
      } catch (err) {
        console.error("[ai-health] load failed, using in-process state", err)
      }

      for (const id of targetIds) if (!states.has(id)) states.set(id, initialTargetState(id))
      return states
    },

    isAvailable(state, at) {
      return state.openUntil === null || state.openUntil <= at
    },

    async recordFailure(state, decision, status = null) {
      const next = recordFailureTransition(state, decision, now(), random, {
        kind: decision.kind,
        status,
        error: state.lastError,
      })
      await persist(next)
    },

    async recordSuccess(state) {
      await persist(recordSuccessTransition(state, now()))
    },
  }
}
