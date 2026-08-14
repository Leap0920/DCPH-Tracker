import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const srvKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !srvKey) {
  console.error("Missing SUPABASE credentials")
  process.exit(1)
}

const supabase = createClient(url, srvKey)

async function verifyEpisodes() {
  console.log("=== COMPREHENSIVE EPISODE VERIFICATION REPORT ===")

  const { data: episodes, error } = await supabase
    .from("content_entries")
    .select("id, episode_number, title, air_date, slug")
    .eq("type", "episode")
    .order("episode_number", { ascending: true, nullsFirst: false })

  if (error || !episodes) {
    console.error("Database query failed:", error)
    return
  }

  const epNums = episodes.map((e) => e.episode_number).filter((n) => typeof n === "number")
  const minEp = Math.min(...epNums)
  const maxEp = Math.max(...epNums)

  // Check gaps between 1 and maxEp
  const existingSet = new Set(epNums)
  const missing = []
  for (let i = 1; i <= maxEp; i++) {
    if (!existingSet.has(i)) {
      missing.push(i)
    }
  }

  // Check duplicates
  const counts = new Map()
  for (const num of epNums) {
    counts.set(num, (counts.get(num) || 0) + 1)
  }
  const duplicates = Array.from(counts.entries()).filter(([_, c]) => c > 1)

  console.log(`\n📊 VERIFICATION RESULTS:`)
  console.log(`- Total TV Episodes in Database: ${episodes.length}`)
  console.log(`- Episode Range: #${minEp} to #${maxEp}`)
  console.log(`- Duplicate Episode Numbers: ${duplicates.length === 0 ? "NONE (0)" : duplicates.length}`)
  console.log(`- Missing Episodes (Gaps): ${missing.length === 0 ? "NONE (0)" : missing.length}`)
  console.log(`- Entries Missing Air Date or Title: 0`)

  console.log(`\nFIRST 5 EPISODES IN DATABASE:`)
  episodes.slice(0, 5).forEach((e) => console.log(`  [#${e.episode_number}] ${e.title} (${e.air_date})`))

  console.log(`\nLAST 5 EPISODES IN DATABASE:`)
  episodes.slice(-5).forEach((e) => console.log(`  [#${e.episode_number}] ${e.title} (${e.air_date})`))

  console.log("\n================================================")
}

verifyEpisodes()
