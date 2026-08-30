import type { NextRequest } from "next/server"
import { ok, fail, handleApiError } from "@/lib/api-utils"
import { isResetConfirmed, RESET_CONFIRM_PHRASE } from "@/lib/tracker-reset"
import {
  authorizeAccountMutation,
  deleteRowsForUser,
  readConfirmPhrase,
} from "@/lib/account-data"
import { logger } from "@/lib/logger"

/**
 * POST /api/account/reset-progress — wipe a user's viewing progress.
 *
 * WHY THIS ROUTE EXISTS when the tracker reset used to run entirely in the
 * browser: progress is stored in TWO places now.
 *
 *   1. watch_status  — one row per (user, entry): status, rewatch count,
 *                      favorite, rating.
 *   2. watch_events  — the append-only log that powers the rolling 7/30-day
 *                      leaderboards.
 *
 * Only #1 is deletable from the browser. migration-watch-events.sql revokes
 * DELETE on watch_events from `anon, authenticated` as defence in depth, so no
 * client-side call can clear it. Without this route a "reset" would leave the
 * user sitting on the weekly board with progress they no longer have.
 *
 * Deleting rows can only ever LOWER a user's period totals, so purging the log
 * does not reopen the inflation vector the append-only design was built to
 * close (mark-all → unwatch → mark-all farming).
 *
 * SPLIT-BRAIN BY DESIGN, not by accident:
 *   - watch_status is deleted through the SESSION client. RLS enforces
 *     `auth.uid() = user_id` and the restrictive ban gate, so a caller can
 *     never reach another account's rows and a banned account is blocked in
 *     Postgres, not in TypeScript.
 *   - watch_events is deleted through the SERVICE-ROLE client, the only role
 *     that still holds DELETE on that table. Because that bypasses the ban
 *     gate, the profile status is checked first (see below).
 *
 * If SUPABASE_SERVICE_ROLE_KEY is unset the log is left alone and the response
 * says so (`eventsCleared: null`) rather than failing the whole reset: the
 * visible progress is still cleared, and the UI reports the omission honestly.
 */

/** 5 resets per hour per user. One is plenty; the rest is accident insurance. */
const QUOTA = { limit: 5, windowMs: 60 * 60_000 } as const

export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeAccountMutation(request, {
      scope: "reset-progress",
      ...QUOTA,
    })
    if (!auth.allowed) return auth.response

    const confirm = await readConfirmPhrase(request)
    if (!isResetConfirmed(confirm)) {
      return fail(400, `Type ${RESET_CONFIRM_PHRASE} to confirm.`)
    }

    const { user, supabase, admin } = auth

    // Ban gate for the service-role half. watch_status would refuse a banned
    // account inside Postgres, but watch_events is deleted with RLS bypassed,
    // so honour the same restriction here.
    const { data: profile } = await supabase
      .from("profiles")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle()

    if (profile && profile.status !== "active") {
      return fail(403, "Your account is restricted. Contact an admin.")
    }

    // The activity log first: if it fails, nothing visible has been destroyed
    // yet and the user can simply retry.
    let eventsCleared: number | null = null
    if (admin) {
      eventsCleared = await deleteRowsForUser(admin, "watch_events", user.id)
    } else {
      logger.warn("account_reset.service_role_missing", {
        userId: user.id,
        detail: "watch_events left intact; SUPABASE_SERVICE_ROLE_KEY unset",
      })
    }

    // .select() returns the deleted rows: that is both the count for the
    // success banner and the content ids whose community rating averages move.
    const { data: deleted, error: deleteError } = await supabase
      .from("watch_status")
      .delete()
      .eq("user_id", user.id)
      .select("content_id")

    if (deleteError) throw deleteError

    const tracked = (deleted ?? []).length

    logger.info("account_reset.succeeded", {
      userId: user.id,
      tracked,
      eventsCleared,
    })

    return ok({
      tracked,
      eventsCleared,
      contentIds: (deleted ?? []).map((row) => row.content_id),
    })
  } catch (error) {
    return handleApiError(error, "account.reset-progress")
  }
}
