import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const srvKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !srvKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(url, srvKey)

// Exact mapping of Official Mainline Theatrical Movies 1 to 29
const OFFICIAL_MOVIES = [
  { num: 1, slug: "mov-17" }, // The Timed Skyscraper
  { num: 2, slug: "mov-21" }, // The Fourteenth Target
  { num: 3, slug: "mov-25" }, // The Last Wizard of the Century
  { num: 4, slug: "mov-27" }, // Captured In Her Eyes
  { num: 5, slug: "mov-28" }, // Countdown to Heaven
  { num: 6, slug: "mov-30" }, // The Phantom of Baker Street
  { num: 7, slug: "mov-32" }, // Crossroad in the Ancient Capital
  { num: 8, slug: "mov-33" }, // Magician of the Silver Sky
  { num: 9, slug: "mov-35" }, // Strategy Above the Depths
  { num: 10, slug: "mov-60" }, // The Private Eyes' Requiem
  { num: 11, slug: "mov-62" }, // Jolly Roger in the Deep Azure
  { num: 12, slug: "mov-63" }, // Full Score of Fear
  { num: 13, slug: "mov-64" }, // The Jet Black Chaser
  { num: 14, slug: "mov-29" }, // The Lost Ship in the Sky
  { num: 15, slug: "mov-31" }, // Quarter of Silence
  { num: 16, slug: "mov-34" }, // The Eleventh Striker
  { num: 17, slug: "mov-36" }, // Private Eye in the Distant Sea
  { num: 18, slug: "mov-38" }, // The Sniper from Another Dimension
  { num: 19, slug: "mov-40" }, // The Sunflowers of Inferno
  { num: 20, slug: "mov-42" }, // The Darkest Nightmare
  { num: 21, slug: "mov-43" }, // The Crimson Love Letter
  { num: 22, slug: "mov-44" }, // Zero's Executioner
  { num: 23, slug: "mov-45" }, // Fist of Blue Sapphire
  { num: 24, slug: "mov-47" }, // The Scarlet Bullet
  { num: 25, slug: "mov-48" }, // The Bride of Halloween
  { num: 26, slug: "mov-49" }, // Black Iron Submarine
  { num: 27, slug: "mov-50" }, // The Million-dollar Pentagram
  { num: 28, slug: "mov-51" }, // One-eyed Flashback
  { num: 29, slug: "mov-52" }, // Fallen Angel of the Highway
]

// Placeholder slugs to delete (Movie 1 - Movie 13 placeholders with no posters)
const PLACEHOLDER_SLUGS = [
  "mov-01", "mov-02", "mov-03", "mov-04", "mov-05", "mov-06",
  "mov-07", "mov-08", "mov-09", "mov-10", "mov-11", "mov-12", "mov-13"
]

async function fixMovies() {
  console.log("Starting movie re-numbering & organization fix...")

  // 1. Clear movie_number for ALL movies first
  const { error: resetErr } = await supabase
    .from("content_entries")
    .update({ movie_number: null })
    .eq("type", "movie")

  if (resetErr) {
    console.error("Error resetting movie numbers:", resetErr.message)
    return
  }

  // 2. Assign movie_number = 1..29 to the 29 official mainline movies
  const officialSlugsSet = new Set(OFFICIAL_MOVIES.map(m => m.slug))
  for (const m of OFFICIAL_MOVIES) {
    const { error } = await supabase
      .from("content_entries")
      .update({ movie_number: m.num })
      .eq("slug", m.slug)

    if (error) {
      console.error(`Error setting movie_number ${m.num} on ${m.slug}:`, error.message)
    } else {
      console.log(`Set Movie #${m.num} -> ${m.slug}`)
    }
  }

  // 3. Delete leftover generic placeholders ("Movie 1" to "Movie 13")
  for (const pSlug of PLACEHOLDER_SLUGS) {
    const { data: entry } = await supabase
      .from("content_entries")
      .select("id")
      .eq("slug", pSlug)
      .maybeSingle()

    if (entry) {
      // Re-link watch_status if any
      await supabase.from("watch_status").delete().eq("content_id", entry.id)
      await supabase.from("content_entries").delete().eq("id", entry.id)
      console.log(`Deleted placeholder entry: ${pSlug}`)
    }
  }

  // 4. Update Kimetsu no Yaiba entries to type = 'yaiba'
  const yaibaSlugs = ["mov-65", "mov-66", "mov-67", "mov-68", "mov-69", "mov-70"]
  await supabase
    .from("content_entries")
    .update({ type: "yaiba", movie_number: null })
    .in("slug", yaibaSlugs)

  console.log("Movie re-numbering and cleanup completed successfully!")
}

fixMovies().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
