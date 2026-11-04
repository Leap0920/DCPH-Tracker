import Link from "next/link"
import { FileText } from "lucide-react"
import type { PostgrestError } from "@supabase/supabase-js"
import { createClient } from "@/utils/supabase/server"
import {
  crimeGroupLabel,
  dcwPageUrl,
  isCrimeGroupSlug,
  isMethodGroupSlug,
  methodGroupLabel,
} from "@/lib/dcw-cases"
import { CONTENT_TYPES, CONTENT_TYPE_LABELS, type ContentType } from "@/lib/constants"
import { CaseFilterBar, type FilterOption } from "@/components/cases/CaseFilterBar"
import { CrimeSpectrum } from "@/components/cases/CrimeSpectrum"
import { CategoryRail, type CategoryOption } from "@/components/cases/CategoryRail"
import { CaseFileRow } from "@/components/cases/CaseFileRow"
import {
  buildCrimeDistribution,
  compareCrimes,
  summarizeCoverage,
  groupFilesByType,
  type CaseFile,
  type CaseCrime,
} from "@/lib/cases-view"
import { ilikeOr } from "@/lib/postgrest-filter"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 50
/** PostgREST hard-caps a single response at 1000 rows. */
const FACET_PAGE_SIZE = 1000
const FACET_LIMIT = 6000

const CASES_VIEW = "all_episodes_with_crimes"
const DEFAULT_SORT = "release"
const SORT_VALUES = new Set([DEFAULT_SORT, "az", "za", "type"])
const LINK_VALUES = new Set(["all", "tracker", "wiki"])

const SORT_OPTIONS: FilterOption[] = [
  { value: "release", label: "Watch order (low→high)" },
  { value: "az", label: "Case title A→Z" },
  { value: "za", label: "Case title Z→A" },
  { value: "type", label: "Grouped by crime type" },
]

const CONTENT_TYPE_ORDER: readonly ContentType[] = [
  CONTENT_TYPES.EPISODE,
  CONTENT_TYPES.MOVIE,
  CONTENT_TYPES.SPECIAL,
  CONTENT_TYPES.OVA,
  CONTENT_TYPES.LIVE_ACTION,
  CONTENT_TYPES.MAGIC_KAITO,
  CONTENT_TYPES.HANZAWA,
  CONTENT_TYPES.ZERO_TEA_TIME,
  CONTENT_TYPES.YAIBA,
]
const CONTENT_TYPE_VALUES = new Set<string>(CONTENT_TYPE_ORDER)

const LINK_OPTIONS: FilterOption[] = [
  { value: "all", label: "Any entry" },
  { value: "tracker", label: "With crime data" },
  { value: "wiki", label: "No crime data" },
]

/**
 * Per-group tinting. `card` colours the crime stamp on each file row;
 * `bar` colours the row's left spine.
 */
function contentTypeLabel(type: string): string {
  return CONTENT_TYPE_LABELS[type as ContentType] ?? type
}

