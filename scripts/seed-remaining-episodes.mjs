import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const srvKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !srvKey) {
  console.error("Missing SUPABASE credentials")
  process.exit(1)
}

const supabase = createClient(url, srvKey)
const KITSU_BASE_URL = "https://kitsu.io/api/edge"
const DETECTIVE_CONAN_KITSU_ID = 210

async function rateLimitedFetch(fetchUrl) {
  await new Promise((resolve) => setTimeout(resolve, 300))
  const res = await fetch(fetchUrl)
  if (!res.ok) {
    throw new Error(`Kitsu fetch failed: ${res.status}`)
  }
  return res.json()
}

async function seedRemainingEpisodes() {
  console.log("=== FETCHING EPISODES 1001+ FROM KITSU (STARTING AT OFFSET 1000) ===")

  const allEpisodes = []
  let nextUrl = `${KITSU_BASE_URL}/anime/${DETECTIVE_CONAN_KITSU_ID}/episodes?sort=number&page[limit]=20&page[offset]=1000`

  while (nextUrl) {
    console.log(`Fetching: ${nextUrl}`)
    const res = await rateLimitedFetch(nextUrl)
    allEpisodes.push(...res.data)
    nextUrl = res.links?.next ?? null
  }

  console.log(`Fetched ${allEpisodes.length} episodes beyond offset 1000.`)

  // Filter aired episodes (must have airdate)
  const aired = allEpisodes.filter(
    (ep) => ep.attributes.number > 1000 && ep.attributes.airdate
  )

  console.log(`Found ${aired.length} aired episodes beyond Episode 1000 to seed.`)

  let insertedCount = 0

  for (const ep of aired) {
    const epNum = ep.attributes.number
    const title =
      ep.attributes.canonicalTitle ||
      ep.attributes.titles?.en ||
      ep.attributes.titles?.en_jp ||
      `Episode ${epNum}`

    const slug = `ep-${epNum}`
    const airDate = ep.attributes.airdate

    // Check if already exists in DB
    const { data: existing } = await supabase
      .from("content_entries")
      .select("id")
      .eq("episode_number", epNum)
      .maybeSingle()

    if (existing) {
      continue
    }

    const payload = {
      slug,
      title,
      type: "episode",
      episode_number: epNum,
      canon_order: epNum,
      release_order: epNum,
      air_date: airDate,
      synopsis: ep.attributes.synopsis || null,
      runtime_minutes: ep.attributes.length || 24,
    }

    const { error } = await supabase.from("content_entries").insert(payload)

    if (error) {
      console.error(`❌ Error inserting Episode #${epNum}:`, error.message)
    } else {
      console.log(`✅ Seeded Episode #${epNum}: ${title} (${airDate})`)
      insertedCount++
    }
  }

  console.log(`\n=== SUCCESSFULLY SEEDED ${insertedCount} NEW EPISODES ===`)
}

seedRemainingEpisodes()
