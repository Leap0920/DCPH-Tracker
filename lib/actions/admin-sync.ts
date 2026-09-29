"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/auth/admin"
import { createAdminClient } from "@/utils/supabase/admin"
import { defaultRuntimeMinutes, isPlausibleRuntime } from "@/lib/runtime-defaults"
import type { Database } from "@/types/database.types"

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

type StagedRow = Database["public"]["Tables"]["sync_staging"]["Row"]
type ContentInsert = Database["public"]["Tables"]["content_entries"]["Insert"]

/**
 * Maps one staged row to a content_entries insert.
 *
 * Extracted because approveStagedEntry and approveAllStagedEntries had two
 * byte-identical copies of this mapping — the kind of duplication where a fix
 * lands in one and not the other.
 *
 * runtime_minutes is SANITIZED here rather than passed through. Two reasons:
 *   - app/api/sync/route.ts stages episodes with runtime_minutes: null, because
 *     Jikan exposes no per-episode duration. Analytics SUMs that column, so a
 *     published NULL counts as zero minutes and understates watch time — this is
 *     what put 1,205 episodes at zero (see
 *     supabase/migration-fix-runtime-minutes.sql).
 *   - upstream sources have written source IDs into the field before (a movie row
 *     read 1188 minutes, i.e. 19.8 hours). isPlausibleRuntime rejects those.
 *
 * Substituting a bounded default is deliberate: a slightly wrong runtime keeps
 * analytics approximately right, whereas NULL makes it silently and precisely
 * wrong. Detective Conan's hour and 2-hour specials still need per-slug
 * correction — see step 6 of the migration.
 */
function toContentRow(staged: StagedRow): ContentInsert {
  return {
    slug: staged.slug,
    title: staged.title,
    type: staged.type as Database["public"]["Tables"]["content_entries"]["Row"]["type"],
    episode_number: staged.episode_number,
    movie_number: staged.movie_number,
    air_date: staged.air_date ?? new Date().toISOString().split("T")[0],
    canon_order: staged.canon_order ?? 0,
    synopsis: staged.synopsis,
    image_url: staged.image_url,
    runtime_minutes: isPlausibleRuntime(staged.runtime_minutes)
      ? staged.runtime_minutes
      : defaultRuntimeMinutes(staged.type),
  }
}

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

  // 1. Publish into content_entries.
  //
  // ignoreDuplicates: true => ON CONFLICT DO NOTHING, changed from the previous
  // DO UPDATE SET (every column). That old behaviour meant re-approving an
  // existing slug overwrote title, synopsis, image_url AND runtime_minutes with
  // whatever the sync source last returned — silently replacing hand-curated
  // cover art and any per-slug runtime correction.
  //
  // stageBatch() already filters slugs that exist in content_entries, so a
  // conflict here only happens via a stale pending row or a race. In both cases
  // the entry has already been reviewed by a human, and "leave it alone" is
  // correct for every column. Editing a published entry belongs in the admin
  // content form, not in an approve action that touches nine columns invisibly.
  //
  // .select() returns ONLY the rows actually inserted under
  // resolution=ignore-duplicates, which is how we can tell published from
  // skipped and say so.
  const contentRow = toContentRow(staged)

  const { data: published, error: insertErr } = await admin
    .from("content_entries")
    .upsert(contentRow, { onConflict: "slug", ignoreDuplicates: true })
    .select("slug")

  if (insertErr) {
    return { ok: false, error: `Publishing failed: ${insertErr.message}` }
  }

  const wasSkipped = (published?.length ?? 0) === 0

  // 2. Mark staging entry as approved
  const { error: statusErr } = await admin
    .from("sync_staging")
    .update({ status: "approved" })
    .eq("id", id)

  revalidatePath("/admin/sync")
  revalidatePath("/admin/content")
  revalidatePath("/tracker")

  if (statusErr) {
    // The publish landed, so the tracker is correct; the row simply stays in the
    // queue. Saying so beats reporting a clean success the admin cannot see.
    return {
      ok: false,
      error: `${staged.title}: ${
        wasSkipped ? "left untouched (already existed)" : "published"
      }, but marking the queue row approved failed: ${statusErr.message}`,
    }
  }

  return {
    ok: true,
    message: wasSkipped
      ? `"${staged.title}" already exists in the tracker and was left untouched. Marked as approved.`
      : `Approved and published "${staged.title}".`,
  }
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
 * Marks staged rows approved, in id batches.
 *
 * Batched because the ids travel in the query string: a full seed queues 1,200+
 * rows, and one `.in()` with every id is an ~45KB URL that a proxy can reject.
 * Returns the first error message, or null when every batch landed.
 */