function uniqueStrings(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

/**
 * Collapses rows sharing a `page_title` into one CaseFile.
 * Entries without crime data (page_title NULL) are shown as individual cards.
 * Order of first appearance is preserved.
 */
function mergeCases(rows: CaseRow[]): CaseFile[] {
  const byTitle = new Map<string, CaseFile>()

  rows.forEach((row) => {
    const crime: CaseCrime = {
      id: row.id,
      caseIndex: row.case_index,
      crimeType: row.crime_type,
      crimeSlug: row.crime_slug,
      victim: row.victim,
      victimLabel: row.victim_label,
      causeDeath: row.cause_death,
      causeDeathLabel: row.cause_death_label,
      suspects: row.suspects,
      suspectsLabel: row.suspects_label,
      location: row.location,
      description: row.description,
    }

    // Use page_title if available, otherwise use entry_id as unique key
    const key = row.page_title || `entry-${row.entry_id}`

    const existing = byTitle.get(key)
    if (existing) {
      // Only add crime if this row has crime data
      if (row.page_title) existing.crimes.push(crime)
      existing.dateText ??= row.date_text
      existing.entryId ??= row.entry_id
      existing.entrySlug ??= row.entry_slug
      existing.entryType ??= row.entry_type
      existing.entryEpisodeNumber ??= row.entry_episode_number
      existing.entryReleaseOrder ??= row.entry_release_order
      return
    }

    byTitle.set(key, {
      pageTitle: row.page_title || row.entry_title || "Unknown",
      dateText: row.date_text,
      entryId: row.entry_id,
      entrySlug: row.entry_slug,
      entryType: row.entry_type,
      entryEpisodeNumber: row.entry_episode_number,
      entryReleaseOrder: row.entry_release_order,
      crimes: row.page_title ? [crime] : [],
      crimeBadges: [],
      primarySlug: row.crime_slug,
      victims: [],
      locations: [],
    })
  })

  return Array.from(byTitle.values()).map((file) => {
    file.crimes.sort((a, b) => a.caseIndex - b.caseIndex)

    const badges = new Map<string, { type: string; slug: string; count: number }>()
    for (const crime of file.crimes) {
      const key = crime.crimeSlug || crime.crimeType
      const hit = badges.get(key)
      if (hit) hit.count += 1
      else badges.set(key, { type: crime.crimeType, slug: crime.crimeSlug, count: 1 })
    }

    file.crimeBadges = Array.from(badges.values()).sort(compareCrimes)
    file.primarySlug = file.crimeBadges[0]?.slug ?? file.crimes[0]?.crimeSlug ?? "other"
    file.victims = uniqueStrings(file.crimes.map((c) => c.victim))
    file.locations = uniqueStrings(file.crimes.map((c) => c.location))

    return file
  })
}

type CaseRow = {
  id: string
  page_title: string
  case_index: number
  crime_type: string
  crime_slug: string
  cause_death: string | null
  victim: string | null
  victim_label: string | null
  cause_death_label: string | null
  suspects: string | null
  suspects_label: string | null
  location: string | null
  description: string | null
  date_text: string | null
  entry_id: string | null
  entry_slug: string | null
  entry_type: string | null
  entry_episode_number: number | null
  entry_release_order: number | null
  entry_title: string | null
}

const CASE_COLUMNS =
  "id, page_title, case_index, crime_type, crime_slug, cause_death, victim, victim_label, cause_death_label, suspects, suspects_label, location, description, date_text, entry_id, entry_slug, entry_type, entry_episode_number, entry_release_order, entry_title"

type FacetRow = {
  crime_slug: string
  cause_slug: string | null
  entry_type: string | null
  page_title: string | null
  entry_id: string
  case_index: number | null
}
type Facet = { slug: string; label: string; count: number }

/**
 * Counts by CANONICAL GROUP slug — the sync writes group slugs into
 * crime_slug / cause_slug, so ~250 raw crime values collapse to 12 options.
 * Labels come from the group table, never from row text.
 */
function tally(rows: FacetRow[], kind: "crime" | "cause"): Facet[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const slug = kind === "crime" ? row.crime_slug : row.cause_slug
    if (!slug) continue
    counts.set(slug, (counts.get(slug) ?? 0) + 1)
  }
  const labelFor = kind === "crime" ? crimeGroupLabel : methodGroupLabel
  return [...counts.entries()]
    .map(([slug, count]) => ({ slug, label: labelFor(slug), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/** The server client is created per-request, so derive its type rather than naming it. */
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

type CaseFilters = {
  contentType: string
  typeSlug: string
  causeSlug: string
  linkFilter: string
  q: string
}

/**
 * The predicates that define the result set.
 *
 * Shared by the page window and by the one-file lookup that finishes a file
 * straddling a page boundary — that lookup must see exactly the same rows the
 * window did, or it would pull in crimes the active filter excluded.
 */
function casesQuery(supabase: SupabaseServerClient, filters: CaseFilters) {
  let query = supabase.from(CASES_VIEW).select(CASE_COLUMNS, { count: "exact" })

  // Filters first, then ordering, then .range() strictly last.
  if (filters.contentType) query = query.eq("entry_type", filters.contentType)
  if (filters.typeSlug) query = query.eq("crime_slug", filters.typeSlug)
  if (filters.causeSlug) query = query.eq("cause_slug", filters.causeSlug)
  // linkFilter: "tracker" = has crime data, "wiki" = no crime data (wiki-only)
  // With the new view, entry_id is always set, so filter by crime_slug presence
  if (filters.linkFilter === "tracker") query = query.not("crime_slug", "is", null)
  if (filters.linkFilter === "wiki") query = query.is("crime_slug", null)
  if (filters.q)
    query = query.or(ilikeOr(filters.q, ["victim", "page_title", "location", "entry_title"]))

  return query
}

/** Files are keyed by DCW page title; a crime-less entry is a file of its own. */
function fileKey(row: CaseRow): string {
  return row.page_title || `entry-${row.entry_id}`
}

/**
 * Pulls the whole facet source in ≤1000-row windows.
 *
 * WHY the loop: PostgREST caps a single response at 1000 rows, so the old
 * `.limit(3000)` silently returned only the alphabetically-first page — which
 * made "Cases" read 1000 instead of 2010 and undercounted every tally built
 * from these rows.
 *
 * WHY `count: "exact"`: it is the loop's stop condition. A range whose offset
 * is past the last row is a 416, so the walk has to know when it has reached
 * the end rather than discovering it with one more request.
 */
async function fetchFacetRows(supabase: SupabaseServerClient): Promise<{
  rows: FacetRow[]
  total: number
  error: PostgrestError | null
}> {
  const rows: FacetRow[] = []
  let total = 0

  for (let offset = 0; offset < FACET_LIMIT; offset += FACET_PAGE_SIZE) {
    const { data, count, error } = await supabase
      .from(CASES_VIEW)
      .select("crime_slug, cause_slug, entry_type, page_title, entry_id, case_index", {
        count: "exact",
      })
      // A stable, unique sort is what makes window N+1 disjoint from window N.
      // Without ORDER BY, Postgres is free to reshuffle rows between requests,
      // which would double-count some cases and drop others.
      //
      // ORDER BY id is NOT that sort here: the view mints a fresh
      // gen_random_uuid() for every entry that has no crime data, so the key
      // changes from one request to the next and the windows overlap anyway.
      // (entry_id, case_index) is the view's real key — one row per crime,
      // identical across requests. page_title is the third key so the sort is
      // still total if the view ever returns crime rows with no entry (those
      // have a NULL entry_id and can share a case_index).
      .order("entry_id", { ascending: true })
      .order("case_index", { ascending: true })
      .order("page_title", { ascending: true })
      .range(offset, offset + FACET_PAGE_SIZE - 1)

    if (error) return { rows, total, error }

    const window = (data ?? []) as FacetRow[]
    rows.push(...window)
    if (typeof count === "number") total = count

    // Stop before asking for a range past the end — PostgREST answers those
    // with a 416. A short window means exhausted; `total` covers the case where
    // the row count is an exact multiple of FACET_PAGE_SIZE.
    if (window.length < FACET_PAGE_SIZE || rows.length >= total) break
  }

  return { rows, total: total || rows.length, error: null }
}

function buildHref(params: {
  format?: string | null
  type?: string | null
  cause?: string | null
  q?: string | null
  sort?: string | null
  link?: string | null
  page?: number | null
}): string {
  const search = new URLSearchParams()
  if (params.format) search.set("format", params.format)
  if (params.type) search.set("type", params.type)
  if (params.cause) search.set("cause", params.cause)
  if (params.q) search.set("q", params.q)
  if (params.sort && params.sort !== DEFAULT_SORT) search.set("sort", params.sort)
  if (params.link && params.link !== "all") search.set("link", params.link)
  if (params.page && params.page > 1) search.set("page", String(params.page))
  const qs = search.toString()
  return qs ? `/cases?${qs}` : "/cases"
}

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{
    format?: string
    type?: string
    cause?: string
    q?: string
    page?: string
    sort?: string
    link?: string
  }>
}) {
  const sp = await searchParams

  // Ignore slugs that aren't canonical groups: links bookmarked before the
  // reclassification (?type=murder-past) would otherwise return zero rows and
  // look like the archive was empty.
  const rawType = sp.type?.trim() || ""
  const rawCause = sp.cause?.trim() || ""
  const rawFormat = sp.format?.trim() || ""
  const typeSlug = isCrimeGroupSlug(rawType) ? rawType : ""
  const causeSlug = isMethodGroupSlug(rawCause) ? rawCause : ""
  const contentType = CONTENT_TYPE_VALUES.has(rawFormat) ? rawFormat : ""
  const sort = SORT_VALUES.has(sp.sort ?? "") ? (sp.sort as string) : DEFAULT_SORT
  const linkFilter = LINK_VALUES.has(sp.link ?? "") ? (sp.link as string) : "all"
  const q = sp.q?.trim().slice(0, 80) ?? ""
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)
  const from = (page - 1) * PAGE_SIZE

  const supabase = await createClient()
  const filters: CaseFilters = { contentType, typeSlug, causeSlug, linkFilter, q }

  // The window carries one row on each side of this page's range: the row
  // before it shows which file the page starts inside, the row after it shows
  // whether the page's last file continues. See the trim below.
  const windowFrom = page > 1 ? from - 1 : 0
  const windowTo = from + PAGE_SIZE

  // Facet tallies and the page rows are independent reads of the same view —
  // run them concurrently so /cases costs max(read), not the serial sum (each
  // side is itself a multi-window paged pull on a big view).
  const [facetResult, pageResult] = await Promise.all([
    fetchFacetRows(supabase),
    (async () => {
      let query = casesQuery(supabase, filters)

      // entry_release_order is a real view column precisely so this is a plain
      // top-level order — ordering by an embedded column is a silent no-op.
      // NULLs (cases with no local entry) trail on ASC.
      if (sort === "type") query = query.order("crime_slug", { ascending: true })
      if (sort === "release" || sort === "type") {
        // Content type FIRST, so a series stays contiguous: every content type
        // numbers its episodes from 1, and keying on entry_episode_number first
        // put Magic Kaito EP 1 beside Conan EP 1 with page_title breaking the
        // tie. Grouping the sort also means sections never interleave across a
        // page boundary.
        query = query.order("entry_type", { ascending: true })
        // Within a type: episode number, then release order (movies/specials).
        query = query
          .order("entry_episode_number", { ascending: true, nullsFirst: false })
          .order("entry_release_order", { ascending: true, nullsFirst: false })
      }
      query = query
        .order("page_title", { ascending: sort !== "za" })
        .order("case_index", { ascending: true })
        // Every entry without crime data is tied on both keys above (page_title
        // and case_index are NULL), and a tie has no defined order across two
        // requests — so paging over them could show one entry twice and skip
        // another. entry_id is the view's real key; it makes the sort total.
        .order("entry_id", { ascending: true })
        .range(windowFrom, windowTo)

      return query
    })(),
  ])

  const { rows: facetRows, error: facetError } = facetResult
  // The migration is applied by hand, so an unmigrated database is a real
  // state to render rather than a crash.
  if (facetError) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <FileText className="mx-auto h-8 w-8 text-ink-faint" />
        <h1 className="mt-4 font-display text-xl tracking-tight text-ink">
          Case Files aren&apos;t ready yet
        </h1>
        <p className="mt-2 text-sm text-ink-dim">
          The crime archive hasn&apos;t been set up on this database. An admin needs to run the{" "}
          <code className="font-mono text-xs text-ink">migration-case-files.sql</code> migration,
          then the crime sync.
        </p>
      </div>
    )
  }

  const crimeFacets = tally(facetRows, "crime")
  const crimeDistribution = buildCrimeDistribution(crimeFacets)
  const methodFacets = tally(facetRows, "cause")

  // The view's rows are crime records AND entries that carry no crime data at
  // all (a LEFT JOIN row with every crime column NULL), so neither header
  // number can be read off the row count: a file with three crimes is three
  // rows, and an entry with no crime data is a row that is nobody's crime.
  // Both are exact while the archive stays under FACET_LIMIT — the same ceiling
  // the tallies above live under.
  const crimeRows = facetRows.reduce((n, row) => n + (row.crime_slug ? 1 : 0), 0)
  const noCrimeRows = facetRows.length - crimeRows
  const fileTitles = new Set<string>()
  for (const row of facetRows) if (row.page_title) fileTitles.add(row.page_title)
  // Files, counted one per dossier page. Adding noCrimeRows to a page count
  // mixed two units: an entry with three case pages is three files AND one
  // entry, so the old total (1,474) exceeded the number of entries that exist
  // (1,371). Coverage is stated separately instead.
  const caseFileTotal = fileTitles.size
  const coverage = summarizeCoverage(facetRows)

  // Content type options: real counts, domain order, zero-count types omitted.
  const typeCounts = new Map<string, number>()
  for (const row of facetRows) {
    if (row.entry_type) typeCounts.set(row.entry_type, (typeCounts.get(row.entry_type) ?? 0) + 1)
  }
  const contentTypeOptions: FilterOption[] = CONTENT_TYPE_ORDER.filter((type) =>
    typeCounts.has(type)
  ).map((type) => ({
    value: type,
    label: contentTypeLabel(type),
    count: typeCounts.get(type) ?? 0,
  }))

  const trackerLinked = [...typeCounts.values()].reduce((sum, n) => sum + n, 0)

  // Category counts as ENTRIES, not crime rows: a three-crime episode is one
  // episode, and "Movies 34" is the number a reader can check.
  const entriesByType = new Map<string, Set<string>>()
  for (const row of facetRows) {
    if (!row.entry_type || !row.entry_id) continue
    const set = entriesByType.get(row.entry_type)
    if (set) set.add(row.entry_id)
    else entriesByType.set(row.entry_type, new Set([row.entry_id]))
  }
  const categoryOptions: CategoryOption[] = [
    {
      value: "",
      label: "All",
      count: [...entriesByType.values()].reduce((sum, set) => sum + set.size, 0),
    },
    ...CONTENT_TYPE_ORDER.filter((type) => entriesByType.has(type)).map((type) => ({
      value: type,
      label: CONTENT_TYPE_LABELS[type],
      count: entriesByType.get(type)?.size ?? 0,
    })),
  ]

  const { data: caseData, count } = pageResult
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const ownOffset = from - windowFrom
  const windowRows = (caseData ?? []) as CaseRow[]
  const ownRows = windowRows.slice(ownOffset, ownOffset + PAGE_SIZE)
  const lookbehind = ownOffset > 0 ? windowRows[0] : undefined
  const lookahead =
    ownOffset + PAGE_SIZE < windowRows.length ? windowRows[ownOffset + PAGE_SIZE] : undefined

  // Rows are paged but files are grouped in memory, so a file whose crimes
  // straddle a page boundary would print twice — half its crimes at the foot of
  // one page, the rest at the top of the next. Print whole files instead: drop
  // the file the previous page already printed whole, and read in the rest of
  // the file this page starts. That costs one query, and only on the pages where
  // a boundary actually falls inside a file.
  let lead = 0
  if (lookbehind) {
    const key = fileKey(lookbehind)
    while (lead < ownRows.length && fileKey(ownRows[lead]) === key) lead++
  }
  let rows = ownRows.slice(lead)

  const lastRow = rows.length > 0 ? rows[rows.length - 1] : undefined
  if (lastRow?.page_title && lookahead && fileKey(lookahead) === fileKey(lastRow)) {
    const { data: remainder } = await casesQuery(supabase, filters)
      .eq("page_title", lastRow.page_title)
      .order("case_index", { ascending: true })
    const whole = (remainder ?? []) as CaseRow[]
    const held = rows.filter((row) => row.page_title === lastRow.page_title).length
    if (whole.length > held) {
      rows = [...rows.filter((row) => row.page_title !== lastRow.page_title), ...whole]
    }
  }

  // Cover art lives on content_entries.image_url; the archive view does not
  // expose it, so it comes in one extra query keyed by the entries on this
  // page. 1,371 of 1,371 entries have artwork, so a missing image means the
  // row genuinely has none rather than that the page forgot to ask.
  const pageEntryIds = Array.from(
    new Set(rows.map((row) => row.entry_id).filter((id): id is string => Boolean(id)))
  )
  const artById = new Map<string, string | null>()
  if (pageEntryIds.length > 0) {
    const { data: artRows } = await supabase
      .from("content_entries")
      .select("id, image_url")
      .in("id", pageEntryIds)
    for (const art of artRows ?? []) artById.set(art.id, art.image_url)
  }

  const caseFiles = mergeCases(rows).map((file) => ({
    ...file,
    imageUrl: file.entryId ? (artById.get(file.entryId) ?? null) : null,
  }))
  const caseSections = groupFilesByType(caseFiles, CONTENT_TYPE_ORDER, CONTENT_TYPE_LABELS)

  const firstShown = total === 0 ? 0 : from + lead + 1
  const lastShown = Math.min(from + ownRows.length, total)
  // Pagination counts ROWS (one per crime, plus one per entry with no case at
  // all), but the page renders FILES, and the row total includes 637 "no case
  // on file" placeholders. Quoting a row range here put "of 2,655" beside a
  // masthead reading "2,018 crimes" — two totals for the same archive. The
  // page position says where the reader is without inventing a third number.
  const resultSummary =
    total === 0
      ? "No files"
      : `${caseFiles.length.toLocaleString()} ${caseFiles.length === 1 ? "file" : "files"} · page ${page.toLocaleString()} of ${totalPages.toLocaleString()}`

  return (
    <div className="px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-5xl">
        {/* ── Dossier cover ── */}
        <header className="border-t-2 border-ink pt-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5 text-ink-faint">
              <FileText className="h-3.5 w-3.5" />
              <span className="font-mono text-[10px] uppercase tracking-[0.18em]">Case archive</span>
            </span>
            <span className="h-3 w-px bg-line" aria-hidden="true" />
            <span className="rounded border border-danger/30 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-danger/80">
              Spoilers sealed
            </span>
          </div>

          <h1 className="mt-3 font-display text-3xl leading-tight tracking-tight text-ink sm:text-[2.75rem]">
            Every crime in the franchise
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-dim">
            Filed by type, method and location, sourced from Detective Conan World. Case summaries
            stay sealed until you open them — they name the culprit.
          </p>

          {/* One line, each fact once. The four-tile band that stood here
              restated numbers the controls below already carry: the crime
              count is the crime-mix total, the entry count is the All tab,
              "12 categories" is the twelve pills, "17 methods" is the Method
              menu. Only the coverage figure appears nowhere else — it is the
              one thing a reader cannot infer, so it leads. */}
          <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-3 font-mono text-[11px] tabular-nums text-ink-dim">
            <span className="text-ink">{crimeRows.toLocaleString()} crimes</span>
            <span className="text-ink-faint/60" aria-hidden="true">·</span>
            <span className="text-ink">{caseFileTotal.toLocaleString()} case files</span>
            <span className="text-ink-faint/60" aria-hidden="true">·</span>
            <span>
              {coverage.covered.toLocaleString()} of {coverage.total.toLocaleString()} entries
              have a case ({coverage.percent}%)
            </span>
          </p>

        </header>

        {/* ── The shape of the archive ── */}
        <div className="mt-8">
          <CrimeSpectrum
            segments={crimeDistribution}
            activeSlug={typeSlug ?? ""}
            totalCrimes={crimeRows}
          />
        </div>

        {/* ── Categories: the archive's primary axis ── */}
        <div className="mt-6">
          <CategoryRail
            options={categoryOptions}
            active={contentType ?? ""}
            hrefFor={(value) =>
              buildHref({
                format: value || null,
                type: typeSlug,
                cause: causeSlug,
                q,
                sort,
                link: linkFilter,
                page: 1,
              })
            }
          />
        </div>

        {/* ── Narrow it down ── */}
        <CaseFilterBar
          q={q}
          contentType={contentType}
          typeSlug={typeSlug}
          causeSlug={causeSlug}
          sort={sort}
          link={linkFilter}
          contentTypeOptions={contentTypeOptions}
          crimeOptions={crimeFacets.map((f) => ({
            value: f.slug,
            label: f.label,
            count: f.count,
          }))}
          methodOptions={methodFacets.map((f) => ({
            value: f.slug,
            label: f.label,
            count: f.count,
          }))}
          sortOptions={SORT_OPTIONS}
          linkOptions={LINK_OPTIONS}
          defaultSort={DEFAULT_SORT}
        />

        {/* ── Ledger ── */}
        {caseFiles.length === 0 ? (
          <p className="mt-8 rounded-lg border border-dashed border-line px-4 py-16 text-center text-sm text-ink-dim">
            No files match these filters.
          </p>
        ) : (
          <div className="mt-6 space-y-8">
            {caseSections.map((section, sectionIndex) => (
              <section
                key={section.type || "other"}
                aria-labelledby={`sec-${section.type}`}
              >
                {/* Always labelled: the section name is the answer to "what am
                    I looking at", and page 1 of an unfiltered archive is all
                    Episodes, so hiding the lone heading would leave the reader
                    with an unlabelled list. */}
                <div className="flex items-baseline justify-between gap-3 border-b border-ink pb-1.5">
                  <h2
                    id={`sec-${section.type}`}
                    className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink"
                  >
                    {section.label}
                  </h2>
                  <span className="font-mono text-[10px] tabular-nums text-ink-faint">
                    {/* Count and page position sit with the results they
                        describe, not inside the filter controls. */}
                    {sectionIndex === 0 ? resultSummary : `${section.files.length} files`}
                  </span>
                </div>
                <ol className="border-t border-line">
                  {section.files.map((file) => (
                    <CaseFileRow key={file.pageTitle} file={file} />
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <nav className="mt-6 flex items-center justify-center gap-3 pb-2">
            {page > 1 ? (
              <Link
                href={buildHref({
                  format: contentType || null,
                  type: typeSlug,
                  cause: causeSlug,
                  q,
                  sort,
                  link: linkFilter,
                  page: page - 1,
                })}
                className="rounded-md border border-line bg-surface px-3 py-1.5 font-mono text-[11px] text-ink-dim transition-colors hover:border-ink hover:text-ink"
              >
                Prev
              </Link>
            ) : (
              <span className="rounded-md border border-line px-3 py-1.5 font-mono text-[11px] text-ink-faint opacity-40">
                Prev
              </span>
            )}
            <span className="font-mono text-[11px] tabular-nums text-ink-dim">
              Page {page} / {totalPages}
            </span>
            {page < totalPages ? (
              <Link
                href={buildHref({
                  format: contentType || null,
                  type: typeSlug,
                  cause: causeSlug,
                  q,
                  sort,
                  link: linkFilter,
                  page: page + 1,
                })}
                className="rounded-md border border-line bg-surface px-3 py-1.5 font-mono text-[11px] text-ink-dim transition-colors hover:border-ink hover:text-ink"
              >
                Next
              </Link>
            ) : (
              <span className="rounded-md border border-line px-3 py-1.5 font-mono text-[11px] text-ink-faint opacity-40">
                Next
              </span>
            )}
          </nav>
        )}

        <p className="mt-8 border-t border-line pt-4 font-mono text-[10px] text-ink-faint">
          Crime data from{" "}
          <a
            href="https://www.detectiveconanworld.com/wiki/Main_Page"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted hover:text-ink-dim"
          >
            Detective Conan World
          </a>
          .
        </p>
      </div>
    </div>
  )
}

/* ──────────────────────── Small server-rendered helpers ──────────────────────── */

