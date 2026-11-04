/**
 * View logic for the Case Files archive.
 *
 * Kept out of the page so it can be tested without React or Supabase: the
 * facets arrive as plain rows and the files as a plain list, so everything
 * here is a pure function of those two inputs.
 *
 * Self-contained on purpose — it duplicates a ~10-line rounding helper rather
 * than importing the arcs module, so the two surfaces can evolve apart.
 */

import { CONTENT_TYPES, CONTENT_TYPE_LABELS, type ContentType } from "@/lib/constants"

export interface CrimeFacet {
  slug: string
  label: string
  count: number
}

/** One proportional slice of the archive's crime mix. */
export interface CrimeSegment extends CrimeFacet {
  /** Share of all classified crimes, to one decimal. Segments sum to 100. */
  widthPercent: number
}

/**
 * Severity by CANONICAL GROUP slug.
 *
 * The archive view stores group slugs in `crime_slug` (~250 raw crime values
 * collapse to 12 groups), so this table must be keyed by those 12 and nothing
 * else. It previously held raw crime names — poisoning, arson, blackmail and
 * eight others — which never matched a row, and three real groups (suicide,
 * accident, missing person) had no entry at all. Every one of those silently
 * took the `?? 15` fallback, so a suicide case sorted below vandalism and the
 * badge order on every multi-crime file was partly arbitrary.
 */
export const CRIME_SEVERITY: Record<string, number> = {
  murder: 100,
  "attempted-murder": 90,
  bombing: 82,
  kidnapping: 75,
  assault: 60,
  robbery: 50,
  fraud: 34,
  "missing-person": 28,
  suicide: 24,
  accident: 20,
  vandalism: 18,
  other: 10,
}

/** Unknown slugs rank below every known group but above nothing. */
export function crimeSeverity(slug: string | null | undefined): number {
  if (!slug) return 0
  return CRIME_SEVERITY[slug] ?? 5
}

/** Anything sortable by crime group: a file badge uses `type`, a crime uses `label`. */
export interface CrimeSortable {
  slug: string
  label?: string
  type?: string
}

/** Most severe first; name breaks ties so the order is stable. */
export function compareCrimes(a: CrimeSortable, b: CrimeSortable): number {
  const bySeverity = crimeSeverity(b.slug) - crimeSeverity(a.slug)
  if (bySeverity !== 0) return bySeverity
  return (a.label ?? a.type ?? "").localeCompare(b.label ?? b.type ?? "")
}

/**
 * Turn facet counts into a proportional strip.
 *
 * Widths are rounded by largest remainder rather than independently: rounding
 * each share leaves up to 0.05% of slack per segment, and twelve of them leave
 * a visible gap at the end of the bar.
 */
export function buildCrimeDistribution(facets: CrimeFacet[]): CrimeSegment[] {
  const total = facets.reduce((sum, facet) => sum + facet.count, 0)
  if (total <= 0) return []

  const raw = facets.map((facet) => (facet.count / total) * 100)
  const rounded = roundPreservingTotal(raw, 100)

  return facets.map((facet, i) => ({ ...facet, widthPercent: rounded[i] }))
}

/** Round to one decimal without losing the total (largest remainder). */
function roundPreservingTotal(values: number[], total: number): number[] {
  const scaled = values.map((v) => v * 10)
  const floored = scaled.map(Math.floor)
  let remainder = Math.round(total * 10) - floored.reduce((a, b) => a + b, 0)

  const order = scaled
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)

  const result = [...floored]
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) {
    result[order[k].i] += 1
  }
  for (let k = order.length - 1; remainder < 0 && k >= 0; k--, remainder++) {
    if (result[order[k].i] > 0) result[order[k].i] -= 1
  }
  return result.map((v) => v / 10)
}

/** The fields of a case file this module needs to build a reference. */
export interface CaseRefInput {
  entryType: string | null
  entryEpisodeNumber: number | null
  entryReleaseOrder: number | null
  pageTitle: string
}

/**
 * A stable reference for a case file.
 *
 * The page used to print "File no. 0001", computed from the row's position in
 * the FILTERED result set — so the same case was 0001 unfiltered and 0002
 * under ?type=murder, and the number changed again on every page. A dossier
 * number that renumbers itself is decoration pretending to be an identifier.
 *
 * This returns something that actually identifies the record: the episode
 * number where there is one, otherwise the content type. Returns null when the
 * entry has neither, so the caller can omit the slot rather than print a
 * meaningless value.
 */
