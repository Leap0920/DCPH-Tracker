import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { createClient } from "@/utils/supabase/server"
import { createAdminClient } from "@/utils/supabase/admin"
import { handleApiError } from "@/lib/api-utils"
import {
  getAllEpisodes,
  getAnimeFull,
  DETECTIVE_CONAN_MAL_ID,
} from "@/lib/jikan"
import {
  getFranchiseEntries as kitsuGetFranchise,
  DETECTIVE_CONAN_KITSU_ID,
} from "@/lib/kitsu"
import { getNextAiringEpisode } from "@/lib/anilist"
import { pickImageUrl, resolveDcwImagesBatch } from "@/lib/dcw-images"
import type { Database } from "@/types/database.types"
import { rateLimit, authRateLimitKey } from "@/lib/rate-limit"
import { rateLimitPersistent } from "@/lib/rate-limit-db"
import { isSameOrigin } from "@/lib/origin-check"
import { defaultRuntimeMinutes, isPlausibleRuntime } from "@/lib/runtime-defaults"

export const maxDuration = 60

type ContentInsert = Database["public"]["Tables"]["content_entries"]["Insert"]

/** Either the cookie-bound server client or the service-role admin client. */
type SyncClient = Awaited<ReturnType<typeof createClient>>

/**
 * Constant-time comparison of `Authorization: Bearer <secret>` against the
 * configured CRON_SECRET. Never accepts the secret via query string — that
 * would leak it into Vercel/access logs.
 */
function headerMatchesSecret(
  authorization: string | null,
  secret: string | undefined
): boolean {
  if (!secret || !authorization) return false
  // Compare fixed-width digests so the secret's length never leaks.
  const a = crypto.createHash("sha256").update(authorization).digest()
  const b = crypto.createHash("sha256").update(`Bearer ${secret}`).digest()
  return crypto.timingSafeEqual(a, b)
}

interface SyncResult {
  type: "episodes" | "franchise" | "airing"
  totalFetched: number
  inserted: number
  skipped: number
  errors: string[]
  note?: string
}

/**
 * POST /api/sync
 * Syncs Detective Conan content into Supabase content_entries.
 *
 * Data sources (see sync design):
 *   - Jikan   = complete EPISODE source (Kitsu lacks metadata for recent DC eps)
 *   - Kitsu   = complete MOVIES / SPECIALS / OVAs source (good artwork)
 *   - AniList = airing cache: tells us the next/new episode number
 *
 * Query params:
 *   - dry_run=true            → fetch data but don't write to DB
 *   - limit=N                 → only sync first N items (testing)
 *   - mode=seed|airing|all    → seed = full pull; airing = AniList-triggered
 *
 * Cron: set CRON_SECRET and call with `Authorization: Bearer <CRON_SECRET>`
 * (Vercel Cron injects this header automatically when CRON_SECRET is set).
 * The secret is NEVER accepted via query string — that leaks into logs.
 */
export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const dryRun = searchParams.get("dry_run") === "true"
  const limitParam = searchParams.get("limit")
  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : NaN
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 5000) : undefined
  const mode = searchParams.get("mode") || "all"

  try {
    if (!isSameOrigin(request)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const rl = await rateLimitPersistent(`sync:post:${authRateLimitKey(request)}`, {
      limit: 2,
      windowMs: 60_000,
      failClosed: true,
    })
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const supabase = await createClient()

    // 0. Authorize: cron secret (header-only, timing-safe) OR admin user session.
    const cronSecret = process.env.CRON_SECRET
    const isCron = headerMatchesSecret(request.headers.get("authorization"), cronSecret)

    if (!isCron) {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .single()
      if (profile?.role !== "admin") {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 })
      }
    }

    // Writes need to satisfy the admin-only RLS policy on content_entries.
    // A logged-in admin session already does; a cron run does NOT (no user
    // context), so it must use the service-role client which bypasses RLS.
    let writeClient: SyncClient = supabase
    if (isCron) {
      const admin = createAdminClient()
      if (!admin) {
        return NextResponse.json(
          { error: "SUPABASE_SERVICE_ROLE_KEY is not configured; cron sync cannot write." },
          { status: 500 }
        )
      }
      writeClient = admin as unknown as SyncClient
    }

    // ── Airing mode: AniList detects new episode → Jikan pulls its detail ──
    if (mode === "airing") {
      const result = await syncAiring(writeClient, dryRun)
      return NextResponse.json({ mode: "airing", results: [result] })
    }

    // ── Seed mode (default): episodes (Jikan) + franchise (Kitsu) ──
    const episodeResult = await syncSeedEpisodes(writeClient, limit, dryRun)
    const franchiseResult = await syncSeedFranchise(writeClient, limit, dryRun)

    return NextResponse.json({
      mode: "seed",
      results: [episodeResult, franchiseResult],
    })
  } catch (error) {
    return handleApiError(error, "sync")
  }
}

