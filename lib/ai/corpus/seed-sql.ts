/**
 * The offline catalog fixture: `supabase/seed-content.sql` read as rows.
 *
 * Every retrieval test and the recall@5 gate have to run in CI with no database
 * (constraint 12), and the catalog they need is already committed as a seed file.
 * Parsing that file is the cheapest way to give the eval real episode titles
 * without a network call and without a Postgres instance.
 *
 * This is not a SQL parser. It reads one known, generated file: a character
 * scanner over single-quoted literals, plus guards (arity, termination, a quoted
 * slug and title) that keep a mis-parse visible in `skipped` rather than silent.
 */

export interface SeedEntry {
  slug: string
  title: string
  type: string
  episodeNumber: number | null
  movieNumber: number | null
  airDate: string | null
  canonOrder: number | null
  synopsis: string | null
}

export interface SeedParseResult {
  rows: SeedEntry[]
  /** Lines that began with "(" but did not yield a usable row. Must be 0 on the real file. */
  skipped: number
}

/** One scanned value: its text with quotes unescaped, plus whether SQL quoted it. */
interface ScannedValue {
  text: string
  quoted: boolean
}

/**
 * The seed holds two insert statements with different shapes -- a plain
 * `VALUES` block and, at the end, a `from (values ...)` block -- but both put the
 * same values in the same leading positions:
 *
 *   slug, title, type, episode_number, movie_number, air_date, canon_order, arc_id, synopsis
 *
 * The first continues with `image_url, runtime_minutes, release_order`; the
 * second stops at `runtime_minutes`, and its seventh value is the computed `n`
 * the statement turns into `canon_order`. Reading only the leading nine is what
 * lets one parser serve both statements.
 */
const MIN_VALUES = 9

const SLUG = 0
const TITLE = 1
const TYPE = 2
const EPISODE_NUMBER = 3
const MOVIE_NUMBER = 4
const AIR_DATE = 5
const CANON_ORDER = 6
const SYNOPSIS = 8

/**
 * Splits one tuple line into its values, or returns null when the line is not a
 * terminated tuple. A character scanner rather than a regex on commas: values are
 * single-quoted with `''` as the escape (`'President''s Daughter Kidnapping
 * Case'`) and may contain both commas and parentheses inside the quotes
 * (`'Kenyu Densetsu Yaiba (1993), 52 eps'`), which a comma split would tear apart.
 */
function scanTuple(line: string): ScannedValue[] | null {
  const values: ScannedValue[] = []
  let text = ""
  let quoted = false
  let inQuote = false

  // The caller guarantees the line opens with "("; scanning starts inside it.
  for (let i = 1; i < line.length; i++) {
    const char = line[i]

    if (inQuote) {
      if (char !== "'") {
        text += char
      } else if (line[i + 1] === "'") {
        text += "'"
        i++
      } else {
        inQuote = false
      }
      continue
    }

    if (char === "'") {
      inQuote = true
      quoted = true
    } else if (char === ",") {
      values.push({ text: text.trim(), quoted })
      text = ""
      quoted = false
    } else if (char === ")") {
      // The tuple ends here. Everything after it -- a trailing comma,
      // `ON CONFLICT ...`, the next statement on the same line -- is not the row,
      // so the rest of the line is deliberately ignored.
      values.push({ text: text.trim(), quoted })
      return values
    } else {
      text += char
    }
  }

  // Ran off the end of the line: an unterminated quote or a missing ")".
  return null
}

/** Quoted values are strings; the NULL keyword and unquoted numbers are not. */
function stringValue(values: ScannedValue[], index: number): string | null {
  const value: ScannedValue | undefined = values[index]
  if (!value || !value.quoted) return null
  return value.text
}

/** Numbers are unquoted in the seed; `''`-quoted digits stay text, not numbers. */
function numberValue(values: ScannedValue[], index: number): number | null {
  const value: ScannedValue | undefined = values[index]
  if (!value || value.quoted) return null
  const parsed = Number.parseInt(value.text, 10)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Parses the catalog seed into entries. Pure: the SQL arrives as a string, so a
 * test can hand it a two-line fixture without a filesystem, and the eval fixture
 * can be built from the file once at module load instead of per call.
 */
export function parseSeedEntries(sql: string): SeedParseResult {
  const rows: SeedEntry[] = []
  let skipped = 0

  for (const line of sql.split("\n")) {
    const trimmed = line.trimStart()

    // A row always opens with a quoted slug. The file also holds a column list
    // and CTE expressions that begin with "(" (`  (slug, title, ...`,
    // `  (last.m + n) as canon_order, ...`); those are not rows, so counting
    // them in `skipped` would make the counter meaningless on a healthy file.
    if (!trimmed.startsWith("('")) continue

    const values = scanTuple(trimmed)
    if (!values || values.length < MIN_VALUES) {
      skipped++
      continue
    }

    // A row without a quoted slug and title cannot identify an entry -- and the
    // arity floor alone would let a nine-name column list through, so the two
    // identifying fields are part of what "usable row" means.
    const slug = stringValue(values, SLUG)
    const title = stringValue(values, TITLE)
    if (!slug || !title) {
      skipped++
      continue
    }

    rows.push({
      slug,
      title,
      type: stringValue(values, TYPE) ?? "",
      episodeNumber: numberValue(values, EPISODE_NUMBER),
      movieNumber: numberValue(values, MOVIE_NUMBER),
      airDate: stringValue(values, AIR_DATE),
      canonOrder: numberValue(values, CANON_ORDER),
      synopsis: stringValue(values, SYNOPSIS),
    })
  }

  return { rows, skipped }
}
