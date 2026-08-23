import Link from "next/link"
import { ExternalLink, FileText, MapPin } from "lucide-react"
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
  { value: "all", label: "All episodes" },
  { value: "tracker", label: "With crime data" },
  { value: "wiki", label: "No crime data" },
]

/**
 * Per-group tinting. `card` colours the crime stamp on each file row;
 * `bar` colours the row's left spine.
 */
const CRIME_STYLES: Record<string, { card: string; bar: string }> = {
  murder: { card: "border-danger/30 bg-danger/10 text-danger", bar: "bg-danger" },
  "attempted-murder": { card: "border-danger/20 bg-danger/5 text-danger/90", bar: "bg-danger/60" },
  kidnapping: { card: "border-accent/30 bg-accent-soft text-accent-bright", bar: "bg-accent" },
  bombing: { card: "border-warning/25 bg-warning/10 text-warning", bar: "bg-warning" },
  assault: { card: "border-warning/20 bg-warning/5 text-warning/90", bar: "bg-warning/60" },
  robbery: { card: "border-accent/20 bg-accent-soft/50 text-accent-bright/90", bar: "bg-accent/60" },
  fraud: { card: "border-line bg-surface-muted text-ink", bar: "bg-ink" },
  suicide: { card: "border-line bg-surface-muted text-ink", bar: "bg-ink" },
  accident: { card: "border-line bg-surface-muted text-ink-dim", bar: "bg-ink-dim" },
  vandalism: { card: "border-line bg-surface-muted text-ink-dim", bar: "bg-ink-dim" },
  "missing-person": { card: "border-line bg-surface-muted text-ink-dim", bar: "bg-ink-dim" },
  other: { card: "border-line bg-transparent text-ink-faint", bar: "bg-ink-faint" },
}

const NEUTRAL_STYLE = { card: "border-line bg-surface-muted text-ink-dim", bar: "bg-ink-dim" }

function crimeStyle(slug: string) {
  return CRIME_STYLES[slug] ?? NEUTRAL_STYLE
}

function contentTypeLabel(type: string): string {
  return CONTENT_TYPE_LABELS[type as ContentType] ?? type
}

/** Higher = more severe. Drives spine colour + badge order for multi-crime files. */
const CRIME_SEVERITY: Record<string, number> = {
  "mass-murder": 110,
  "serial-murder": 105,
  murder: 100,
  "attempted-murder": 90,
  manslaughter: 85,
  bombing: 82,
  arson: 78,
  kidnapping: 75,
  "attempted-kidnapping": 70,
  assault: 60,
  poisoning: 58,
  robbery: 50,
  burglary: 46,
  theft: 44,
  blackmail: 40,
  extortion: 38,
  fraud: 34,
  forgery: 30,
  vandalism: 20,
  other: 10,
}