// ─── Slug helper (stable across APIs; matches supabase/seed.sql) ──

function kitsuContentSlug(type: "movie" | "special" | "ova", idx: number): string {
  const prefix = type === "movie" ? "mov" : type === "special" ? "sp" : "ova"
  return `${prefix}-${String(idx).padStart(2, "0")}`
}

// ─── Shared staging helper (Approval Queue + Duplicate Protection) ───

async function stageBatch(
  supabase: SyncClient,
  rows: ContentInsert[],
  source: "jikan" | "kitsu" | "anilist"
): Promise<{ totalFetched: number; inserted: number; skipped: number; errors: string[] }> {
  let staged = 0
  let skipped = 0
  const errors: string[] = []

  // 1. Fetch all existing slugs, episode numbers, and movie numbers from
  //    content_entries. PostgREST caps each request at 1,000 rows, so paginate
  //    to avoid a truncated dedup set once the DB has 1,000+ episodes (Full
  //    Seed used to re-stage episodes 1001+ because only the first page was read).
  const existingSlugs = new Set<string>()
  const existingEpNums = new Set<number>()
  const existingMovNums = new Set<number>()

  const PAGE_SIZE = 1000
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: chunk } = await supabase
      .from("content_entries")
      .select("slug, type, episode_number, movie_number")
      .range(from, from + PAGE_SIZE - 1)
    if (!chunk || chunk.length === 0) break
    for (const c of chunk) {
      if (c.slug) existingSlugs.add(c.slug)
      if (c.type === "episode" && c.episode_number != null) existingEpNums.add(c.episode_number)
      if (c.type === "movie" && c.movie_number != null) existingMovNums.add(c.movie_number)
    }
    if (chunk.length < PAGE_SIZE) break
  }

  // 2. Fetch existing slugs in sync_staging (if table exists)
  try {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: chunk } = await supabase
        .from("sync_staging")
        .select("slug")
        .range(from, from + PAGE_SIZE - 1)
      if (!chunk || chunk.length === 0) break
      for (const s of chunk) {
        if (s.slug) existingSlugs.add(s.slug)
      }
      if (chunk.length < PAGE_SIZE) break
    }
  } catch {
    // Ignore if table not yet migrated
  }

  // 3. Filter rows: only stage entries that do NOT exist in content_entries or sync_staging
  const newRows: any[] = []
  for (const r of rows) {
    if (existingSlugs.has(r.slug)) {
      skipped++
      continue
    }
    if (r.type === "episode" && r.episode_number != null && existingEpNums.has(r.episode_number)) {
      skipped++
      continue
    }
    if (r.type === "movie" && r.movie_number != null && existingMovNums.has(r.movie_number)) {
      skipped++
      continue
    }

    newRows.push({
      source,
      slug: r.slug,
      title: r.title,
      type: r.type,
      episode_number: r.episode_number ?? null,
      movie_number: r.movie_number ?? null,
      air_date: r.air_date ?? null,
      canon_order: r.canon_order ?? 0,
      synopsis: r.synopsis ?? null,
      image_url: r.image_url ?? null,
      runtime_minutes: r.runtime_minutes ?? null,
      status: "pending",
    })
  }

  if (newRows.length === 0) {
    return { totalFetched: rows.length, inserted: 0, skipped: rows.length, errors: [] }
  }

  // 4. Insert new rows into sync_staging for Admin Review
  const BATCH_SIZE = 50
  for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
    const batch = newRows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.from("sync_staging").insert(batch)
    if (error) {
      errors.push(`Staging batch error: ${error.message}`)
    } else {
      staged += batch.length
    }
  }

  return { totalFetched: rows.length, inserted: staged, skipped, errors }
}

type SyncRow = ContentInsert & { dcw_title?: string | null; image_source?: string | null };

