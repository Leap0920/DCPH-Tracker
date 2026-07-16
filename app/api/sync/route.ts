import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { createAdminClient } from "@/utils/supabase/admin"
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
import type { Database } from "@/types/database.types"

type ContentInsert = Database["public"]["Tables"]["content_entries"]["Insert"]

/** Either the cookie-bound server client or the service-role admin client. */
type SyncClient = Awaited<ReturnType<typeof createClient>>

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
 * Cron: set CRON_SECRET and call with ?cron_secret=... or Authorization: Bearer ...
 * to allow unauthenticated scheduled runs.
 */
export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const dryRun = searchParams.get("dry_run") === "true"
  const limitParam = searchParams.get("limit")
  const limit = limitParam ? parseInt(limitParam, 10) : undefined
  const mode = searchParams.get("mode") || "all"

  try {
    const supabase = await createClient()

    // 0. Authorize: cron secret (unauthenticated) OR admin user session.
    const cronSecret = process.env.CRON_SECRET
    const isCron =
      !!cronSecret &&
      (searchParams.get("cron_secret") === cronSecret ||
        request.headers.get("authorization") === `Bearer ${cronSecret}`)

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
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── Slug helper (stable across APIs; matches supabase/seed.sql) ──

function kitsuContentSlug(type: "movie" | "special" | "ova", idx: number): string {
  const prefix = type === "movie" ? "mov" : type === "special" ? "sp" : "ova"
  return `${prefix}-${String(idx).padStart(2, "0")}`
}

// ─── Shared upsert helper ────────────────────────────────────────

async function upsertBatch(
  supabase: SyncClient,
  rows: ContentInsert[]
): Promise<{ inserted: number; errors: string[] }> {
  const BATCH_SIZE = 50
  let inserted = 0
  const errors: string[] = []
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from("content_entries")
      .upsert(batch, { onConflict: "slug" })
    if (error) {
      errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`)
    } else {
      inserted += batch.length
    }
  }
  return { inserted, errors }
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
      runtime_minutes: null,
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

  const { inserted, errors } = await upsertBatch(supabase, rows)
  return { type: "episodes", totalFetched: rows.length, inserted, skipped: 0, errors }
}

// ─── Seed: franchise (movies / specials / OVAs) from Kitsu ──────

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

  for (const g of groups) {
    const entries = franchise
      .filter((a) => a.attributes.subtype === g.subtype)
      .sort((a, b) =>
        (a.attributes.startDate ?? "").localeCompare(b.attributes.startDate ?? "")
      )
    const limited = limit ? entries.slice(0, limit) : entries
    limited.forEach((a, i) => {
      const idx = i + 1
      const title =
        a.attributes.canonicalTitle ??
        a.attributes.titles?.en_us ??
        a.attributes.titles?.en ??
        `Entry ${idx}`
      rows.push({
        slug: kitsuContentSlug(g.ctype, idx),
        title,
        type: g.ctype,
        episode_number: null,
        movie_number: g.ctype === "movie" ? idx : null,
        air_date: a.attributes.startDate ?? "2000-01-01",
        canon_order: g.base + idx,
        arc_id: null,
        synopsis: a.attributes.synopsis ?? null,
        image_url: a.attributes.posterImage?.original ?? "",
        runtime_minutes: a.attributes.episodeLength ?? null,
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
    }
  }

  const { inserted, errors } = await upsertBatch(supabase, rows)
  return { type: "franchise", totalFetched: rows.length, inserted, skipped: 0, errors }
}

// ─── Airing mode: AniList detects new episode → Jikan tail re-sync ─

async function syncAiring(
  supabase: SyncClient,
  dryRun: boolean
): Promise<SyncResult> {
  // Current max episode we have.
  const { data } = await supabase
    .from("content_entries")
    .select("episode_number")
    .eq("type", "episode")
  const nums = (data ?? [])
    .map((d) => d.episode_number)
    .filter((n): n is number => n !== null)
  const dbMax = nums.length ? Math.max(...nums) : 0

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
      runtime_minutes: null,
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

  const { inserted, errors } = await upsertBatch(supabase, rows)
  return {
    type: "airing",
    totalFetched: rows.length,
    inserted,
    skipped: 0,
    errors,
    note: anilistNote,
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
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
