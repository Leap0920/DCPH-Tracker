import { NextResponse } from "next/server"
import { createAdminClient } from "@/utils/supabase/admin"
import { culpritNames, fetchWikitextBatch, parsePeopleSection } from "@/lib/dcw-cases"

export const maxDuration = 300

const BATCH_SIZE = 50
const TITLE_PAGE_SIZE = 1000

export async function GET(request: Request) {
  const secret = process.env.ADMIN_TASK_SECRET || process.env.CRON_SECRET
  if (!secret || request.headers.get("x-admin-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const limit = Math.min(833, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "150", 10) || 150))

  const supabase = createAdminClient()
  if (!supabase) return NextResponse.json({ error: "service role key not configured" }, { status: 503 })

  const blocksByTitle = new Map<string, number>()
  for (let offset = 0; ; offset += TITLE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("dcw_cases")
      .select("page_title")
      .order("id", { ascending: true })
      .range(offset, offset + TITLE_PAGE_SIZE - 1)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const rows = (data ?? []) as { page_title: string }[]
    for (const row of rows) blocksByTitle.set(row.page_title, (blocksByTitle.get(row.page_title) ?? 0) + 1)
    if (rows.length < TITLE_PAGE_SIZE) break
  }

  const titles = [...blocksByTitle.keys()].sort().slice(0, limit)

  let withPeopleSection = 0
  let withAnyCulprit = 0
  let singleBlockPages = 0
  const histogram: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3+": 0 }
  const multiCulpritSamples: { title: string; culprits: string[] }[] = []
  const missedSamples: { title: string; roles: string[] }[] = []

  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const batch = titles.slice(i, i + BATCH_SIZE)
    const wikitextByTitle = await fetchWikitextBatch(batch)

    for (const title of batch) {
      const wikitext = wikitextByTitle.get(title)
      if (!wikitext) continue

      if ((blocksByTitle.get(title) ?? 0) === 1) singleBlockPages++

      const people = parsePeopleSection(wikitext)
      if (people.length === 0) continue
      withPeopleSection++

      const culprits = culpritNames(people)
      const bucket = culprits.length >= 3 ? "3+" : String(culprits.length)
      histogram[bucket] = (histogram[bucket] ?? 0) + 1

      if (culprits.length >= 1) withAnyCulprit++
      if (culprits.length >= 2 && multiCulpritSamples.length < 20) {
        multiCulpritSamples.push({ title, culprits })
      }
      if (culprits.length === 0 && missedSamples.length < 20) {
        missedSamples.push({ title, roles: people.flatMap((p) => p.roles).slice(0, 12) })
      }
    }
  }

  const probed = titles.length
  return NextResponse.json({
    probed,
    withPeopleSection,
    peopleSectionRate: probed ? +(withPeopleSection / probed).toFixed(3) : 0,
    withAnyCulprit,
    culpritLabelRate: withPeopleSection ? +(withAnyCulprit / withPeopleSection).toFixed(3) : 0,
    histogram,
    singleBlockPages,
    multiBlockPagesExcluded: probed - singleBlockPages,
    multiCulpritSamples,
    missedSamples,
  })
}
