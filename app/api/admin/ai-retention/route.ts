// app/api/admin/ai-retention/route.ts
//
// The retention sweep for `ai_request_log`: delete rows older than
// AI_LOG_RETENTION_DAYS (default 90) in bounded batches.
//
// Three properties, all deliberate.
//
// Auth is `CRON_SECRET` only. There is no session path: an admin browser tab
// cannot delete log rows, so a stolen admin session cannot destroy the audit
// trail. The secret arrives as `Authorization: Bearer` (constraint 3) and is
// compared through the shared constant-time helper.
//
// The default is a dry run. Only `?dry_run=false` deletes anything, so a cron
// misconfiguration or a stray curl is a count, not a data loss.
//
// Every bound lives in the store (lib/ai/observability/store.ts): the retention
// age, the batch size and the per-run batch cap. This route names none of them,
// and the cutoff it deletes against is the store's own arithmetic -- never
// `resolveWindow`, which would clamp a 90-day cutoff to 30 (F2).
import { NextResponse, type NextRequest } from "next/server"

import { fail, handleApiError } from "@/lib/api-utils"
import { cronSecret, headerMatchesSecret } from "@/lib/cron-auth"
import { logger } from "@/lib/logger"
import { isSameOrigin } from "@/lib/origin-check"
import { createAdminClient } from "@/utils/supabase/admin"
import {
  createObservabilityStore,
  createSupabaseObservabilityPort,
  type ObservabilityClient,
} from "@/lib/ai/observability/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** The message the ingest-corpus, feedback and observability routes already use. */
const MISSING_SERVICE_ROLE = "Missing Supabase service role env vars"

/** The batch cap bounds one invocation, so a sweep needs room to finish them. */
export const maxDuration = 60

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function GET(request: NextRequest) {
  // A cron sends no Origin, so this passes; a browser form post from another
  // site cannot. Cheaper than a round trip and consistent with the sibling
  // admin routes.
  if (!isSameOrigin(request)) return fail(403, "Forbidden")

  // The only door. An unauthenticated call must not reach the database at all.
  if (!headerMatchesSecret(request.headers.get("authorization"), cronSecret())) {
    return fail(401, "Unauthorized")
  }

  const admin = createAdminClient()
  if (admin === null) return fail(500, MISSING_SERVICE_ROLE)

  // Only the exact string `false` arms the delete; absent, "true", "1" and
  // anything else stay dry. A cron that forgets the parameter deletes nothing.
  const dryRun = new URL(request.url).searchParams.get("dry_run") !== "false"

  // One clock read for the whole request, as the observability route does: the
  // store resolves its cutoff from this seam, and a per-call read could straddle
  // a millisecond.
  const now = Date.now()
  const store = createObservabilityStore({
    port: createSupabaseObservabilityPort(admin as unknown as ObservabilityClient),
    now: () => now,
  })

  try {
    const report = await store.retention({ dryRun })
    return NextResponse.json(
      // `cutoff` restates `cutoffMs` as an ISO string for a human reading the
      // cron log; `exhausted` is the field that says whether the sweep finished
      // or stopped at the run cap.
      { ok: true, ...report, cutoff: new Date(report.cutoffMs).toISOString() },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    // The store's message names the method that failed and carries the
    // database's own text. The caller holds the cron secret, so a missing table
    // or a denied delete has to be visible rather than a generic 500.
    logger.error("admin_ai_retention_failed", { error: messageOf(error) })
    return fail(500, messageOf(error))
  }
}