export function caseRef(file: CaseRefInput): string | null {
  const type = file.entryType
  if (type === CONTENT_TYPES.EPISODE) {
    // An episode with no number gets nothing: "EPISODE" beside a title that
    // already says which case it is adds no information, and "EP null" is
    // worse. Only the number is worth printing.
    return file.entryEpisodeNumber != null ? `EP ${file.entryEpisodeNumber}` : null
  }
  if (type && type in CONTENT_TYPE_LABELS) {
    return CONTENT_TYPE_LABELS[type as ContentType].toUpperCase()
  }
  return null
}

/** One crime inside a case file, as the archive view returns it. */
export interface CaseCrime {
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

/** One dossier page: every crime recorded against a single DCW entry. */
export interface CaseFile {
  pageTitle: string
  dateText: string | null
  /** Cover art from content_entries.image_url — the archive view omits it. */
  imageUrl?: string | null
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

/** One content-type block of the ledger, in domain order. */
export interface CaseSection {
  type: string
  label: string
  files: CaseFile[]
}

/**
 * Group the ledger into one section per content type.
 *
 * Without this the archive read as a single list in which Magic Kaito's own
 * episode 1 sat beside Conan's episode 1: the sort keyed on
 * entry_episode_number first, and both series number from 1, so page_title
 * broke the tie and shuffled the two together. Sections make the series
 * boundary explicit, and each one runs EP 1 → latest inside itself.
 *
 * Order follows CONTENT_TYPE_ORDER (episodes, movies, specials, …) rather than
 * whatever order the rows arrived in, so the page reads the same on every
 * request. Entries with no type land in a trailing section rather than being
 * dropped.
 */
export function groupFilesByType(
  files: CaseFile[],
  order: readonly string[],
  labels: Record<string, string>
): CaseSection[] {
  const buckets = new Map<string, CaseFile[]>()
  for (const file of files) {
    const key = file.entryType ?? ""
    const bucket = buckets.get(key)
    if (bucket) bucket.push(file)
    else buckets.set(key, [file])
  }

  const rank = new Map(order.map((type, i) => [type, i]))
  const sections: CaseSection[] = []
  for (const [type, bucket] of buckets) {
    sections.push({
      type,
      label: type === "" ? "Other" : (labels[type] ?? type),
      files: bucket,
    })
  }

  // Known types in domain order; anything unrecognised keeps its arrival order
  // after them, so an unknown type can never push Episodes off the top.
  return sections.sort((a, b) => {
    const ra = rank.has(a.type) ? (rank.get(a.type) as number) : Number.MAX_SAFE_INTEGER
    const rb = rank.has(b.type) ? (rank.get(b.type) as number) : Number.MAX_SAFE_INTEGER
    return ra - rb
  })
}

/**
 * How much of the catalogue actually has a case on file.
 *
 * The archive LEFT JOINs every content entry, so an entry DCW has no crime
 * template for still produces a row — with every crime column NULL. That is
 * 637 of 1,371 entries (53.5% coverage), so more than a third of the page was
 * rows that said nothing. The number is worth stating outright rather than
 * leaving the reader to infer it from a run of empty rows.
 */
export interface ArchiveCoverage {
  covered: number
  total: number
  percent: number
}

export function summarizeCoverage(
  rows: { entry_id: string | null; crime_slug: string | null }[]
): ArchiveCoverage {
  const total = new Set<string>()
  const covered = new Set<string>()
  for (const row of rows) {
    // Untracked crimes — rows in dcw_cases whose entry_id matches no content
    // entry — come through with a null entry_id. Counting null as a value made
    // the total 1,372 against 1,371 real entries.
    if (!row.entry_id) continue
    total.add(row.entry_id)
    if (row.crime_slug) covered.add(row.entry_id)
  }
  return {
    covered: covered.size,
    total: total.size,
    percent: total.size === 0 ? 0 : Math.round((covered.size / total.size) * 100),
  }
}

/** The archive's headline numbers, as one line for the masthead. */
export function summarizeArchive(input: {
  crimes: number
  files: number
  categories: number
  methods: number
}): { crimes: string; files: string; categories: number; methods: number } {
  return {
    crimes: input.crimes.toLocaleString(),
    files: input.files.toLocaleString(),
    categories: input.categories,
    methods: input.methods,
  }
}

/**
 * The single most severe crime group in a file — what the row's accent and
 * badge order key off. Null for an entry that carries no crime data.
 */
export function primaryCrime(
  crimes: { slug: string; label: string }[]
): { slug: string; label: string } | null {
  if (crimes.length === 0) return null
  return [...crimes].sort(compareCrimes)[0]
}
