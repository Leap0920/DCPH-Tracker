import type { NextRequest } from "next/server"
import { ok, fail, handleApiError } from "@/lib/api-utils"
import { isDeleteConfirmed, DELETE_CONFIRM_PHRASE } from "@/lib/account-deletion"
import { ownerGuard } from "@/lib/owner-protection"
import {
  ACCOUNT_SWEEP_TABLES,
  authorizeAccountMutation,
  deleteRowsForUser,
  isMissingRelationError,
  readConfirmPhrase,
  removeAvatarFolder,
} from "@/lib/account-data"
import { logger } from "@/lib/logger"

/**
 * POST /api/account/delete — permanently delete the signed-in account.
 *
 * Ordering matters more than anything else here, because a half-finished
 * deletion is worse than a refused one:
 *
 *   1. Remove avatar objects from storage FIRST. Storage is not cascade-deleted
 *      with the auth user, and a row in storage.objects still owned by the user
 *      can make the auth delete fail on a foreign-key violation.
 *   2. Delete the AUTH USER. This is the atomic step: every public table
 *      (profiles, watch_status, watch_events, episode_comments, chat_messages,
 *      user_badges, notifications, active_sessions) declares
 *      `references auth.users(id) on delete cascade`, so Postgres removes the
 *      whole footprint in one transaction. If this fails, nothing has been
 *      destroyed — the user keeps a working account and can retry.
 *   3. Defensive sweep of the same tables. A no-op on a healthy schema; it
 *      catches a future table that forgot its ON DELETE CASCADE clause.
 *
 * Service-role is REQUIRED (GoTrue admin API). With
 * SUPABASE_SERVICE_ROLE_KEY unset the route returns 503 rather than deleting
 * the public rows and leaving a live auth user behind — that half-state is the
 * one failure mode worth designing the whole ordering around.
 *
 * The system owner is refused: ownerGuard() fails closed, so if the owner
 * lookup itself breaks, deletion is refused rather than gambling on it.
 */

/** 3 attempts per hour per user — retries after a transient failure, no more. */
const QUOTA = { limit: 3, windowMs: 60 * 60_000 } as const

export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeAccountMutation(request, {
      scope: "delete-account",
      ...QUOTA,
    })
    if (!auth.allowed) return auth.response

    const confirm = await readConfirmPhrase(request)
    if (!isDeleteConfirmed(confirm)) {
      return fail(400, `Type ${DELETE_CONFIRM_PHRASE} to confirm.`)
    }

    const { user, admin } = auth

    if (!admin) {
      return fail(
        503,
        "Account deletion isn't available on this server yet. Contact support."
      )
    }

    const ownerBlocked = await ownerGuard(user.id)
    if (ownerBlocked) return fail(403, ownerBlocked)

    // 1. Storage, before the auth row goes away.
    const avatarsRemoved = await removeAvatarFolder(admin, user.id)

    // 2. The atomic step.
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)

    if (deleteError) {
      // Log the real reason server-side; the client gets a generic message.
      logger.error("account_delete.auth_failed", {
        userId: user.id,
        error: deleteError.message,
        status: deleteError.status,
      })
      return fail(
        500,
        "We couldn't delete your account. Please try again or contact support."
      )
    }

    // 3. Best-effort sweep. Failures here are logged, never surfaced: the
    // account is already gone, and "deleted, plus one warning" is not a thing
    // a user can act on.
    const swept: Record<string, number> = {}
    for (const table of ACCOUNT_SWEEP_TABLES) {
      try {
        const removed = await deleteRowsForUser(admin, table, user.id)
        if (removed > 0) swept[table] = removed
      } catch (error) {
        if (!isMissingRelationError(error)) {
          logger.warn("account_delete.sweep_failed", {
            table,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    logger.info("account_delete.succeeded", {
      userId: user.id,
      avatarsRemoved,
      swept,
    })

    return ok({ deleted: true })
  } catch (error) {
    return handleApiError(error, "account.delete")
  }
}
