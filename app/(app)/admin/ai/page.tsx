import { requireAdmin } from "@/lib/auth/admin"
import { logger } from "@/lib/logger"
import { createAdminClient } from "@/utils/supabase/admin"
import {
  createObservabilityStore,
  createSupabaseObservabilityPort,
  type ObservabilityClient,
} from "@/lib/ai/observability/store"
import { AiObservabilityReport } from "@/components/admin/AiObservabilityReport"

export const dynamic = "force-dynamic"

/**
 * The operator surface for the AI request log. It reads the store directly with
 * the service-role client rather than fetching the JSON route (D1): a client
 * fetch would add a round trip and a second place the auth check could be
 * forgotten. The window is the store's default -- the route is where a caller
 * names one.
 */
export default async function AdminAiPage() {
  // The admin layout already calls requireAdmin(); this is defence in depth, the
  // same gate app/api/admin/route.ts applies to the same surface.
  await requireAdmin()

  const admin = createAdminClient()
  if (admin === null) return <AiObservabilityReport status="unavailable" />

  // One clock read for the whole render: `summary` and `feedbackSummary` each
  // resolve their own window, and two `Date.now()` calls can straddle a
  // millisecond, which would have the page show two different windows.
  const now = Date.now()
  const store = createObservabilityStore({
    port: createSupabaseObservabilityPort(admin as unknown as ObservabilityClient),
    now: () => now,
  })

  try {
    const [summary, recent, feedback] = await Promise.all([
      store.summary(),
      store.recent(),
      store.feedbackSummary(),
    ])
    return (
      <AiObservabilityReport
        status="ready"
        summary={summary}
        recent={recent}
        feedback={feedback}
      />
    )
  } catch (error) {
    // The deployed project has none of the 20260919* migrations applied, so every
    // store method rejects. The PostgREST text differs by version, so nothing is
    // matched -- any failure here means the log cannot be read today.
    logger.error("admin_ai_observability_unavailable", {
      error: error instanceof Error ? error.message : String(error),
    })
    return <AiObservabilityReport status="unavailable" />
  }
}
