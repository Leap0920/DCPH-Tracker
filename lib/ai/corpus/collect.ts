/**
 * Reading the tracker half of the corpus back out of Postgres.
 *
 * The client is structural rather than `SupabaseClient`: this module has to be
 * exercised with a fake (constraint 11 -- a real admin client would reach the
 * live project), and the route casts `createAdminClient()` into it.
 */

import { buildCorpusDocuments } from "@/lib/ai/corpus/build"
import type { CaseRow, ContentEntryRow } from "@/lib/ai/corpus/tracker"
import type { CorpusDocument } from "@/lib/ai/corpus/types"

export interface CollectClient {
  from(table: string): {
    select(columns: string): {
      range(
        from: number,
        to: number
      ): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
    }
  }
}

export interface CollectOptions {
  /** Default 500. PostgREST caps a response at 1,000 rows. */
  pageSize?: number
  /** Default 20_000 — a runaway guard, not an expectation. */
  maxRows?: number
}

type Row = Record<string, unknown>

const ENTRY_TABLE = "content_entries"
const CASE_TABLE = "dcw_cases"

/** Named so the payload stays bounded: both tables carry columns the corpus never reads. */
const ENTRY_COLUMNS =
  "id,slug,title,type,episode_number,movie_number,air_date,canon_order,release_order,arc_id,synopsis,dcw_title,crime_types"
const CASE_COLUMNS =
  "id,page_title,case_index,crime_type,cause_death,victim,suspects,location,description,entry_id"

const DEFAULT_PAGE_SIZE = 500
const DEFAULT_MAX_ROWS = 20_000

/**
 * `null` rather than `Number(undefined)`: an absent episode number is not
 * episode zero, and the builders tell "no number" apart from "number 0".
 */
function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return String(value)
}

/**
 * A `not null` column. It is mapped to "" rather than null so a broken row
 * shows up as an obviously wrong value instead of a `undefined` inside a
 * document id or a slug lookup.
 */
function requiredText(value: unknown): string {
  return asText(value) ?? ""
}

/**
 * Pages one table with inclusive `.range()` bounds until a short page arrives.
 *
 * A short page -- fewer rows than asked for -- is the only end signal PostgREST
 * offers; asking for one extra empty page would cost a round trip on every run.
 */
async function selectPaged(
  client: CollectClient,
  table: string,
  columns: string,
  options: { pageSize: number; maxRows: number }
): Promise<Row[]> {
  const rows: Row[] = []

  for (let from = 0; ; from = from + options.pageSize) {
    // Clamped so the runaway guard is exact: an unclamped request could read up
    // to pageSize - 1 rows past maxRows.
    const to = Math.min(from + options.pageSize, options.maxRows) - 1
    const { data, error } = await client.from(table).select(columns).range(from, to)

    // A silently dropped catalog would surface weeks later as a bot that
    // answers from half its episodes, so a read error fails the whole run.
    if (error) throw new Error(`[ai-corpus] reading ${table} failed: ${error.message}`)

    const page = data ?? []
    rows.push(...page)

    if (page.length < to - from + 1) break
    if (rows.length >= options.maxRows) break
  }

  return rows
}

function toEntryRow(row: Row): ContentEntryRow {
  return {
    id: requiredText(row.id),
    slug: requiredText(row.slug),
    title: requiredText(row.title),
    type: requiredText(row.type),
    episode_number: asNumber(row.episode_number),
    movie_number: asNumber(row.movie_number),
    air_date: asText(row.air_date),
    canon_order: asNumber(row.canon_order),
    release_order: asNumber(row.release_order),
    arc_id: asText(row.arc_id),
    synopsis: asText(row.synopsis),
    dcw_title: asText(row.dcw_title),
    // The column is `not null default '{}'`, so an absent key means the empty
    // array rather than "unknown" -- and an empty array keeps the metadata
    // column free of a meaningless `crime_types: []`.
    crime_types: Array.isArray(row.crime_types) ? row.crime_types.map(String) : [],
  }
}

function toCaseRow(row: Row): CaseRow {
  return {
    id: requiredText(row.id),
    page_title: requiredText(row.page_title),
    // The column is `not null default 1`, and the document id embeds the index:
    // an absent value must not become `case:foo#NaN`.
    case_index: asNumber(row.case_index) ?? 1,
    crime_type: asText(row.crime_type),
    cause_death: asText(row.cause_death),
    victim: asText(row.victim),
    suspects: asText(row.suspects),
    location: asText(row.location),
    description: asText(row.description),
    entry_id: asText(row.entry_id),
  }
}

export async function collectTrackerRows(
  client: CollectClient,
  options: CollectOptions = {}
): Promise<{ entries: ContentEntryRow[]; cases: CaseRow[] }> {
  const paging = {
    pageSize: options.pageSize ?? DEFAULT_PAGE_SIZE,
    maxRows: options.maxRows ?? DEFAULT_MAX_ROWS,
  }

  // Independent reads: the case table is small next to the catalog, so running
  // them together costs one round trip's latency instead of two.
  const [entries, cases] = await Promise.all([
    selectPaged(client, ENTRY_TABLE, ENTRY_COLUMNS, paging),
    selectPaged(client, CASE_TABLE, CASE_COLUMNS, paging),
  ])

  return { entries: entries.map(toEntryRow), cases: cases.map(toCaseRow) }
}

export async function collectCorpus(
  client: CollectClient,
  options: CollectOptions = {}
): Promise<CorpusDocument[]> {
  const { entries, cases } = await collectTrackerRows(client, options)
  return buildCorpusDocuments({ entries, cases })
}
