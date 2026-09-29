import { NextRequest, NextResponse } from "next/server"
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
import {
  fetchDcwMovieItems,
  fetchDcwOvaItems,
  fetchDcwSeasonItems,
  fetchDcwSpecialItems,
  filterDcwItemsByYear,
} from "@/lib/dcw-content"
import { pickImageUrl, resolveDcwImagesBatch } from "@/lib/dcw-images"
import type { Database } from "@/types/database.types"
import { rateLimit, authRateLimitKey } from "@/lib/rate-limit"
import { rateLimitPersistent } from "@/lib/rate-limit-db"
import { isSameOrigin } from "@/lib/origin-check"
import { secretMatches } from "@/lib/secret-compare"
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
  if (!secret) return false
  return secretMatches(authorization, `Bearer ${secret}`)
}

interface SyncResult {
  type: "episodes" | "franchise" | "airing" | "dcw"
  totalFetched: number
  inserted: number
  skipped: number
  errors: string[]
  note?: string
}

/**
 * Run one sync source in isolation. A source that throws becomes a result
 * carrying the failure, so the remaining sources still run and the admin panel
 * can name the upstream that broke — previously a single failing source
 * aborted the whole request before the healthy ones ran, and every failure
 * surfaced as a bare "Internal server error".
 */
async function runSource(
  type: SyncResult["type"],
  run: () => Promise<SyncResult>
): Promise<SyncResult> {
  try {
    return await run()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[sync] source failed", { source: type, message })
    return {
      type,
      totalFetched: 0,
      inserted: 0,
      skipped: 0,
      errors: [message],
      note: `failed: ${message}`,
    }
  }
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
 *   - mode=seed|airing|dcw|latest → seed = full pull (episodes + franchise +
 *                               current-year wiki content); latest = the fast
 *                               pair the admin panel runs (airing + wiki);
 *                               airing = AniList-triggered episode pull;
 *                               dcw = wiki content for the current year only
 *
 * Cron: set CRON_SECRET and call with `Authorization: Bearer <CRON_SECRET>`
 * (Vercel Cron injects this header automatically when CRON_SECRET is set).
 * The secret is NEVER accepted via query string — that leaks into logs.
 */
export async function POST(request: NextRequest) {
  return runSync(request)
}

async function runSync(request: NextRequest) {
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
      const result = await runSource("airing", () => syncAiring(writeClient, dryRun))
      return NextResponse.json({ mode: "airing", results: [result] })
    }

    // ── Latest mode: what the admin panel runs — AniList airing check plus
    //    the wiki's current-year content (episodes, movies, specials, OVAs) ──
    if (mode === "latest") {
      const results = [
        await runSource("airing", () => syncAiring(writeClient, dryRun)),
        await runSource("dcw", () => syncDcwContent(writeClient, dryRun)),
      ]
      return NextResponse.json({ mode: "latest", results })
    }

    // ── DCW mode: wiki content for the current year only ──
    if (mode === "dcw") {
      const result = await runSource("dcw", () => syncDcwContent(writeClient, dryRun))
      return NextResponse.json({ mode: "dcw", results: [result] })
    }

    // ── Seed mode (default): episodes (Jikan) + franchise (Kitsu) + wiki ──
    // Sequential so the sources don't fight over the same upstream rate limits,
    // but isolated: an upstream outage in one no longer aborts the others.
    const results = [
      await runSource("episodes", () => syncSeedEpisodes(writeClient, limit, dryRun)),
      await runSource("franchise", () => syncSeedFranchise(writeClient, limit, dryRun)),
      await runSource("dcw", () => syncDcwContent(writeClient, dryRun)),
    ]

    return NextResponse.json({ mode: "seed", results })
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
  source: "jikan" | "kitsu" | "anilist" | "dcw"
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
      .order("slug")
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
        .order("slug")
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

type SyncRow = ContentInsert & { dcw_title?: string | null; image_source?: string | null }

/**
 * Slugs already queued for review. A pending row owns its slug just as much as a
 * published one: two sources in the same run both start allocating at `-01`, so
 * without this the second item to claim a number is dropped by stageBatch's
 * dedup and silently never reaches the review queue.
 */
async function readStagingSlugs(supabase: SyncClient): Promise<Set<string>> {
  const slugs = new Set<string>()
  const PAGE_SIZE = 1000
  try {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: chunk } = await supabase
        .from("sync_staging")
        .select("slug")
        .order("slug")
        .range(from, from + PAGE_SIZE - 1)
      if (!chunk || chunk.length === 0) break
      for (const row of chunk) {
        if (row.slug) slugs.add(row.slug)
      }
      if (chunk.length < PAGE_SIZE) break
    }
  } catch {
    // Table not migrated yet — nothing to avoid.
  }
  return slugs
}