async function enrichRowsWithDcwImages<T extends SyncRow>(rows: T[]): Promise<T[]> {
  if (!rows.length) return rows;
  try {
    const resolutions = await resolveDcwImagesBatch(
      rows.map((row, index) => ({
        id: String(index),
        title: row.title,
        aliases: [],
        contentType: row.type,
      })),
    );
    const byIndex = new Map(resolutions.map((r) => [r.id, r]));
    return rows.map((row, index) => {
      const resolution = byIndex.get(String(index));
      const picked = pickImageUrl(resolution?.image?.url ?? null, row.image_url);
      return {
        ...row,
        image_url: picked.url,
        image_source: picked.source,
        dcw_title: resolution?.dcwTitle ?? null,
      };
    });
  } catch (error) {
    console.error("[sync] DCW image enrichment failed, keeping upstream images", error);
    return rows;
  }
}

// ─── Seed: episodes from Jikan (complete for DC) ────────────────

async function syncSeedEpisodes(
  supabase: SyncClient,
  limit: number | undefined,
  dryRun: boolean
): Promise<SyncResult> {
  const animeFull = await getAnimeFull(DETECTIVE_CONAN_MAL_ID)
  const seriesImageUrl =
    animeFull.data.images?.jpg?.large_image_url ??
    animeFull.data.images?.jpg?.image_url ??
    ""

  let episodes = await getAllEpisodes(DETECTIVE_CONAN_MAL_ID)
  if (limit) episodes = episodes.slice(0, limit)

  const rows: ContentInsert[] = episodes.map((ep) => {
    const airDate = ep.aired
      ? new Date(ep.aired).toISOString().split("T")[0]
      : "1996-01-08"
    return {
      slug: `ep-${String(ep.mal_id).padStart(3, "0")}`,
      title: ep.title,
      type: "episode",
      episode_number: ep.mal_id,
      movie_number: null,
      air_date: airDate,
      canon_order: ep.mal_id,
      arc_id: null,
      synopsis: null,
      image_url: seriesImageUrl,
      // Not NULL: the admin reviewing this staged row should see the runtime it
      // will publish with, and analytics SUMs the column downstream.
      runtime_minutes: defaultRuntimeMinutes("episode"),
    }
  })

  if (dryRun) {
    return {
      type: "episodes",
      totalFetched: rows.length,
      inserted: rows.length,
      skipped: 0,
      errors: [],
    }
  }

  const enriched = await enrichRowsWithDcwImages(rows as SyncRow[]);
  const { inserted, skipped, errors } = await stageBatch(supabase, enriched as ContentInsert[], "jikan")
  return {
    type: "episodes",
    totalFetched: rows.length,
    inserted,
    skipped,
    errors,
    note: inserted > 0 ? `${inserted} new episodes queued for Admin Approval in /admin/sync` : "All episodes already up to date.",
  }
}

// ─── Seed: franchise (movies / specials / OVAs) from Kitsu ──────

/**
 * Normalizes a title for dedup/reuse lookups. Kitsu's text search returns the
 * same film twice (JP + EN editions, identical canonicalTitle); two entries
 * sharing a normalized title are treated as one film.
 */
function normalizeTitleForDedup(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim()
}

