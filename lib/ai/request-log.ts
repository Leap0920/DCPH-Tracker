// lib/ai/request-log.ts
import "server-only"
import { createAdminClient } from "@/utils/supabase/admin"

/** Structural view of the admin client, covering only the insert this module makes. */
export interface RequestLogClient {
  from(table: string): {
    insert(values: Record<string, unknown>): Promise<{ error: { message: string } | null }>
  }
}

export interface AttemptRecord {
  targetId: string
  outcome: string
  status?: number | null
}

export interface RequestLogEntry {
  outcome: string
  attempts: AttemptRecord[]
  userId?: string | null
  conversationId?: string | null
  targetId?: string | null
  planMs?: number | null
  retrieveMs?: number | null
  ttftMs?: number | null
  totalMs?: number | null
  docCount?: number | null
  cacheHit?: boolean
  degradedReason?: string | null
  /** Which planner decided: "router", "model" or "fallback" (Task 13). */
  planSource?: string | null
  /** The tools the plan dispatched, in execution order; capped before insert. */
  tools?: string[] | null
  /** Whether the answer's [E#] citations all resolved to supplied evidence. */
  citationsValid?: boolean | null
  promptTokens?: number | null
  completionTokens?: number | null
}

/**
 * The `tools` column's bound, not the pipeline's: the plan schema already limits
 * a plan to four steps, so eight never truncates a real request while keeping a
 * hand-built entry from writing an unbounded array into the row.
 */
export const MAX_LOGGED_TOOLS = 8

export interface RequestLogDeps {
  client?: RequestLogClient | null
}

/**
 * Fire-and-forget observability.
 *
 * Never throws and never awaited on the response path: a logging failure must
 * not turn a successful answer into an error, and it must not add latency to
 * the stream.
 */
export async function logRequest(
  entry: RequestLogEntry,
  deps: RequestLogDeps = {}
): Promise<void> {
  const client =
    deps.client === undefined ? (createAdminClient() as RequestLogClient | null) : deps.client
  if (!client) return

  try {
    const { error } = await client.from("ai_request_log").insert({
      user_id: entry.userId ?? null,
      conversation_id: entry.conversationId ?? null,
      target_id: entry.targetId ?? null,
      outcome: entry.outcome,
      plan_ms: entry.planMs ?? null,
      retrieve_ms: entry.retrieveMs ?? null,
      ttft_ms: entry.ttftMs ?? null,
      total_ms: entry.totalMs ?? null,
      attempts: entry.attempts,
      doc_count: entry.docCount ?? null,
      cache_hit: entry.cacheHit ?? false,
      degraded_reason: entry.degradedReason ?? null,
      // `?? null`, never a falsy test: an empty tool list and a `false` citation
      // verdict are real answers, and reading them as "not measured" would make
      // a v2 request indistinguishable from a row written before the pipeline.
      plan_source: entry.planSource ?? null,
      tools: entry.tools?.slice(0, MAX_LOGGED_TOOLS) ?? null,
      citations_valid: entry.citationsValid ?? null,
      prompt_tokens: entry.promptTokens ?? null,
      completion_tokens: entry.completionTokens ?? null,
    })
    if (error) console.error("[ai-log] insert failed", error.message)
  } catch (err) {
    console.error("[ai-log] insert threw", err)
  }
}
