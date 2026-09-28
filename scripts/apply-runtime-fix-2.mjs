// Applies supabase/migration-fix-runtime-minutes-2.sql against the live project
// through PostgREST (service role). Prints a before/after line per row, writes a
// rollback file to scripts/out/, then verifies nothing is left NULL/0/absurd.
//
//   node scripts/apply-runtime-fix-2.mjs            # apply
//   node scripts/apply-runtime-fix-2.mjs --dry-run   # print the plan only
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"

const DRY_RUN = process.argv.includes("--dry-run")

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trimStart().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=")
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
)
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error("missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local")

const HEADERS = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }

async function fetchAll() {
  const rows = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(
      `${url}/rest/v1/content_entries?select=slug,title,type,episode_number,runtime_minutes&order=release_order.asc&limit=${PAGE}&offset=${from}`,
      { headers: HEADERS }
    )
    if (!res.ok) throw new Error(`read ${res.status}: ${await res.text()}`)
    const page = await res.json()
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return rows
}

/** episode_number -> minutes, from DCW int-episode slot spans (see the SQL file). */
const EPISODE_RUNTIME = {
  11: 46, 52: 46, 76: 46, 96: 92, 118: 46, 129: 92, 162: 46, 174: 92, 184: 46,
  208: 46, 219: 92, 263: 92, 304: 92, 315: 25, 342: 46, 345: 115, 356: 46,
  383: 92, 425: 115, 449: 46, 452: 46, 479: 92, 487: 46, 488: 46, 489: 46,
  490: 46, 515: 46, 516: 46, 521: 46, 522: 46, 557: 25, 651: 46, 734: 46,
  804: 46, 805: 46, 916: 25, 927: 46, 928: 46, 1187: 46,
}

/** slug -> minutes, for every type that is not the episode spine. */
const SLUG_RUNTIME = {
  // Regular movies (DCW "Regular movies" runtime field).
  "mov-32": 95, "mov-35": 100, "mov-55": 108, "mov-57": 109, "mov-58": 108,
  "mov-62": 107, "mov-64": 112, "mov-29": 103, "mov-31": 110, "mov-34": 111,
  "mov-36": 111, "mov-38": 111, "mov-40": 113, "mov-44": 111, "mov-45": 110,
  "mov-47": 111, "mov-48": 111, "mov-49": 110,
  // Compilation / crossover films.
  "mov-46": 110, "mov-37": 107, "mov-compilation-movie-the-story-of-haibara": 90,
  // TV specials.
  "sp-02": 25, "sp-03": 92, "sp-04": 25,
  // Live action: four TV specials, then the 2011 series at 40 min per episode.
  "la-live-action-drama-special-01": 108,
  "la-live-action-drama-special-02": 108,
  "la-live-action-drama-special-03": 104,
  "la-live-action-drama-special-04": 108,
  "la-live-action-drama-episode-01-02": 80,
  "la-live-action-drama-episode-03": 40,
  "la-live-action-drama-episodes-04-07": 160,
  "la-live-action-drama-episodes-08-09": 80,
  "la-live-action-drama-episodes-10-11": 80,
  "la-live-action-drama-episode-12-13": 80,
  "drama-episode-11": 40, "drama-episode-12": 40, "drama-episode-13": 40,
}

/** type -> minutes, applied to every row of that type. */
const TYPE_RUNTIME = { hanzawa: 10, zero_tea_time: 15 }

const rows = await fetchAll()
const byNumber = new Map()
const bySlug = new Map()
for (const r of rows) {
  bySlug.set(r.slug, r)
  if (r.type === "episode" && r.episode_number != null) byNumber.set(r.episode_number, r)
}