/**
 * What the catalog already knows about episode numbering.
 *
 * `canon_order` is deliberately not the episode number: films and TV specials are
 * interleaved into the run, so the tail carries an offset (episode 1209 sits at
 * 1321). A new episode numbered with its own episode number would sort *before*
 * the episodes preceding it in every story-order view, so new rows continue the
 * offset the catalog is already using.
 */
async function readEpisodeNumbering(supabase: SyncClient): Promise<{
  slugs: Set<string>
  numbers: Set<number>
  maxEpisodeNumber: number
  maxCanonOrder: number
}> {
  const slugs = new Set<string>()
  const numbers = new Set<number>()
  let maxEpisodeNumber = 0
  let maxCanonOrder = 0
  const PAGE_SIZE = 1000
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: chunk, error } = await supabase
      .from("content_entries")
      .select("slug, episode_number, canon_order")
      .eq("type", "episode")
      .order("slug")
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!chunk || chunk.length === 0) break
    for (const row of chunk) {
      if (row.slug) slugs.add(row.slug)
      if (row.episode_number != null) {
        numbers.add(row.episode_number)
        if (row.episode_number > maxEpisodeNumber) maxEpisodeNumber = row.episode_number
      }
      if (row.canon_order != null && row.canon_order > maxCanonOrder) {
        maxCanonOrder = row.canon_order
      }
    }
    if (chunk.length < PAGE_SIZE) break
  }
  return { slugs, numbers, maxEpisodeNumber, maxCanonOrder }
}

