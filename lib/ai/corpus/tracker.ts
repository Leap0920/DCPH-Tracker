/**
 * The database half of the retrieval corpus: `content_entries` and `dcw_cases`
 * rows projected into retrievable documents.
 *
 * The row types are structural rather than the generated
 * `Database["public"]["Tables"]` ones on purpose: the builders have to be
 * testable without generated types, and both tables carry more columns than the
 * corpus cares about.
 */

import { CONTENT_TYPE_LABELS, type ContentType } from "@/lib/constants"
import type { CorpusDocument, DocMetadata } from "@/lib/ai/corpus/types"

export interface ContentEntryRow {
  id: string
  slug: string
  title: string
  type: string
  episode_number: number | null
  movie_number: number | null
  air_date: string | null
  canon_order: number | null
  release_order: number | null
  arc_id: string | null
  synopsis: string | null
  dcw_title: string | null
  /**
   * `text[] not null default '{}'` on the table, but optional here so a caller
   * that does not select the column still type-checks.
   */
  crime_types?: string[]
}

export interface CaseRow {
  id: string
  page_title: string
  case_index: number
  crime_type: string | null
  cause_death: string | null
  victim: string | null
  suspects: string | null
  location: string | null
  description: string | null
  entry_id: string | null
}

/** Joins the non-empty lines of a document body. */
function joinLines(lines: Array<string | null | undefined>): string {
  return lines.filter((line): line is string => Boolean(line)).join("\n")
}

/**
 * `DocMetadata` declares `arc_slug?: string`, so an explicit null cannot be
 * written as a declared property -- but a row with no arc is a fact about the
 * row, not a missing field, and the corpus records it as null rather than by
 * omitting the key. It therefore enters through the index signature.
 */
function arcSlugField(title: string | undefined): Record<string, unknown> {
  return { arc_slug: title ?? null }
}

/** "Episode 100" / "Movie 19" — the doc *is* that numbered entry. */
function numberLabel(row: ContentEntryRow): string | null {
  if (row.episode_number != null) return `Episode ${row.episode_number}`
  if (row.movie_number != null) return `Movie ${row.movie_number}`
  return null
}

/**
 * One line of D6 text: the case fields a reader would filter on, as the entry's
 * own `extra` signal. Absent fields are dropped rather than rendered as
 * "victim null".
 */
function caseLine(row: CaseRow): string {
  const head = [
    row.crime_type ? `${row.crime_type} case` : "Case",
    row.location ? `in ${row.location}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ")

  const details = [
    row.victim ? `victim ${row.victim}` : null,
    row.suspects ? `suspects ${row.suspects}` : null,
    row.description,
  ].filter((part): part is string => Boolean(part))

  return details.length > 0 ? `${head}: ${details.join("; ")}` : head
}

/**
 * One readable sentence per line: the FTS index is over `title || body`, and
 * the DCW wiki title is a real alternate name a user may type.
 */
function entryBody(row: ContentEntryRow, arcTitle: string | undefined): string {
  const label = CONTENT_TYPE_LABELS[row.type as ContentType] ?? row.type
  const number = numberLabel(row)
  return joinLines([
    row.synopsis,
    row.dcw_title ? `DCW: ${row.dcw_title}.` : null,
    `Type: ${label}.`,
    number ? `${number}.` : null,
    row.air_date ? `Aired: ${row.air_date}.` : null,
    arcTitle ? `Arc: ${arcTitle}.` : null,
  ])
}

/**
 * The `content_entries` half. `entryNumber`/`movieNumber` are set here because
 * this document *is* that numbered entry (R1 treats a number hit as
 * near-certain); the linked case text is injected as `metadata.case_text`,
 * which `toRankable()` surfaces as `extra` -- the same signal the old search
 * path gave `scoreEntry`.
 */
export function buildEntryDocs(
  entries: ContentEntryRow[],
  cases: CaseRow[] = [],
  options: { arcTitleById?: Map<string, string> } = {}
): CorpusDocument[] {
  // One pass over the cases rather than a filter per entry: the catalog alone
  // is ~1,300 rows.
  const casesByEntry = new Map<string, CaseRow[]>()
  for (const row of cases) {
    if (!row.entry_id) continue
    const linked = casesByEntry.get(row.entry_id)
    if (linked) linked.push(row)
    else casesByEntry.set(row.entry_id, [row])
  }

  return entries.map((entry): CorpusDocument => {
    const arcTitle = entry.arc_id ? options.arcTitleById?.get(entry.arc_id) : undefined
    const linked = casesByEntry.get(entry.id) ?? []
    const caseText = linked.length > 0 ? linked.map(caseLine).join("\n") : undefined

    return {
      id: `entry:${entry.slug}`,
      source: "content_entries",
      title: entry.title,
      body: entryBody(entry, arcTitle),
      url: `/tracker/${entry.slug}`,
      metadata: {
        slug: entry.slug,
        type: entry.type,
        air_date: entry.air_date ?? undefined,
        canon_order: entry.canon_order ?? undefined,
        release_order: entry.release_order ?? undefined,
        synopsis: entry.synopsis ?? undefined,
        dcw_title: entry.dcw_title ?? undefined,
        ...(entry.crime_types?.length ? { crime_types: entry.crime_types } : {}),
        ...(caseText ? { case_text: caseText } : {}),
        ...arcSlugField(arcTitle),
      },
      episodeNumber: entry.episode_number,
      movieNumber: entry.movie_number,
    }
  })
}

/**
 * The `dcw_cases` half. A case is retrievable in its own right, so a row with
 * no `entry_id` still gets a document.
 */
export function buildCaseDocs(cases: CaseRow[]): CorpusDocument[] {
  return cases.map((row): CorpusDocument => ({
    // D1: one wiki page holds several cases, so the page title alone is not a
    // key -- the case index disambiguates it.
    id: `case:${row.page_title}#${row.case_index}`,
    source: "dcw_cases",
    title: `${row.page_title} — case ${row.case_index}`,
    body: joinLines([
      row.victim ? `Victim: ${row.victim}.` : null,
      row.cause_death ? `Cause of death: ${row.cause_death}.` : null,
      row.suspects ? `Suspects: ${row.suspects}.` : null,
      row.location ? `Location: ${row.location}.` : null,
      row.crime_type ? `Crime: ${row.crime_type}.` : null,
      row.description,
    ]),
    url: "/cases",
    metadata: {
      page_title: row.page_title,
      case_index: row.case_index,
      crime_type: row.crime_type ?? undefined,
      victim: row.victim ?? undefined,
      suspects: row.suspects ?? undefined,
      location: row.location ?? undefined,
      cause_death: row.cause_death ?? undefined,
      description: row.description ?? undefined,
    },
  }))
}