const planned = []
const missing = []
for (const [n, minutes] of Object.entries(EPISODE_RUNTIME)) {
  const row = byNumber.get(Number(n))
  if (!row) { missing.push(`episode ${n}`); continue }
  if (row.runtime_minutes !== minutes) planned.push({ ...row, after: minutes, source: `episode ${n}` })
}
for (const [slug, minutes] of Object.entries(SLUG_RUNTIME)) {
  const row = bySlug.get(slug)
  if (!row) { missing.push(slug); continue }
  if (row.runtime_minutes !== minutes) planned.push({ ...row, after: minutes, source: slug })
}
for (const [type, minutes] of Object.entries(TYPE_RUNTIME)) {
  for (const row of rows) {
    if (row.type !== type) continue
    if (row.runtime_minutes !== minutes) planned.push({ ...row, after: minutes, source: `${type} default` })
  }
}
// Episode spine: anything not in the table above should read 25.
const SPECIAL_NUMBERS = new Set(Object.keys(EPISODE_RUNTIME).map(Number))
for (const row of rows) {
  if (row.type !== "episode" || row.episode_number == null) continue
  if (SPECIAL_NUMBERS.has(row.episode_number)) continue
  if (row.runtime_minutes !== 25) planned.push({ ...row, after: 25, source: "episode default" })
}

planned.sort((a, b) => (a.type === b.type ? a.slug.localeCompare(b.slug) : a.type.localeCompare(b.type)))

console.log(`rows in catalog: ${rows.length}`)
if (missing.length) console.log(`!! not found in catalog (skipped): ${missing.join(", ")}`)
console.log(`\n${planned.length} row(s) to correct:\n`)
for (const p of planned) {
  console.log(
    `  ${p.type.padEnd(13)} ${String(p.slug).padEnd(46)} ${String(p.runtime_minutes ?? "NULL").padStart(5)} -> ${String(p.after).padStart(4)}   ${String(p.title).slice(0, 44)}`
  )
}

if (DRY_RUN) {
  console.log("\n[dry-run] nothing written.")
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-")
mkdirSync(new URL("./out/", import.meta.url), { recursive: true })
const rollbackPath = new URL(`./out/runtime-rollback-${stamp}.json`, import.meta.url)
writeFileSync(
  rollbackPath,
  JSON.stringify(
    { appliedAt: new Date().toISOString(), rows: planned.map((p) => ({ slug: p.slug, before: p.runtime_minutes, after: p.after })) },
    null,
    2
  )
)
console.log(`\nrollback record: scripts/out/runtime-rollback-${stamp}.json`)

// Group by target value so each PATCH is one request.
const groups = new Map()
for (const p of planned) {
  if (!groups.has(p.after)) groups.set(p.after, [])
  groups.get(p.after).push(p.slug)
}
let updated = 0
for (const [minutes, slugs] of groups) {
  for (let i = 0; i < slugs.length; i += 100) {
    const chunk = slugs.slice(i, i + 100)
    const res = await fetch(`${url}/rest/v1/content_entries?slug=in.(${chunk.map(encodeURIComponent).join(",")})`, {
      method: "PATCH",
      headers: { ...HEADERS, Prefer: "return=representation" },
      body: JSON.stringify({ runtime_minutes: Number(minutes) }),
    })
    if (!res.ok) throw new Error(`patch ${minutes}min ${res.status}: ${await res.text()}`)
    const done = await res.json()
    if (done.length !== chunk.length) throw new Error(`patch ${minutes}min touched ${done.length} of ${chunk.length} rows`)
    updated += done.length
  }
}
console.log(`updated: ${updated} row(s)`)

const after = await fetchAll()
const bad = after.filter((r) => r.runtime_minutes == null || r.runtime_minutes <= 0 || r.runtime_minutes > 200)
console.log(`verify: ${bad.length} row(s) with a missing or implausible runtime`)
for (const b of bad) console.log(`  !! ${b.type} ${b.slug} = ${b.runtime_minutes}`)
const dist = new Map()
for (const r of after) {
  const k = `${r.type}`
  if (!dist.has(k)) dist.set(k, new Map())
  const m = dist.get(k)
  const v = String(r.runtime_minutes)
  m.set(v, (m.get(v) ?? 0) + 1)
}
console.log("\nafter (type: runtime x count):")
for (const [type, m] of [...dist.entries()].sort()) {
  console.log(`  ${type.padEnd(13)} ${[...m.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([v, c]) => `${v}x${c}`).join("  ")}`)
}