async function syncSeedFranchise(
  supabase: SyncClient,
  limit: number | undefined,
  dryRun: boolean
): Promise<SyncResult> {
  const franchise = await kitsuGetFranchise()
  const rows: ContentInsert[] = []

  const groups: { subtype: string; ctype: "movie" | "special" | "ova"; base: number }[] = [
    { subtype: "movie", ctype: "movie", base: 1000 },
    { subtype: "special", ctype: "special", base: 2000 },
    { subtype: "OVA", ctype: "ova", base: 3000 },
    { subtype: "ONA", ctype: "ova", base: 3000 },
  ]

  // Existing franchise rows → slug/movie_number/canon_order reuse keyed by
  // `type|normalizedTitle`, so re-seeds update in place instead of creating
  // duplicates or shifting slugs (keeps OTHER_MOVIE_SLUGS in movies-guide.ts
  // stable). Falls back to fresh rows when the table is empty.
  let existing: {
    slug: string
    title: string
    type: string
    movie_number: number | null
    canon_order: number | null
  }[] = []
  if (!dryRun) {
    // PostgREST caps each request at 1,000 rows, so paginate to avoid a
    // truncated slug-reuse map once the DB has 1,000+ franchise rows.
    const PAGE_SIZE = 1000
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: chunk } = await supabase
        .from("content_entries")
        .select("slug, title, type, movie_number, canon_order")
        .in("type", ["movie", "special", "ova"])
        .range(from, from + PAGE_SIZE - 1)
      if (!chunk || chunk.length === 0) break
      existing.push(...(chunk as typeof existing))
      if (chunk.length < PAGE_SIZE) break
    }
  }
  const slugByKey = new Map<string, string>()
  const movieNumberBySlug = new Map<string, number | null>()
  const canonOrderBySlug = new Map<string, number | null>()
  const usedSlugs = new Set<string>()
  for (const row of existing) {
    const key = `${row.type}|${normalizeTitleForDedup(row.title)}`
    if (!slugByKey.has(key)) slugByKey.set(key, row.slug)
    usedSlugs.add(row.slug)
    movieNumberBySlug.set(row.slug, row.movie_number ?? null)
    canonOrderBySlug.set(row.slug, row.canon_order ?? null)
  }

  for (const g of groups) {
    // 1. Dedup the Kitsu list by normalized title BEFORE assigning slugs, so
    //    duplicate franchise entries (JP + EN editions) collapse into one row.
    const seenTitles = new Set<string>()
    const entries = franchise
      .filter((a) => a.attributes.subtype === g.subtype)
      .sort((a, b) =>
        (a.attributes.startDate ?? "").localeCompare(b.attributes.startDate ?? "")
      )
      .filter((a) => {
        const title =
          a.attributes.canonicalTitle ??
          a.attributes.titles?.en_us ??
          a.attributes.titles?.en ??
          ""
        const key = normalizeTitleForDedup(title)
        if (seenTitles.has(key)) return false
        seenTitles.add(key)
        return true
      })

    const limited = limit ? entries.slice(0, limit) : entries

    // 2. Allocate slugs: reuse an existing slug for a known title; otherwise
    //    use the lowest free numeric slug for this type (no duplicates, no
    //    shifting of already-referenced slugs).
    let nextFree = 1
    const allocateSlug = (): string => {
      let candidate = kitsuContentSlug(g.ctype, nextFree)
      while (usedSlugs.has(candidate)) {
        nextFree += 1
        candidate = kitsuContentSlug(g.ctype, nextFree)
      }
      nextFree += 1
      usedSlugs.add(candidate)
      return candidate
    }

    limited.forEach((a) => {
      const title =
        a.attributes.canonicalTitle ??
        a.attributes.titles?.en_us ??
        a.attributes.titles?.en ??
        `Entry ${nextFree}`
      const titleKey = normalizeTitleForDedup(title)
      const reusedSlug = slugByKey.get(`${g.ctype}|${titleKey}`)

      const slug = reusedSlug ?? allocateSlug()
      const slugNum = Number(slug.split("-")[1]) || 1
      const movie_number =
        g.ctype === "movie" ? movieNumberBySlug.get(slug) ?? null : null
      const canon_order = canonOrderBySlug.get(slug) ?? g.base + slugNum

      rows.push({
        slug,
        title,
        type: g.ctype,
        episode_number: null,
        movie_number,
        air_date: a.attributes.startDate ?? "2000-01-01",
        canon_order,
        arc_id: null,
        synopsis: a.attributes.synopsis ?? null,
        image_url: a.attributes.posterImage?.original ?? "",
        runtime_minutes: isPlausibleRuntime(a.attributes.episodeLength)
          ? a.attributes.episodeLength
          : defaultRuntimeMinutes(g.ctype),
      })
    })
  }

  if (dryRun) {
    return {
      type: "franchise",
      totalFetched: rows.length,
      inserted: rows.length,
      skipped: 0,
      errors: [],
      note: "dry run — no DB read for slug reuse",
    }
  }

  const enrichedFranchise = await enrichRowsWithDcwImages(rows as SyncRow[]);
  const { inserted, skipped, errors } = await stageBatch(supabase, enrichedFranchise as ContentInsert[], "kitsu")
  return {
    type: "franchise",
    totalFetched: rows.length,
    inserted,
    skipped,
    errors,
    note: inserted > 0 ? `${inserted} new franchise items queued for Admin Approval in /admin/sync` : "All franchise items already up to date.",
  }
}

// ─── Airing mode: AniList detects new episode → Jikan tail re-sync ─