/** Story-order offset new episodes must continue (see readEpisodeNumbering). */
function episodeCanonOffset(maxCanonOrder: number, maxEpisodeNumber: number): number {
  return Math.max(0, maxCanonOrder - maxEpisodeNumber)
}

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

  // An episode with no air date is left out rather than dated with the series
  // premiere: a fabricated 1996-01-08 files an unaired episode under 1996 in the
  // year view and invents history the source does not claim.
  const dated = episodes.filter((ep) => ep.aired)

  const numbering = dryRun ? null : await readEpisodeNumbering(supabase)
  const canonOffset = numbering
    ? episodeCanonOffset(numbering.maxCanonOrder, numbering.maxEpisodeNumber)
    : 0

  const rows: ContentInsert[] = dated.map((ep) => {
    const airDate = new Date(ep.aired as string).toISOString().split("T")[0]
    return {
      slug: `ep-${String(ep.mal_id).padStart(3, "0")}`,
      title: ep.title,
      type: "episode",
      episode_number: ep.mal_id,
      movie_number: null,
      air_date: airDate,
      canon_order: ep.mal_id + canonOffset,
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

  // Drop rows the catalog already has before enrichment: a re-seed otherwise
  // re-resolves wiki images for ~1,200 unchanged episodes, which can push the
  // run past the 60s budget to stage rows stageBatch would discard anyway. Rows
  // already waiting for review count as present — slug and episode number share
  // the same `ep-NNN` numbering, so the slug set covers both.
  const stagingSlugs = await readStagingSlugs(supabase)
  const pending = rows.filter(
    (row) =>
      !numbering!.numbers.has(row.episode_number as number) &&
      !numbering!.slugs.has(row.slug) &&
      !stagingSlugs.has(row.slug)
  )
  const alreadyPresent = rows.length - pending.length

  const enriched = await enrichRowsWithDcwImages(pending as SyncRow[]);
  const { inserted, skipped, errors } = await stageBatch(supabase, enriched as ContentInsert[], "jikan")
  const undatedNote =
    episodes.length > dated.length
      ? ` ${episodes.length - dated.length} episode(s) skipped for having no air date.`
      : ""
  const failedNote = errors.length > 0 ? ` ${errors.length} staging error(s): ${errors.join(" | ")}` : ""
  return {
    type: "episodes",
    totalFetched: rows.length,
    inserted,
    skipped: skipped + alreadyPresent,
    errors,
    note:
      inserted > 0
        ? `${inserted} new episodes queued for Admin Approval in /admin/sync.${undatedNote}${failedNote}`
        : `All episodes already up to date.${undatedNote}${failedNote}`,
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
  let undatedCount = 0

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
        .order("slug")
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
  if (!dryRun) {
    // A row still awaiting review in the DCW path already owns its slug.
    for (const slug of await readStagingSlugs(supabase)) usedSlugs.add(slug)
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

      // content_entries.air_date is NOT NULL and a fabricated 2000-01-01 would
      // file the entry under year 2000. Kitsu dates the films and specials it
      // lists, so an undated entry is an upstream gap we report, not one we paper
      // over with a date the source never claimed.
      const startDate = a.attributes.startDate
      if (!startDate) {
        undatedCount++
        return
      }

      const slug = reusedSlug ?? allocateSlug()
      const slugNum = Number(slug.split("-")[1]) || 1
      // A newly allocated film takes its number from the slug it just got, and a
      // known film whose number was never stored is repaired on the next seed:
      // movie_number is the key the DCW path dedups films on, so leaving it null
      // makes the next wiki run stage the same film a second time.
      const movie_number =
        g.ctype === "movie" ? movieNumberBySlug.get(slug) ?? slugNum : null
      const canon_order = canonOrderBySlug.get(slug) ?? g.base + slugNum

      rows.push({
        slug,
        title,
        type: g.ctype,
        episode_number: null,
        movie_number,
        air_date: startDate,
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
  const failedNote = errors.length > 0 ? ` ${errors.length} staging error(s): ${errors.join(" | ")}` : ""
  const undatedNote =
    undatedCount > 0 ? ` ${undatedCount} entr${undatedCount === 1 ? "y" : "ies"} skipped for having no start date.` : ""
  return {
    type: "franchise",
    totalFetched: rows.length,
    inserted,
    skipped,
    errors,
    note:
      inserted > 0
        ? `${inserted} new franchise items queued for Admin Approval in /admin/sync.${undatedNote}${failedNote}`
        : `All franchise items already up to date.${undatedNote}${failedNote}`,
  }
}

// ─── Airing mode: AniList detects new episode → Jikan tail re-sync ─

async function syncAiring(
  supabase: SyncClient,
  dryRun: boolean
): Promise<SyncResult> {
  // Current max episode we have (and the story-order offset the run uses).
  const numbering = await readEpisodeNumbering(supabase)
  const dbMax = numbering.maxEpisodeNumber
  const canonOffset = episodeCanonOffset(numbering.maxCanonOrder, dbMax)

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
  const newEps = all
    .filter((ep) => ep.mal_id > dbMax && ep.aired)
    .slice(0, 10)

  const animeFull = await getAnimeFull(DETECTIVE_CONAN_MAL_ID)
  const seriesImageUrl =
    animeFull.data.images?.jpg?.large_image_url ??
    animeFull.data.images?.jpg?.image_url ??
    ""

  const rows: ContentInsert[] = newEps.map((ep) => {
    const airDate = new Date(ep.aired as string).toISOString().split("T")[0]
    return {
      slug: `ep-${String(ep.mal_id).padStart(3, "0")}`,
      title: ep.title,
      type: "episode",
      episode_number: ep.mal_id,
      movie_number: null,
      air_date: airDate,
      canon_order: ep.mal_id + canonOffset,
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
  const failedNote = errors.length > 0 ? ` ${errors.length} staging error(s): ${errors.join(" | ")}` : ""
  return {
    type: "airing",
    totalFetched: rows.length,
    inserted,
    skipped,
    errors,
    note:
      inserted > 0
        ? `${anilistNote} ${inserted} new airing episode(s) queued for Admin Approval in /admin/sync.${failedNote}`
        : `${anilistNote} No new airing episodes to queue.${failedNote}`,
  }
}

// ─── DCW mode: wiki-listed content for the current year ─────────

/** Fetch one wiki list, recording a failure instead of losing the other lists. */
async function pullDcwList<T>(
  label: string,
  fetchList: () => Promise<T[]>,
  errors: string[]
): Promise<T[]> {
  try {
    return await fetchList()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[sync] DCW list failed", { list: label, message })
    errors.push(`${label}: ${message}`)
    return []
  }
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

/**
 * Narrows a list to the items that carry an air date. The year filter already
 * guarantees one; this keeps that promise in the type so no caller has to invent
 * a placeholder date to satisfy it.
 */
function requireAirDate<T extends { airDate: string | null }>(
  items: T[]
): (T & { airDate: string })[] {
  return items.filter((item): item is T & { airDate: string } => item.airDate !== null)
}

/**
 * Stage everything the wiki lists for the current year that the tracker is
 * missing: episodes, movies, TV specials and OVAs.
 *
 * The wiki is the fastest source for this franchise — it dates an episode the
 * day it airs, and it carried the 9th TV special while AniList, Jikan and Kitsu
 * still ended at the 8th. Only the current year is pulled: older content is the
 * API sources' job, and re-staging it would only add rows to review.
 */
async function syncDcwContent(
  supabase: SyncClient,
  dryRun: boolean
): Promise<SyncResult> {
  const year = new Date().getFullYear()
  const errors: string[] = []

  // Sequential: the wiki is a public service we keep to a handful of requests
  // per run, and lib/dcw.ts spaces those requests out.
  const specials = await pullDcwList("TV specials", fetchDcwSpecialItems, errors)
  const movies = await pullDcwList("Movies", fetchDcwMovieItems, errors)
  const ovas = await pullDcwList("OVAs", fetchDcwOvaItems, errors)
  const episodes = await pullDcwList("Episodes", fetchDcwSeasonItems, errors)

  const yearEpisodes = filterDcwItemsByYear(episodes, year)
  // Rebroadcasts are dated by their rebroadcast, so a current-year remaster of a
  // 2010 episode must never be staged as a new episode.
  const newEpisodes = requireAirDate(yearEpisodes.filter((episode) => !episode.remastered))
  const yearSpecials = requireAirDate(filterDcwItemsByYear(specials, year))
  const yearMovies = requireAirDate(filterDcwItemsByYear(movies, year))
  const yearOvas = requireAirDate(filterDcwItemsByYear(ovas, year))

  const listed =
    newEpisodes.length + yearSpecials.length + yearMovies.length + yearOvas.length
  const breakdown = [
    countLabel(newEpisodes.length, "episode"),
    countLabel(yearMovies.length, "movie"),
    countLabel(yearSpecials.length, "special"),
    countLabel(yearOvas.length, "OVA"),
  ].join(", ")
  const remasters = yearEpisodes.length - newEpisodes.length
  const remasterNote =
    remasters > 0 ? ` (${countLabel(remasters, "rebroadcast")} skipped)` : ""

  const knownSlugs = new Set<string>()
  const knownTitles = new Set<string>() // `${type}|${normalized title}`
  const knownDates = new Set<string>() // `${type}|${ISO date}`
  const knownEpisodeNumbers = new Set<number>()
  const knownMovieNumbers = new Set<number>()
  let maxEpisodeCanonOrder = 0

  if (!dryRun) {
    // PostgREST caps each request at 1,000 rows, so paginate to avoid a
    // truncated dedup set once the DB has 1,000+ episodes.
    const PAGE_SIZE = 1000
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: chunk } = await supabase
        .from("content_entries")
        .select("slug, title, type, episode_number, movie_number, air_date, canon_order")
        .in("type", ["episode", "movie", "special", "ova"])
        .order("slug")
        .range(from, from + PAGE_SIZE - 1)
      if (!chunk || chunk.length === 0) break
      for (const row of chunk) {
        if (row.slug) knownSlugs.add(row.slug)
        if (row.title) knownTitles.add(`${row.type}|${normalizeTitleForDedup(row.title)}`)
        if (row.air_date) knownDates.add(`${row.type}|${row.air_date}`)
        if (row.type === "episode") {
          if (row.episode_number != null) {
            knownEpisodeNumbers.add(row.episode_number)
          }
          if (row.canon_order != null && row.canon_order > maxEpisodeCanonOrder) {
            maxEpisodeCanonOrder = row.canon_order
          }
        }
        if (row.type === "movie" && row.movie_number != null) {
          knownMovieNumbers.add(row.movie_number)
        }
      }
      if (chunk.length < PAGE_SIZE) break
    }
    // Rows already waiting in the review queue own their slugs too, otherwise
    // this run allocates a slug a pending row already claimed and stageBatch
    // silently drops the new one.
    for (const slug of await readStagingSlugs(supabase)) knownSlugs.add(slug)
  }

  const maxKnownEpisode = knownEpisodeNumbers.size
    ? Math.max(...knownEpisodeNumbers)
    : 0
  const canonOffset = episodeCanonOffset(maxEpisodeCanonOrder, maxKnownEpisode)

  // Same slug conventions as the franchise seeder, lowest free number per type,
  // so a wiki-first row keeps its slug when Kitsu eventually adds the same entry.
  const nextFree = { movie: 1, special: 1, ova: 1 }
  const allocateSlug = (type: "movie" | "special" | "ova"): string => {
    let candidate = kitsuContentSlug(type, nextFree[type])
    while (knownSlugs.has(candidate)) {
      nextFree[type] += 1
      candidate = kitsuContentSlug(type, nextFree[type])
    }
    nextFree[type] += 1
    knownSlugs.add(candidate)
    return candidate
  }

  const rows: ContentInsert[] = []

  // Episodes are keyed by number, which is what Jikan seeds on too — a truncated
  // or 504-ing Jikan pull is exactly the gap this source exists to fill.
  for (const episode of newEpisodes) {
    if (knownEpisodeNumbers.has(episode.number)) continue
    const slug = `ep-${String(episode.number).padStart(3, "0")}`
    if (knownSlugs.has(slug)) continue
    knownEpisodeNumbers.add(episode.number)
    knownSlugs.add(slug)
    rows.push({
      slug,
      title: episode.title,
      type: "episode",
      episode_number: episode.number,
      movie_number: null,
      air_date: episode.airDate,
      canon_order: episode.number + canonOffset,
      arc_id: null,
      synopsis: null,
      image_url: "",
      runtime_minutes: defaultRuntimeMinutes("episode"),
    })
  }

  // Movies dedup on their number: the wiki's English title rarely matches the
  // API title for the same film, but the number is stable.
  for (const movie of yearMovies) {
    const titleKey = `movie|${normalizeTitleForDedup(movie.title)}`
    if (knownMovieNumbers.has(movie.number) || knownTitles.has(titleKey)) continue
    const slug = allocateSlug("movie")
    const slugNum = Number(slug.split("-")[1]) || 1
    knownMovieNumbers.add(movie.number)
    knownTitles.add(titleKey)
    rows.push({
      slug,
      title: movie.title,
      type: "movie",
      episode_number: null,
      movie_number: movie.number,
      air_date: movie.airDate,
      canon_order: 1000 + slugNum, // matches the franchise seeder's movie base
      arc_id: null,
      synopsis: null,
      image_url: "",
      runtime_minutes: defaultRuntimeMinutes("movie"),
    })
  }

  // Specials and OVAs match on title OR air date: the wiki's English title is a
  // translation the API sources may render differently for the same release.
  const stageUnnumbered = (
    items: typeof yearSpecials,
    type: "special" | "ova",
    base: number
  ) => {
    for (const item of items) {
      const titleKey = `${type}|${normalizeTitleForDedup(item.title)}`
      const dateKey = `${type}|${item.airDate}`
      if (knownTitles.has(titleKey)) continue
      if (knownDates.has(dateKey)) continue
      const slug = allocateSlug(type)
      const slugNum = Number(slug.split("-")[1]) || 1
      knownTitles.add(titleKey)
      knownDates.add(dateKey)
      rows.push({
        slug,
        title: item.title,
        type,
        episode_number: null,
        movie_number: null,
        air_date: item.airDate,
        canon_order: base + slugNum,
        arc_id: null,
        synopsis: null,
        image_url: "",
        runtime_minutes: defaultRuntimeMinutes(type),
      })
    }
  }

  stageUnnumbered(yearSpecials, "special", 2000)
  stageUnnumbered(yearOvas, "ova", 3000)

  const skipped = listed - rows.length

  if (dryRun) {
    return {
      type: "dcw",
      totalFetched: listed,
      inserted: rows.length,
      skipped: 0,
      errors,
      note: `dry run — DCW lists ${listed} ${year} entr${listed === 1 ? "y" : "ies"}: ${breakdown}${remasterNote}; no DB read for dedup`,
    }
  }

  if (listed === 0) {
    return {
      type: "dcw",
      totalFetched: 0,
      inserted: 0,
      skipped: 0,
      errors,
      note:
        errors.length > 0
          ? `DCW: no ${year} entries read — ${errors.length} list(s) failed: ${errors.join(" | ")}`
          : `DCW lists nothing yet for ${year}${remasterNote}.`,
    }
  }

  if (rows.length === 0) {
    return {
      type: "dcw",
      totalFetched: listed,
      inserted: 0,
      skipped,
      errors,
      note: `DCW: all ${listed} ${year} entr${listed === 1 ? "y" : "ies"} already tracked${remasterNote}.${
        errors.length > 0 ? ` ${errors.length} list(s) failed: ${errors.join(" | ")}` : ""
      }`,
    }
  }

  const enriched = await enrichRowsWithDcwImages(rows as SyncRow[])
  const staged = await stageBatch(supabase, enriched as ContentInsert[], "dcw")
  const failedNote = errors.length > 0 ? ` ${errors.length} list(s) failed: ${errors.join(" | ")}` : ""
  return {
    type: "dcw",
    totalFetched: listed,
    inserted: staged.inserted,
    skipped: skipped + staged.skipped,
    errors,
    note:
      staged.inserted > 0
        ? `DCW: ${staged.inserted} new ${year} entr${staged.inserted === 1 ? "y" : "ies"} queued for Admin Approval in /admin/sync (${breakdown}).${failedNote}`
        : `DCW: nothing new to queue for ${year}.${failedNote}`,
  }
}

/**
 * GET /api/sync
 * Vercel Cron issues GET, so this is the entry point the schedules in
 * vercel.json actually reach: with a valid `Authorization: Bearer $CRON_SECRET`
 * it runs the same sync POST does (mode from ?mode=). Without that header it
 * falls back to the admin status read the admin panel uses — which is why the
 * crons used to 401 every night while the sync never ran.
 */
export async function GET(request: NextRequest) {
  if (headerMatchesSecret(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return runSync(request)
  }
  return syncStatus()
}

/** Admin-only: entry counts by type. */
async function syncStatus() {
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
      message: "POST to sync. mode=seed|airing|dcw|latest.",
    })
  } catch (error) {
    return handleApiError(error, "sync")
  }
}
