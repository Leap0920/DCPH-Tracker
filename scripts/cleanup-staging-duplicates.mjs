import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const srvKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !srvKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(url, srvKey)

// PostgREST caps responses at 1000 rows. Loop with .range() until an empty
// chunk OR a short chunk signals the end (same pattern as syncAiring()).
const PAGE_SIZE = 1000

async function readAllRows(table, select) {
  const rows = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: chunk, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!chunk || chunk.length === 0) break
    rows.push(...chunk)
    if (chunk.length < PAGE_SIZE) break
  }
  return rows
}

function statusCounts(rows) {
  const counts = {}
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1
  return counts
}

async function deleteByIds(ids, label) {
  let deleted = 0
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const { error } = await supabase.from("sync_staging").delete().in("id", chunk)
    if (error) throw new Error(`Delete failed (${label}, chunk ${i}): ${error.message}`)
    deleted += chunk.length
  }
  return deleted
}

async function cleanupStagingDuplicates() {
  console.log("=== SYNC STAGING DUPLICATE CLEANUP (one-time) ===")

  // (a) All content_entries slugs, paginated
  const contentEntries = await readAllRows("content_entries", "slug")
  const contentSlugs = new Set(contentEntries.map((e) => e.slug))
  console.log(`content_entries rows read (paginated): ${contentEntries.length}`)

  // (b) All sync_staging rows, paginated (id needed for targeted deletes)
  const stagingRows = await readAllRows("sync_staging", "id, slug, created_at, status")
  console.log(`sync_staging rows read (paginated): ${stagingRows.length}`)

  const before = statusCounts(stagingRows)
  console.log(
    `staging status counts BEFORE: pending=${before.pending} approved=${before.approved} rejected=${before.rejected}`
  )

  const pending = stagingRows.filter((r) => r.status === "pending")

  // (c) Pending rows whose slug already exists in content_entries -> delete
  const dupesOfContent = pending.filter((r) => contentSlugs.has(r.slug))
  const remaining = pending.filter((r) => !contentSlugs.has(r.slug))

  // (d) Duplicate pending slugs among the remainder -> keep OLDEST created_at
  const bySlug = new Map()
  for (const r of remaining) {
    if (!bySlug.has(r.slug)) bySlug.set(r.slug, [])
    bySlug.get(r.slug).push(r)
  }
  const dupSlugRows = []
  for (const rows of bySlug.values()) {
    if (rows.length > 1) {
      rows.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      dupSlugRows.push(...rows.slice(1))
    }
  }

  const dupesOfContentIds = dupesOfContent.map((r) => r.id)
  const dupSlugIds = dupSlugRows.map((r) => r.id)

  // --- Dry-run style preview (auditable log) ---
  console.log("\n--- DRY-RUN PREVIEW (nothing deleted yet) ---")
  console.log(`[c] pending rows whose slug exists in content_entries: ${dupesOfContentIds.length}`)
  console.log(`    example slugs: ${dupesOfContent.slice(0, 5).map((r) => r.slug).join(", ") || "none"}`)
  console.log(`[d] duplicate pending slugs (keeping OLDEST created_at): ${dupSlugIds.length}`)
  console.log(`    example slugs: ${dupSlugRows.slice(0, 5).map((r) => r.slug).join(", ") || "none"}`)
  console.log(`    TOTAL rows to delete: ${dupesOfContentIds.length + dupSlugIds.length}`)
  console.log("(approved/rejected rows are NEVER touched)")

  // --- Perform the deletes (same run) ---
  const deletedDupesOfContent = await deleteByIds(dupesOfContentIds, "dupes-of-content")
  const deletedDupSlugs = await deleteByIds(dupSlugIds, "dup-slugs")

  // Re-read to confirm post-condition + remaining_pending
  const afterRows = await readAllRows("sync_staging", "id, slug, created_at, status")
  const after = statusCounts(afterRows)
  const afterPending = afterRows.filter((r) => r.status === "pending")
  const remainingDupesOfContent = afterPending.filter((r) => contentSlugs.has(r.slug)).length
  const afterBySlug = new Map()
  for (const r of afterPending) {
    if (!afterBySlug.has(r.slug)) afterBySlug.set(r.slug, 0)
    afterBySlug.set(r.slug, afterBySlug.get(r.slug) + 1)
  }
  const remainingDupSlugs = [...afterBySlug.values()].filter((n) => n > 1).length

  console.log("\n=== CLEANUP SUMMARY ===")
  console.log(`deleted_dupes_of_content: ${deletedDupesOfContent}`)
  console.log(`deleted_dup_slugs: ${deletedDupSlugs}`)
  console.log(`remaining_pending: ${after.pending ?? 0}`)
  console.log(
    `staging status counts AFTER: pending=${after.pending} approved=${after.approved} rejected=${after.rejected}`
  )
  console.log(
    `POST-CONDITION CHECK: pending-with-slug-in-content_entries=${remainingDupesOfContent} duplicate-pending-slugs=${remainingDupSlugs}`
  )

  if (after.approved !== before.approved || after.rejected !== before.rejected) {
    throw new Error("SAFETY VIOLATION: approved/rejected row counts changed - aborting report")
  }
  if (remainingDupesOfContent !== 0 || remainingDupSlugs !== 0) {
    throw new Error("POST-CONDITION FAILED: duplicates remain after cleanup")
  }

  console.log("\nCleanup completed successfully.")
}

cleanupStagingDuplicates().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
