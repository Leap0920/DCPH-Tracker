import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const srvKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !srvKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(url, srvKey)

// Mapping of redundant generic slugs -> canonical target slugs
const DUPLICATE_MAPPINGS = [
  { dupSlug: "mov-14", keepSlug: "mov-29", canonicalNum: 14 }, // The Lost Ship in the Sky
  { dupSlug: "mov-15", keepSlug: "mov-31", canonicalNum: 15 }, // Quarter of Silence
  { dupSlug: "mov-16", keepSlug: "mov-34", canonicalNum: 16 }, // The Eleventh Striker
  { dupSlug: "mov-17", keepSlug: "mov-36", canonicalNum: 17 }, // Private Eye in the Distant Sea
  { dupSlug: "mov-18", keepSlug: "mov-38", canonicalNum: 18 }, // Dimensional Sniper
  { dupSlug: "mov-19", keepSlug: "mov-40", canonicalNum: 19 }, // Sunflowers of Inferno
  { dupSlug: "mov-20", keepSlug: "mov-42", canonicalNum: 20 }, // Darkest Nightmare
  { dupSlug: "mov-21", keepSlug: "mov-43", canonicalNum: 21 }, // Crimson Love Letter
  { dupSlug: "mov-22", keepSlug: "mov-44", canonicalNum: 22 }, // Zero's Executioner
  { dupSlug: "mov-23", keepSlug: "mov-45", canonicalNum: 23 }, // Fist of Blue Sapphire
  { dupSlug: "mov-24", keepSlug: "mov-47", canonicalNum: 24 }, // Scarlet Bullet
  { dupSlug: "mov-25", keepSlug: "mov-48", canonicalNum: 25 }, // Halloween no Hanayome
  { dupSlug: "mov-26", keepSlug: "mov-49", canonicalNum: 26 }, // Black Iron Submarine
  { dupSlug: "mov-27", keepSlug: "mov-50", canonicalNum: 27 }, // 100-man Dol no Michishirube
  { dupSlug: "mov-28", keepSlug: "mov-51", canonicalNum: 28 }, // One-eyed Flashback
]

async function dedupeMovies() {
  console.log("Starting database movie deduplication...")

  // Fetch all movies from content_entries
  const { data: movies, error } = await supabase
    .from("content_entries")
    .select("id, slug, title, movie_number")
    .eq("type", "movie")

  if (error || !movies) {
    console.error("Error fetching movies:", error)
    return
  }

  const bySlug = new Map(movies.map((m) => [m.slug, m]))

  for (const map of DUPLICATE_MAPPINGS) {
    const dupEntry = bySlug.get(map.dupSlug)
    const keepEntry = bySlug.get(map.keepSlug)

    if (dupEntry && keepEntry && dupEntry.id !== keepEntry.id) {
      console.log(`Processing duplicate: "${dupEntry.title}" (${dupEntry.slug}) -> Keep "${keepEntry.title}" (${keepEntry.slug})`)

      // 1. Re-link watch_status rows from dupEntry.id to keepEntry.id
      const { data: dupWatchStatuses } = await supabase
        .from("watch_status")
        .select("*")
        .eq("content_id", dupEntry.id)

      if (dupWatchStatuses && dupWatchStatuses.length > 0) {
        for (const ws of dupWatchStatuses) {
          // Check if user already has a watch_status for keepEntry
          const { data: existingKeepWs } = await supabase
            .from("watch_status")
            .select("id")
            .eq("user_id", ws.user_id)
            .eq("content_id", keepEntry.id)
            .maybeSingle()

          if (existingKeepWs) {
            // Delete dup watch status since user already has keep status
            await supabase.from("watch_status").delete().eq("id", ws.id)
          } else {
            // Point dup watch status to keepEntry.id
            await supabase
              .from("watch_status")
              .update({ content_id: keepEntry.id })
              .eq("id", ws.id)
          }
        }
      }

      // 2. Delete dupEntry from content_entries
      const { error: delErr } = await supabase
        .from("content_entries")
        .delete()
        .eq("id", dupEntry.id)

      if (delErr) {
        console.error(`Error deleting ${dupEntry.slug}:`, delErr.message)
      } else {
        console.log(`Deleted redundant entry ${dupEntry.slug}`)
      }
    }

    // 3. Ensure keepEntry has the correct canonical movie_number
    if (keepEntry) {
      await supabase
        .from("content_entries")
        .update({ movie_number: map.canonicalNum })
        .eq("id", keepEntry.id)
    }
  }

  // 4. Ensure non-mainline movies have movie_number = NULL
  const nonMainlineSlugs = ["mov-19", "mov-22", "mov-33", "mov-37", "mov-41", "mov-46"]
  await supabase
    .from("content_entries")
    .update({ movie_number: null })
    .in("slug", nonMainlineSlugs)

  console.log("Deduplication completed successfully!")
}

dedupeMovies().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