async function syncAiring(
  supabase: SyncClient,
  dryRun: boolean
): Promise<SyncResult> {
  // Current max episode we have. PostgREST caps each request at 1,000 rows,
  // so paginate to avoid a truncated dbMax once DC has 1,000+ episodes.
  const PAGE_SIZE = 1000
  const nums: number[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: chunk, error: chunkErr } = await supabase
      .from("content_entries")
      .select("episode_number")
      .eq("type", "episode")
      .range(from, from + PAGE_SIZE - 1)
    if (chunkErr) throw chunkErr
    if (!chunk || chunk.length === 0) break
    for (const d of chunk) {
      if (typeof d.episode_number === "number") nums.push(d.episode_number)
    }
    if (chunk.length < PAGE_SIZE) break
  }
  let dbMax = 0
  for (const n of nums) if (n > dbMax) dbMax = n

  // AniList: next scheduled episode; everything before it has aired.
  let latestAired = Number.MAX_SAFE_INTEGER
  let anilistNote = ""
  try {
    const next = await getNextAiringEpisode()
    if (next) {
      latestAired = next.episode - 1
      anilistNote = `AniList next airing: ep ${next.episode}`
    } else {
      anilistNote = "AniList: no future airing scheduled (off-season)"
    }
  } catch (err) {
    anilistNote = `AniList error (${(err as Error).message})`
  }

  if (latestAired <= dbMax) {
    return {
      type: "airing",
      totalFetched: 0,
      inserted: 0,
      skipped: 0,
      errors: [],
      note: `Up to date (db max ep ${dbMax}). ${anilistNote}`,
    }
  }

  // Pull the most recent Jikan episodes (new ones live at the tail).
  const all = await getAllEpisodes(DETECTIVE_CONAN_MAL_ID)
  const newEps = all.filter((ep) => ep.mal_id > dbMax).slice(0, 10)

  const animeFull = await getAnimeFull(DETECTIVE_CONAN_MAL_ID)
  const seriesImageUrl =
    animeFull.data.images?.jpg?.large_image_url ??
    animeFull.data.images?.jpg?.image_url ??
    ""

  const rows: ContentInsert[] = newEps.map((ep) => {
    const airDate = ep.aired
      ? new Date(ep.aired).toISOString().split("T")[0]
      : "1996-01-08"
    return {
      slug: `ep-${String(ep.mal_id).padStart(3, "0")}`,
      title: ep.title,
      type: "episode",
      episode_number: ep.mal_id,
      movie_number: null,
      air_date: airDate,
      canon_order: ep.mal_id,
      arc_id: null,
      synopsis: null,
      image_url: seriesImageUrl,
      // Not NULL: analytics SUMs runtime downstream; see lib/runtime-defaults.
      runtime_minutes: defaultRuntimeMinutes("episode"),
    }
  })

  if (dryRun) {
    return {
      type: "airing",
      totalFetched: rows.length,
      inserted: rows.length,
      skipped: 0,
      errors: [],
      note: anilistNote,
    }
  }

  const enrichedAiring = await enrichRowsWithDcwImages(rows as SyncRow[]);
  const { inserted, skipped, errors } = await stageBatch(supabase, enrichedAiring as ContentInsert[], "anilist")
  return {
    type: "airing",
    totalFetched: rows.length,
    inserted,
    skipped,
    errors,
    note: inserted > 0 ? `${anilistNote} ${inserted} new airing episode(s) queued for Admin Approval in /admin/sync.` : `${anilistNote} No new airing episodes to queue.`,
  }
}

/**
 * GET /api/sync
 * Returns current sync status (how many entries exist by type)
 */
export async function GET() {
  try {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .single()
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })
    }

    const [episodesCount, moviesCount, specialsCount, ovasCount] = await Promise.all([
      supabase.from("content_entries").select("*", { count: "exact", head: true }).eq("type", "episode"),
      supabase.from("content_entries").select("*", { count: "exact", head: true }).eq("type", "movie"),
      supabase.from("content_entries").select("*", { count: "exact", head: true }).eq("type", "special"),
      supabase.from("content_entries").select("*", { count: "exact", head: true }).eq("type", "ova"),
    ])

    return NextResponse.json({
      episodes: episodesCount.count ?? 0,
      movies: moviesCount.count ?? 0,
      specials: specialsCount.count ?? 0,
      ovas: ovasCount.count ?? 0,
      total:
        (episodesCount.count ?? 0) +
        (moviesCount.count ?? 0) +
        (specialsCount.count ?? 0) +
        (ovasCount.count ?? 0),
      message: "POST to sync. mode=seed|airing.",
    })
  } catch (error) {
    return handleApiError(error, "sync")
  }
}
