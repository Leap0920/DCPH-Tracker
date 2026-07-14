import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import {
  getAllEpisodes,
  getAnimeFull,
  slugify,
  DETECTIVE_CONAN_MAL_ID,
} from "@/lib/jikan"
import type { Database } from "@/types/database.types"

type ContentInsert = Database["public"]["Tables"]["content_entries"]["Insert"]

interface SyncResult {
  totalFetched: number
  inserted: number
  skipped: number
  errors: string[]
}

/**
 * POST /api/sync
 * Syncs Detective Conan episodes from Jikan (MyAnimeList) into Supabase content_entries
 *
 * Query params:
 *   - dry_run=true  → fetch data but don't write to DB
 *   - limit=N       → only sync first N episodes (useful for testing)
 */
export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const dryRun = searchParams.get("dry_run") === "true"
  const limitParam = searchParams.get("limit")
  const limit = limitParam ? parseInt(limitParam, 10) : undefined

  try {
    // 0. Prepare Supabase client and check admin role
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

    // 1. Get anime details for series image and metadata
    const animeFull = await getAnimeFull(DETECTIVE_CONAN_MAL_ID)
    const seriesImageUrl =
      animeFull.data.images?.jpg?.large_image_url ??
      animeFull.data.images?.jpg?.image_url ??
      ""

    // 2. Fetch all episodes from Jikan
    let episodes = await getAllEpisodes(DETECTIVE_CONAN_MAL_ID)

    if (limit) {
      episodes = episodes.slice(0, limit)
    }

    // 4. Get existing episode numbers to avoid duplicates
    const { data: existingEntries } = await supabase
      .from("content_entries")
      .select("episode_number")
      .eq("type", "episode")

    const existingNumbers = new Set(
      (existingEntries ?? [])
        .map((e) => e.episode_number)
        .filter((n): n is number => n !== null)
    )

    // 5. Build insert rows
    const rows: ContentInsert[] = []
    let skipped = 0

    for (const ep of episodes) {
      if (existingNumbers.has(ep.mal_id)) {
        skipped++
        continue
      }

      const slug = `ep-${String(ep.mal_id).padStart(3, "0")}-${slugify(ep.title)}`
      const airDate = ep.aired
        ? new Date(ep.aired).toISOString().split("T")[0]
        : "1996-01-08"

      rows.push({
        slug,
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
      })
    }

    // 6. Dry run — return preview without writing
    if (dryRun) {
      return NextResponse.json({
        dry_run: true,
        anime_title: animeFull.data.title,
        total_jikan_episodes: episodes.length,
        already_in_db: skipped,
        to_insert: rows.length,
        sample: rows.slice(0, 5),
      })
    }

    // 7. Insert in batches of 50 to avoid payload limits
    const BATCH_SIZE = 50
    let inserted = 0
    const errors: string[] = []

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      const { error } = await supabase.from("content_entries").insert(batch)

      if (error) {
        errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`)
      } else {
        inserted += batch.length
      }
    }

    const result: SyncResult = {
      totalFetched: episodes.length,
      inserted,
      skipped,
      errors,
    }

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * GET /api/sync
 * Returns current sync status (how many entries exist)
 */
export async function GET() {
  try {
    const supabase = await createClient()

    // Check admin role
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

    const { count } = await supabase
      .from("content_entries")
      .select("*", { count: "exact", head: true })
      .eq("type", "episode")

    return NextResponse.json({
      current_episode_count: count ?? 0,
      message: "Use POST to sync episodes from MyAnimeList",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

