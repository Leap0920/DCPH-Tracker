"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/auth/admin"
import { createAdminClient } from "@/utils/supabase/admin"
import type { Database } from "@/types/database.types"

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

/**
 * Approves a single staged entry from sync_staging.
 * Inserts it into content_entries and marks its staging status as 'approved'.
 */
export async function approveStagedEntry(id: string): Promise<ActionResult> {
  await requireAdmin()
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: "Service role key not configured." }
  if (!id) return { ok: false, error: "Missing staged entry ID." }

  const { data: staged, error: fetchErr } = await admin
    .from("sync_staging")
    .select("*")
    .eq("id", id)
    .single()

  if (fetchErr || !staged) {
    return { ok: false, error: fetchErr?.message || "Staged entry not found." }
  }

  // 1. Insert/upsert into official content_entries table
  const contentRow: Database["public"]["Tables"]["content_entries"]["Insert"] = {
    slug: staged.slug,
    title: staged.title,
    type: staged.type as Database["public"]["Tables"]["content_entries"]["Row"]["type"],
    episode_number: staged.episode_number,
    movie_number: staged.movie_number,
    air_date: staged.air_date ?? new Date().toISOString().split("T")[0],
    canon_order: staged.canon_order ?? 0,
    synopsis: staged.synopsis,
    image_url: staged.image_url,
    runtime_minutes: staged.runtime_minutes,
  }

  const { error: insertErr } = await admin
    .from("content_entries")
    .upsert(contentRow, { onConflict: "slug" })

  if (insertErr) {
    return { ok: false, error: `Publishing failed: ${insertErr.message}` }
  }

  // 2. Mark staging entry as approved
  await admin
    .from("sync_staging")
    .update({ status: "approved" })
    .eq("id", id)

  revalidatePath("/admin/sync")
  revalidatePath("/admin/content")
  revalidatePath("/tracker")
  return { ok: true, message: `Approved and published "${staged.title}".` }
}

/**
 * Rejects a single staged entry from sync_staging.
 */
export async function rejectStagedEntry(id: string): Promise<ActionResult> {
  await requireAdmin()
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: "Service role key not configured." }
  if (!id) return { ok: false, error: "Missing staged entry ID." }

  const { error } = await admin
    .from("sync_staging")
    .update({ status: "rejected" })
    .eq("id", id)

  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/sync")
  return { ok: true, message: "Entry rejected." }
}

/**
 * Approves all pending staged entries in bulk.
 */
export async function approveAllStagedEntries(): Promise<ActionResult> {
  await requireAdmin()
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: "Service role key not configured." }

  const { data: pendingEntries, error: fetchErr } = await admin
    .from("sync_staging")
    .select("*")
    .eq("status", "pending")

  if (fetchErr) return { ok: false, error: fetchErr.message }
  if (!pendingEntries || pendingEntries.length === 0) {
    return { ok: true, message: "No pending entries to approve." }
  }

  const contentRows: Database["public"]["Tables"]["content_entries"]["Insert"][] = pendingEntries.map((staged) => ({
    slug: staged.slug,
    title: staged.title,
    type: staged.type as Database["public"]["Tables"]["content_entries"]["Row"]["type"],
    episode_number: staged.episode_number,
    movie_number: staged.movie_number,
    air_date: staged.air_date ?? new Date().toISOString().split("T")[0],
    canon_order: staged.canon_order ?? 0,
    synopsis: staged.synopsis,
    image_url: staged.image_url,
    runtime_minutes: staged.runtime_minutes,
  }))

  const { error: upsertErr } = await admin
    .from("content_entries")
    .upsert(contentRows, { onConflict: "slug" })

  if (upsertErr) return { ok: false, error: upsertErr.message }

  const pendingIds = pendingEntries.map((e) => e.id)
  await admin
    .from("sync_staging")
    .update({ status: "approved" })
    .in("id", pendingIds)

  revalidatePath("/admin/sync")
  revalidatePath("/admin/content")
  revalidatePath("/tracker")
  return { ok: true, message: `Approved and published ${pendingEntries.length} entries.` }
}

/**
 * Rejects all pending staged entries in bulk.
 */
export async function rejectAllStagedEntries(): Promise<ActionResult> {
  await requireAdmin()
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: "Service role key not configured." }

  const { error } = await admin
    .from("sync_staging")
    .update({ status: "rejected" })
    .eq("status", "pending")

  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/sync")
  return { ok: true, message: "All pending entries rejected." }
}

/**
 * Clears old reviewed (approved/rejected) staging records.
 */
export async function clearStagingHistory(): Promise<ActionResult> {
  await requireAdmin()
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: "Service role key not configured." }

  const { error } = await admin
    .from("sync_staging")
    .delete()
    .in("status", ["approved", "rejected"])

  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/sync")
  return { ok: true, message: "Staging history cleared." }
}
