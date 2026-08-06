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
