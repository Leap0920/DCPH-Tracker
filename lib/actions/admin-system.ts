"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { requireAdmin } from "@/lib/auth/admin"
import { createAdminClient } from "@/utils/supabase/admin"

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

// ─────────────────────────────────────────────────────────────
// API sync triggers (reuse the existing /api/sync route logic).
// ─────────────────────────────────────────────────────────────

type SyncMode = "seed" | "airing"

export async function triggerSync(mode: SyncMode): Promise<ActionResult> {
  await requireAdmin()

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return {
      ok: false,
      error: "CRON_SECRET is not configured, so sync cannot be triggered from the server.",
    }
  }

  // Build an absolute URL to our own /api/sync endpoint.
  const h = await headers()
  const host = h.get("host")
  const proto = h.get("x-forwarded-proto") ?? "https"
  const base = process.env.NEXT_PUBLIC_SITE_URL || (host ? `${proto}://${host}` : "")
  if (!base) return { ok: false, error: "Could not determine site URL for sync request." }

  try {
    const res = await fetch(`${base}/api/sync?mode=${mode}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cronSecret}` },
      cache: "no-store",
    })
    const json = await res.json()
    if (!res.ok) {
      return { ok: false, error: json?.error || `Sync failed (${res.status}).` }
    }

    revalidatePath("/admin")
    revalidatePath("/admin/sync")
    revalidatePath("/tracker")

    const results = Array.isArray(json?.results) ? json.results : []
    const summary = results
      .map((r: { type: string; inserted: number; note?: string }) =>
        r.note ? `${r.type}: ${r.note}` : `${r.type}: ${r.inserted} synced`
      )
      .join(" · ")
    return { ok: true, message: summary || "Sync complete." }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sync request failed." }
  }
}

// ─────────────────────────────────────────────────────────────
// User & role management.
// ─────────────────────────────────────────────────────────────

type Role = "member" | "moderator" | "admin"
const ROLES: Role[] = ["member", "moderator", "admin"]

export async function updateUserRole(userId: string, role: Role): Promise<ActionResult> {
  const me = await requireAdmin()
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: "Service role key not configured." }

  if (!ROLES.includes(role)) return { ok: false, error: "Invalid role." }
  if (!userId) return { ok: false, error: "Missing user id." }

  // Prevent an admin from demoting themselves (avoids accidental lockout).
  if (userId === me.user_id && role !== "admin") {
    return { ok: false, error: "You can't change your own admin role." }
  }

  const { error } = await admin
    .from("profiles")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("user_id", userId)

  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/users")
  return { ok: true, message: "Role updated." }
}

// ─────────────────────────────────────────────────────────────
// User moderation (ban / suspend / reactivate).
// ─────────────────────────────────────────────────────────────

export type UserStatus = "active" | "suspended" | "banned"
const STATUSES: UserStatus[] = ["active", "suspended", "banned"]

// Suspension duration when no explicit end date is provided (7 days).
const DEFAULT_SUSPENSION_MS = 7 * 24 * 60 * 60 * 1000

export async function setUserStatus(
  userId: string,
  status: UserStatus,
  reason?: string
): Promise<ActionResult> {
  const me = await requireAdmin()
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: "Service role key not configured." }

  if (!STATUSES.includes(status)) return { ok: false, error: "Invalid status." }
  if (!userId) return { ok: false, error: "Missing user id." }

  // Like the role guard: an admin can't moderate their own account.
  if (userId === me.user_id) {
    return { ok: false, error: "You can't change your own account status." }
  }

  const now = new Date().toISOString()
  const patch: {
    status: UserStatus
    updated_at: string
    banned_at?: string | null
    ban_reason?: string | null
    suspended_until?: string | null
  } = { status, updated_at: now }

  if (status === "banned") {
    patch.banned_at = now
    patch.ban_reason = reason?.trim() || null
    patch.suspended_until = null
  } else if (status === "suspended") {
    patch.banned_at = null
    patch.ban_reason = null
    patch.suspended_until = new Date(Date.now() + DEFAULT_SUSPENSION_MS).toISOString()
  } else {
    // active — clear all moderation fields.
    patch.banned_at = null
    patch.ban_reason = null
    patch.suspended_until = null
  }

  const { error } = await admin
    .from("profiles")
    .update(patch)
    .eq("user_id", userId)

  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/users")
  return { ok: true, message: `User ${status}.` }
}

// ─────────────────────────────────────────────────────────────
// Account deletion (permanent).
// ─────────────────────────────────────────────────────────────

export async function deleteUserAccount(userId: string): Promise<ActionResult> {
  const me = await requireAdmin()
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: "Service role key not configured." }

  if (!userId) return { ok: false, error: "Missing user id." }
  if (userId === me.user_id) {
    return { ok: false, error: "You can't delete your own account." }
  }

  // Deleting from auth.users cascades to profiles (on delete cascade) and
  // any FK-cascading dependents; watch_status rows carry user FK references.
  const { error } = await admin.auth.admin.deleteUser(userId)

  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/users")
  return { ok: true, message: "Account deleted." }
}