async function markApproved(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  ids: string[]
): Promise<string | null> {
  const ID_BATCH = 100
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const { error } = await admin
      .from("sync_staging")
      .update({ status: "approved" })
      .in("id", ids.slice(i, i + ID_BATCH))
    if (error) return error.message
  }
  return null
}

/**
 * Approves all pending staged entries in bulk.
 */
export async function approveAllStagedEntries(): Promise<ActionResult> {
  await requireAdmin()
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: "Service role key not configured." }

  // Paginated: a full seed queues 1,200+ rows and PostgREST caps each response
  // at 1,000, so the unpaginated read silently left the rest of the queue
  // pending while reporting that it had approved everything.
  const pendingEntries: StagedRow[] = []
  const PAGE_SIZE = 1000
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: chunk, error: fetchErr } = await admin
      .from("sync_staging")
      .select("*")
      .eq("status", "pending")
      .order("created_at")
      .order("id")
      .range(from, from + PAGE_SIZE - 1)
    if (fetchErr) return { ok: false, error: fetchErr.message }
    if (!chunk || chunk.length === 0) break
    pendingEntries.push(...chunk)
    if (chunk.length < PAGE_SIZE) break
  }

  if (pendingEntries.length === 0) {
    return { ok: true, message: "No pending entries to approve." }
  }

  // Same DO NOTHING semantics as approveStagedEntry — see the note there.
  // Batched so one oversized payload cannot fail the whole approval.
  const BATCH_SIZE = 500
  let publishedCount = 0
  const processedIds: string[] = []
  for (let i = 0; i < pendingEntries.length; i += BATCH_SIZE) {
    const batch = pendingEntries.slice(i, i + BATCH_SIZE)
    const { data: published, error: upsertErr } = await admin
      .from("content_entries")
      .upsert(batch.map(toContentRow), { onConflict: "slug", ignoreDuplicates: true })
      .select("slug")

    if (upsertErr) {
      // Keep the batches that landed out of the queue: leaving them pending
      // invites approving the same rows twice.
      const markErr = await markApproved(admin, processedIds)
      revalidatePath("/admin/sync")
      return {
        ok: false,
        error: `Publishing failed after ${publishedCount} entr${publishedCount === 1 ? "y" : "ies"}: ${upsertErr.message}${
          markErr ? ` (those rows could not be marked approved either: ${markErr})` : " — those rows were marked approved."
        }`,
      }
    }

    publishedCount += published?.length ?? 0
    processedIds.push(...batch.map((e) => e.id))
  }

  const statusErr = await markApproved(admin, processedIds)
  if (statusErr) {
    return {
      ok: false,
      error: `Published ${publishedCount} entries, but marking them approved failed: ${statusErr}. Run Approve All again to finish.`,
    }
  }

  const skippedCount = pendingEntries.length - publishedCount

  revalidatePath("/admin/sync")
  revalidatePath("/admin/content")
  revalidatePath("/tracker")
  return {
    ok: true,
    message:
      skippedCount > 0
        ? `Published ${publishedCount} entries. ${skippedCount} already existed and were left untouched.`
        : `Approved and published ${publishedCount} entries.`,
  }
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
