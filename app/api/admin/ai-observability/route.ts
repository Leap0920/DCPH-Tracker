// app/api/admin/ai-observability/route.ts
//
// The machine-facing read of the request log. The operator page reads the store
// directly (D1); this route exists for a cron or other tooling that has no
// session. Two ways in, one shape out: an admin session, or the constant-time
// `Authorization: Bearer <CRON_SECRET>` check in lib/cron-auth.ts (the one copy
// in the repo). The secret grants no wider a query -- the same window is parsed,
// the same store answers, and the same body comes back.
//
// The window is validated here and bounded by the store. The caller's edges are
// passed through unchanged; the store clamps them and reports the window it
// actually read, so this route carries no second copy of the bound.
import { NextResponse, type NextRequest } from "next/server"

import { fail, handleApiError } from "@/lib/api-utils"
import { cronSecret, headerMatchesSecret } from "@/lib/cron-auth"
import { logger } from "@/lib/logger"
import { isSameOrigin } from "@/lib/origin-check"
import { authRateLimitKey } from "@/lib/rate-limit"
import { rateLimitPersistent } from "@/lib/rate-limit-db"
import { createClient } from "@/utils/supabase/server"
import { createAdminClient } from "@/utils/supabase/admin"
import {
  createObservabilityStore,
  createSupabaseObservabilityPort,
  type ObservabilityClient,
} from "@/lib/ai/observability/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** The message the ingest-corpus and feedback routes already use for this condition. */
const MISSING_SERVICE_ROLE = "Missing Supabase service role env vars"

/** An unparseable edge is refused rather than silently defaulted. */
const BAD_WINDOW = "`since` and `until` must be ISO timestamps or epoch milliseconds."

interface Edge {
  ok: boolean
  value: number | undefined
}

/**
 * An ISO timestamp or epoch milliseconds. Absent is `undefined` (the store's
 * default window); present-but-unparseable is a 400. A finite number outside the
 * range `Date` can represent is refused too, because `toISOString` would throw
 * inside the port and surface as a 500 instead of a caller error.
 */
function parseEdge(raw: string | null): Edge {
  if (raw === null) return { ok: true, value: undefined }
  const text = raw.trim()
  const ms = /^-?\d+$/.test(text) ? Number(text) : Date.parse(text)
  if (!Number.isFinite(ms) || Number.isNaN(new Date(ms).getTime())) {
    return { ok: false, value: undefined }
  }
  return { ok: true, value: ms }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function GET(request: NextRequest) {
  if (!isSameOrigin(request)) return fail(403, "Forbidden")

  const rl = await rateLimitPersistent(
    `admin:ai-observability:${authRateLimitKey(request)}`,
    { limit: 30, windowMs: 60_000, failClosed: true }
  )
  if (!rl.allowed) return fail(429, "Too many requests. Please slow down.")

  // A cron has no session, so the secret is the other way in. It decides only
  // whether the session is consulted; both paths reach the same store read.
  const isCron = headerMatchesSecret(
    request.headers.get("authorization"),
    cronSecret()
  )
  if (!isCron) {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return fail(401, "Unauthorized")

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .single()
    if (error) return handleApiError(error, "admin.ai-observability")
    if (profile?.role !== "admin") return fail(403, "Admin access required")
  }

  const params = new URL(request.url).searchParams
  const since = parseEdge(params.get("since"))
  const until = parseEdge(params.get("until"))
  if (!since.ok || !until.ok) return fail(400, BAD_WINDOW)

  const admin = createAdminClient()
  if (admin === null) return fail(500, MISSING_SERVICE_ROLE)

  // One clock read for the whole request: `summary` and `feedbackSummary` each
  // resolve their own window, and two `Date.now()` calls can straddle a
  // millisecond, which would have the body report two different windows.
  const now = Date.now()
  const store = createObservabilityStore({
    port: createSupabaseObservabilityPort(admin as unknown as ObservabilityClient),
    now: () => now,
  })

  try {
    // The caller's edges go through untouched; the store clamps them and the
    // summary reports the window it read. One bound, in the module that owns it.
    const [summary, recent, feedback] = await Promise.all([
      store.summary({ sinceMs: since.value, untilMs: until.value }),
      store.recent(),
      store.feedbackSummary({ sinceMs: since.value, untilMs: until.value }),
    ])
    return NextResponse.json(
      { summary, recent, feedback },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    // The store's message names the method that failed and carries the database's
    // own text. The caller is an admin or a cron, and a missing table has to be
    // visible rather than hidden behind a generic 500.
    logger.error("admin_ai_observability_failed", { error: messageOf(error) })
    return fail(500, messageOf(error))
  }
}