function crimeSeverity(slug: string | null | undefined): number {
  if (!slug) return 0
  return CRIME_SEVERITY[slug] ?? 15
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

  rows.forEach((row, index) => {
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
      startIndex: index,
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

    file.crimeBadges = Array.from(badges.values()).sort(
      (a, b) => crimeSeverity(b.slug) - crimeSeverity(a.slug)
    )
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

type CaseCrime = {
  id: string
  caseIndex: number
  crimeType: string
  crimeSlug: string
  victim: string | null
  victimLabel: string | null
  causeDeath: string | null
  causeDeathLabel: string | null
  suspects: string | null
  suspectsLabel: string | null
  location: string | null
  description: string | null
}

type CaseFile = {
  pageTitle: string
  startIndex: number
  dateText: string | null
  entryId: string | null
  entrySlug: string | null
  entryType: string | null
  entryEpisodeNumber: number | null
  entryReleaseOrder: number | null
  crimes: CaseCrime[]
  crimeBadges: { type: string; slug: string; count: number }[]
  primarySlug: string
  victims: string[]
  locations: string[]
}

const CASE_COLUMNS =
  "id, page_title, case_index, crime_type, crime_slug, cause_death, victim, victim_label, cause_death_label, suspects, suspects_label, location, description, date_text, entry_id, entry_slug, entry_type, entry_episode_number, entry_release_order, entry_title"

type FacetRow = { crime_slug: string; cause_slug: string | null; entry_type: string | null }
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

/**
 * Pulls the whole facet source in ≤1000-row windows.
 *
 * WHY the loop: PostgREST caps a single response at 1000 rows, so the old
 * `.limit(3000)` silently returned only the alphabetically-first page — which
 * made "Cases" read 1000 instead of 2010 and undercounted every tally built
 * from these rows.
 *
 * WHY `count: "exact"`: the total comes from the Content-Range header, which
 * the row cap does not touch. That keeps the hero count correct even if the
 * archive ever outgrows FACET_LIMIT and the tallies get clipped.
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
      .select("crime_slug, cause_slug, entry_type", { count: "exact" })
      // A stable, unique sort is what makes window N+1 disjoint from window N.
      // Without ORDER BY, Postgres is free to reshuffle rows between requests,
      // which would double-count some cases and drop others.
      .order("id", { ascending: true })
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

  const { rows: facetRows, total: facetTotal, error: facetError } = await fetchFacetRows(supabase)

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
  const methodFacets = tally(facetRows, "cause")
  const archiveTotal = facetTotal

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

  let query = supabase.from(CASES_VIEW).select(CASE_COLUMNS, { count: "exact" })

  // Filters first, then ordering, then .range() strictly last.
  if (contentType) query = query.eq("entry_type", contentType)
  if (typeSlug) query = query.eq("crime_slug", typeSlug)
  if (causeSlug) query = query.eq("cause_slug", causeSlug)
  // linkFilter: "tracker" = has crime data, "wiki" = no crime data (wiki-only)
  // With the new view, entry_id is always set, so filter by crime_slug presence
  if (linkFilter === "tracker") query = query.not("crime_slug", "is", null)
  if (linkFilter === "wiki") query = query.is("crime_slug", null)
  if (q) query = query.or(`victim.ilike.%${q}%,page_title.ilike.%${q}%,location.ilike.%${q}%,entry_title.ilike.%${q}%`)

  // entry_release_order is a real view column precisely so this is a plain
  // top-level order — ordering by an embedded column is a silent no-op.
  // NULLs (cases with no local entry) trail on ASC.
  if (sort === "type") query = query.order("crime_slug", { ascending: true })
  if (sort === "release" || sort === "type") {
    // Sort by episode number first (episodes), then release order (movies/specials)
    query = query
      .order("entry_episode_number", { ascending: true, nullsFirst: false })
      .order("entry_release_order", { ascending: true, nullsFirst: false })
  }
  query = query
    .order("page_title", { ascending: sort !== "za" })
    .order("case_index", { ascending: true })
    .range(from, from + PAGE_SIZE - 1)

  const { data: caseData, count } = await query
  const cases = (caseData ?? []) as CaseRow[]
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const caseFiles = mergeCases(cases)

  const firstShown = total === 0 ? 0 : from + 1
  const lastShown = Math.min(from + cases.length, total)
  const resultSummary =
    total === 0
      ? "No files"
      : `${firstShown.toLocaleString()}–${lastShown.toLocaleString()} of ${total.toLocaleString()} crimes archived`

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

          <dl className="mt-6 grid grid-cols-2 gap-4 border-y border-line py-4 sm:flex sm:flex-wrap sm:gap-x-10 sm:gap-y-3">
            <Stat label="Crimes" value={archiveTotal} />
            <Stat label="Files" value={caseFiles.length > 0 ? Math.ceil(total / PAGE_SIZE) : 0} />
            <Stat label="Categories" value={crimeFacets.length} />
            <Stat label="Methods" value={methodFacets.length} />
          </dl>
        </header>

        {/* ── Filter console ── */}
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
          resultSummary={resultSummary}
        />

        {/* ── Ledger ── */}
        {caseFiles.length === 0 ? (
          <p className="mt-8 rounded-lg border border-dashed border-line px-4 py-16 text-center text-sm text-ink-dim">
            No files match these filters.
          </p>
        ) : (
          <ol className="mt-6">
            {caseFiles.map((file) => {
              const style = crimeStyle(file.primarySlug)
              const fileNo = String(from + file.startIndex + 1).padStart(4, "0")
              const isEpisode = file.entryType === CONTENT_TYPES.EPISODE
              const episodeNumber = isEpisode ? file.entryEpisodeNumber : null
              const trackerHref =
                episodeNumber !== null && episodeNumber !== undefined
                  ? `/tracker?ep=${episodeNumber}`
                  : file.entrySlug
                    ? `/tracker/${file.entrySlug}`
                    : null
              const isMulti = file.crimes.length > 1
              const primary = file.crimes[0] ?? null

              return (
                <li key={file.pageTitle} className="relative">
                  {/* Left spine — carries the colour of the most severe crime in the file. */}
                  <span
                    aria-hidden="true"
                    className={cn("absolute bottom-0 left-0 top-0 w-[3px]", style.bar)}
                  />

                  <div className="border-b border-line px-4 py-4 pl-5 transition-colors hover:bg-surface-muted/40 sm:pl-7">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
                      <div className="flex flex-wrap items-baseline gap-x-2.5">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
                          File no. {fileNo}
                        </span>
                        {file.dateText && (
                          <span className="font-mono text-[10px] text-ink-faint">{file.dateText}</span>
                        )}
                      </div>

                      <span className="flex flex-wrap items-center gap-1">
                        {file.crimeBadges.map((badge) => (
                          <span
                            key={badge.slug || badge.type}
                            className={cn(
                              "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide",
                              crimeStyle(badge.slug).card
                            )}
                            title={`Filed under ${crimeGroupLabel(badge.slug)}`}
                          >
                            {badge.type}
                            {badge.count > 1 && (
                              <span className="ml-1 opacity-70">&times;{badge.count}</span>
                            )}
                          </span>
                        ))}
                      </span>
                    </div>

                    <h2 className="mt-1 font-display text-base tracking-tight text-ink sm:text-lg">
                      {file.pageTitle}
                      {isMulti && (
                        <span className="ml-1.5 font-mono text-[10px] text-danger">
                          {file.crimes.length} crimes
                        </span>
                      )}
                    </h2>

                    {isMulti ? (
                      <>
                        {/* Roll-up so the collapsed card still says who and where. */}
                        <dl className="mt-2.5 grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                          {file.victims.length > 0 && (
                            <Field
                              label={file.victims.length > 1 ? "Victims" : primary.victimLabel ?? "Victim"}
                              value={file.victims.join(", ")}
                            />
                          )}
                          {file.locations.length > 0 && (
                            <Field
                              label={file.locations.length > 1 ? "Locations" : "Location"}
                              value={file.locations.join(", ")}
                              icon={<MapPin className="h-3 w-3" />}
                            />
                          )}
                        </dl>

                        <details className="group/crimes mt-3">
                          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-line bg-surface-muted px-2 py-1 font-mono text-[10px] text-ink-dim transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 [&::-webkit-details-marker]:hidden">
                            <span className="group-open/crimes:hidden">
                              Open all {file.crimes.length} crime blocks
                            </span>
                            <span className="hidden group-open/crimes:inline">Collapse crime blocks</span>
                            <span className="text-[9px] transition-transform group-open/crimes:rotate-180">
                              &#9660;
                            </span>
                          </summary>

                          <ol className="mt-3 space-y-3 border-l border-line/60 pl-3">
                            {file.crimes.map((crime) => (
                              <li key={crime.id}>
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
                                    Case {crime.caseIndex}
                                  </span>
                                  <span
                                    className={cn(
                                      "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide",
                                      crimeStyle(crime.crimeSlug).card
                                    )}
                                    title={`Filed under ${crimeGroupLabel(crime.crimeSlug)}`}
                                  >
                                    {crime.crimeType}
                                  </span>
                                </div>

                                <CrimeFieldGrid crime={crime} />
                                {crime.description && (
                                  <CaseSummarySpoiler description={crime.description} />
                                )}
                              </li>
                            ))}
                          </ol>
                        </details>
                      </>
                    ) : file.crimes.length === 1 ? (
                      <>
                        <CrimeFieldGrid crime={primary} />
                        {primary.description && (
                          <CaseSummarySpoiler description={primary.description} />
                        )}
                      </>
                    ) : (
                      <p className="mt-2 text-xs text-ink-faint italic">
                        No crime data available for this entry.
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-4">
                      {trackerHref && (
                        <Link
                          href={trackerHref}
                          className="font-mono text-[10px] text-accent-bright underline decoration-dotted transition-colors hover:text-accent"
                        >
                          {episodeNumber !== null
                            ? `open episode ${episodeNumber} in tracker →`
                            : "open in tracker →"}
                        </Link>
                      )}
                      {file.pageTitle && file.pageTitle !== "Unknown" && (
                        <a
                          href={dcwPageUrl(file.pageTitle)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-[10px] text-ink-faint underline decoration-dotted transition-colors hover:text-ink-dim"
                        >
                          read on DCW
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">{label}</dt>
      <dd className="font-display text-2xl tabular-nums text-ink">{value.toLocaleString()}</dd>
    </div>
  )
}

function Field({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon?: React.ReactNode
}) {
  return (
    <div className="min-w-0 break-words">
      <dt className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px] text-ink">{value}</dd>
    </div>
  )
}

function CrimeFieldGrid({ crime }: { crime: CaseCrime }) {
  return (
    <dl className="mt-2.5 grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
      {crime.victim && <Field label={crime.victimLabel ?? "Victim"} value={crime.victim} />}
      {crime.causeDeath && (
        <Field label={crime.causeDeathLabel ?? "Cause of death"} value={crime.causeDeath} />
      )}
      {crime.location && (
        <Field label="Location" value={crime.location} icon={<MapPin className="h-3 w-3" />} />
      )}
      {crime.suspects && (
        <Field label={crime.suspectsLabel ?? "Suspects"} value={crime.suspects} />
      )}
    </dl>
  )
}

function CaseSummarySpoiler({ description }: { description: string }) {
  return (
    <details className="group/spoiler mt-3">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-line bg-surface-muted px-2 py-1 font-mono text-[10px] text-ink-dim transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 [&::-webkit-details-marker]:hidden">
        <span className="group-open/spoiler:hidden">Unseal case summary (spoilers)</span>
        <span className="hidden group-open/spoiler:inline">Reseal summary</span>
      </summary>
      <p className="mt-2 select-none text-sm leading-relaxed text-ink-dim blur-sm transition-[filter] duration-200 group-open/spoiler:select-text group-open/spoiler:blur-none">
        {description}
      </p>
    </details>
  )
}
