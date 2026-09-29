import { createClient } from "@/utils/supabase/server"
import { dcwQuery } from "@/lib/dcw"
import { isCrimeGroupSlug, isMethodGroupSlug } from "@/lib/dcw-cases"
import {
  buildOrFilter,
  buildWikiQueries,
  dedupeById,
  extractCulpritName,
  extractNumbers,
  firstWikiLinkTarget,
  isAppearancesTitle,
  isGalleryTitle,
  isJunkWikiExtract,
  isRelevantTitle,
  isSoftRedirect,
  matchCrimeMethod,
  matchSpecialKind,
  prefersEarliest,
  prefersList,
  prefersRecent,
  prioritizeResolution,
  queryWords,
  rankEntries,
  rankingTerms,
  searchTerms,
  scoreWikiTitle,
  searchTermGroups,
  tokenize,
  wantsAppearances,
  wantsCulprit,
} from "@/lib/chat/query"
import type { SpecialKind } from "@/lib/chat/query"
import type { Database } from "@/types/database.types"

type ContentRow = Database["public"]["Tables"]["content_entries"]["Row"]
type CaseRow = Database["public"]["Tables"]["dcw_cases"]["Row"]
type CrimeViewRow = Database["public"]["Views"]["all_episodes_with_crimes"]["Row"]

export interface DcwWikiResult {
  title: string
  url: string
  extract: string
  source: "dcw" | "wikipedia"
  /** Set when the extract is a DCW "X Appearances" episode list. */
  appearancesList?: { count: number; shown: number }
}

/** DCW's own "Resolution" section for a case the user asked about. */
export interface CaseResolution {
  label: string
  url: string
  text: string
  /** The real culprit's name, when DCW's reveal sentence can be read off. */
  culprit?: string
}

/** The episode list behind a "which episodes have X" question. */
export interface CrimeMethodList {
  kind: "cause" | "crime"
  slug: string
  label: string
  /** Text for the link the reply carries. The label above is for the model. */
  linkLabel?: string
  total: number
  /** True when the sweep hit its fetch cap, so `total` is a lower bound. */
  truncated?: boolean
  href: string
  lines: string[]
}

/** Specials / long-format entries, for "the 2-hour specials" style questions. */
export interface SpecialList {
  kind: SpecialKind
  label: string
  /** Text for the link the reply carries. The label above is for the model. */
  linkLabel?: string
  total: number
  href: string
  lines: string[]
}

/** Tracker-wide counts, so the bot never guesses how much of the series exists. */
export interface TrackerTotals {
  entries: number
  episodes: number
  movies: number
  specials: number
}

export interface ChatContext {
  episodes: ContentRow[]
  cases: CaseRow[]
  dcwWiki: DcwWikiResult[]
  /** Present when the question asked who did it, how, or why. */
  resolutions?: CaseResolution[]
  /** Present when the question asked for every episode matching a crime method. */
  crimeMethod?: CrimeMethodList
  /** Present when the question asked about specials or long episodes. */
  specials?: SpecialList
  /** Present when the question asked how much of the series there is. */
  totals?: TrackerTotals
  watchHistory?: {
    watched: string[]
    rewatched: { title: string; count: number }[]
    favorites: string[]
    totalWatched: number
  }
}

const MAX_EPISODES = 12
const MAX_CASES = 12
const MAX_DCW_RESULTS = 4
const MAX_EXTRACT_CHARS = 600
/** An appearances list is the answer itself, so it gets more room than a lead. */
const MAX_APPEARANCES_CHARS = 900
const MAX_RESOLUTION_CHARS = 700
/**
 * How much of a Resolution section to read before reordering it.
 *
 * The reveal is not near the top: in Ep 141's section it lands at character
 * 1,696 of 4,657, after the trick's walkthrough and a false arrest. Slicing to
 * the size we want to send, before the reveal has been moved up, is what made a
 * live answer name the suspect who was arrested instead of the real culprit.
 */
const MAX_RESOLUTION_SCAN = 8000
/** How many rows of a "which episodes have X" list reach the prompt. */
const MAX_METHOD_ROWS = 40
/**
 * Rows pulled to build a crime-method list, before the episode-level dedupe.
 *
 * The largest method (stabbing) files 214 case rows, which collapse to 159
 * episodes — a case with two stabbed victims is one episode in the answer. The
 * cap therefore has to be above the raw row count, not the distinct count, or
 * the stated total would be the number of rows that fit rather than the number
 * of episodes that exist.
 */
const MAX_METHOD_FETCH = 400
const MAX_SPECIAL_ROWS = 30

/**
 * How many rows we pull from Postgres before ranking them.
 *
 * The SQL `or()` filter is a recall step, not the answer: it cannot express
 * relevance, so we over-fetch and let rankEntries() pick. 80 is comfortably
 * above the largest realistic match set (a full-cast name like "Heiji Hattori"
 * matches ~69 rows) while staying cheap.
 */
const CANDIDATE_POOL = 80

const EPISODE_COLUMNS = ["title", "dcw_title", "synopsis"]
const CASE_COLUMNS = [
  "victim",
  "suspects",
  "crime_type",
  "location",
  "cause_death",
  "description",
  "page_title",
]

/* ───────────────────── DCW Wiki Search ───────────────────── */

interface DcwSearchResult {
  title: string
  pageid: number
  snippet?: string
}

interface DcwSearchResponse {
  query?: {
    search?: DcwSearchResult[]
  }
}

interface DcwSectionsResponse {
  parse?: {
    sections?: Array<{ index?: string; line?: string; toclevel?: number }>
  }
}

interface DcwParseResponse {
  parse?: {
    title: string
    pageid: number
    /**
     * Shape depends on `formatversion`: v1 wraps the HTML in `{ "*": … }`,
     * v2 hands back a bare string. This request asks for v2, and reading only
     * `text["*"]` is why every wiki extract came back empty and got dropped by
     * the length gate below.
     */
    text?: string | { "*": string }
  }
}

/** Reads `parse.text` whichever formatversion produced it. Exported for unit tests. */
export function parseHtml(parse: DcwParseResponse["parse"]): string {
  const text = parse?.text
  if (typeof text === "string") return text
  return text?.["*"] ?? ""
}

/** Decodes the numeric entities MediaWiki leaves in text (&#32;, &#91;, &#x2014;). */
function decodeNumericEntities(value: string): string {
  const toChar = (code: number, raw: string) =>
    Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw

  return value
    .replace(/&#x([0-9a-f]+);/gi, (raw, hex) => toChar(Number.parseInt(hex, 16), raw))
    .replace(/&#(\d+);/g, (raw, dec) => toChar(Number.parseInt(dec, 10), raw))
}

/** Strip HTML tags and wikitext markup from a snippet to get plain text. */
function stripHtml(html: string): string {
  return decodeNumericEntities(
    html
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim()
}

/** One HTML block reduced to readable text. */
function cleanWikiText(html: string): string {
  return stripHtml(html)
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/\[https?:\/\/[^\s]+\]/g, "")
    .trim()
}

/**
 * Ordered text blocks from a page or section, most prose-like first.
 *
 * MediaWiki renders article prose as `<p>` and bare lists as `<li>`. Preferring
 * paragraphs keeps infoboxes and maintenance banners out; falling back to list
 * items is what makes DCW's per-character "X Appearances" pages readable — they
 * contain no paragraphs at all, only an episode list.
 */
function textBlocks(html: string): string[] {
  const paragraphs = Array.from(html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi), (m) => m[1])
  if (paragraphs.length > 0) return paragraphs
  return Array.from(html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi), (m) => m[1])
}

/** Joins cleaned text blocks up to a character budget. */
function joinBlocks(blocks: string[], maxChars: number): string {
  let result = ""
  for (const block of blocks) {
    const clean = cleanWikiText(block)
    if (clean.length < 20) continue
    result += (result ? " " : "") + clean
    if (result.length >= maxChars) break
  }
  return result.slice(0, maxChars)
}

/**
 * Extract the first N characters of readable text from a parsed wiki page.
 *
 * MediaWiki renders a page's prose as `<p>` paragraphs, while the infobox,
 * navigation boxes and maintenance banners are divs and tables. Stripping the
 * whole document — the previous behaviour — put infobox labels ("Japanese
 * name:", "Age:") and spoiler banners at the front of the context the model
 * read, so prefer the paragraphs and only fall back to a whole-document strip
 * on pages that have none.
 *
 * Exported for unit tests.
 */
export function extractLeadText(html: string, maxChars: number): string {
  const blocks = textBlocks(html)
  return joinBlocks(blocks.length > 0 ? blocks : [html], maxChars)
}

/**
 * Text of one wiki section (fetched with `section=N`), wrapping the whole
 * section rather than its paragraphs.
 *
 * A section holds no infobox or navigation chrome, but it does hold things the
 * paragraphs miss: DCW wraps the culprit reveal in a JS-toggled spoiler div
 * whose raw text sits outside any `<p>`, and the toggle's own label ("Show
 * spoilers »") sits right next to it. Exported for unit tests.
 */
export function extractSectionText(html: string, maxChars: number): string {
  const section = html
    .replace(/<div class="mw-editsection[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<a\b[^>]*id="toggledisplay\d+l"[\s\S]*?<\/a>/gi, "")
    .replace(/<table[\s\S]*?<\/table>/gi, "")
  return cleanWikiText(section).slice(0, maxChars)
}

/**
 * The `<li>` items of a section, as one line.
 *
 * Used for appearances pages, where each item is already a self-contained
 * "Episode 176 : Reunion with the Black Organization (Haibara)" — joining them
 * with " · " keeps them on one prompt line and inside the char budget.
 */
export function extractListItems(html: string, maxChars: number): string {
  const items = Array.from(html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi), (m) => m[1])
    .map((raw) => cleanWikiText(raw))
    .filter((clean) => clean.length > 3)

  let result = ""
  for (const item of items) {
    if (result.length + item.length + 3 > maxChars) break
    result += (result ? " · " : "") + item
  }
  return result
}

/**
 * Fetch the latest movies from the tracker, newest first.
 *
 * "What is the incoming new movie?" is a recency question, not a keyword
 * question: no title match can answer it, so it gets its own direct query.
 */
async function fetchLatestMovies(): Promise<ContentRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("content_entries")
    .select("*")
    .eq("type", "movie")
    .order("air_date", { ascending: false })
    .limit(5)
  return data ?? []
}

/** Builds the wiki URL for a page title. */
export function wikiUrl(base: string, title: string): string {
  return `${base}${encodeURIComponent(title.replace(/ /g, "_"))}`
}

export const DCW_WIKI_BASE = "https://www.detectiveconanworld.com/wiki/"

/**
 * `content_entries.dcw_title` occasionally points at a gallery subpage
 * (Ep 2 → "…Kidnapping Case/Gallery"), which carries no article text.
 */
export function articleTitle(dcwTitle: string): string {
  return dcwTitle.replace(/\/gallery$/i, "").trim()
}

/** Fetches a page's section index, or null when the page has no such section. */
async function fetchSectionIndex(pageTitle: string, name: RegExp): Promise<string | null> {
  try {
    const data = await dcwQuery<DcwSectionsResponse>({
      action: "parse",
      page: pageTitle,
      prop: "sections",
      format: "json",
      formatversion: "2",
      redirects: "1",
    })
    const section = (data.parse?.sections ?? []).find(
      (s) => s.index != null && name.test(s.line ?? "")
    )
    return section?.index ?? null
  } catch {
    return null
  }
}

/** Fetches one section's rendered HTML, or null when it cannot be read. */
async function fetchSectionHtml(pageTitle: string, sectionIndex: string): Promise<string | null> {
  try {
    const data = await dcwQuery<DcwParseResponse>({
      action: "parse",
      page: pageTitle,
      prop: "text",
      section: sectionIndex,
      format: "json",
      formatversion: "2",
      redirects: "1",
    })
    const html = parseHtml(data.parse)
    return html || null
  } catch {
    return null
  }
}

/**
 * DCW's "Resolution" section for a case page — the part that names the culprit
 * and explains the trick.
 *
 * The lead extract cannot answer "who's the murderer in episode 141": DCW wraps
 * the reveal in a JS-toggled spoiler div inside the Resolution section, so it
 * is fetched separately and only for questions that ask how the case ended.
 * Lifetime and death spoilers are exactly what those questions want; the system
 * prompt keeps the bot from volunteering them otherwise.
 *
 * The section tells the case as a story — false accusation first, reveal last —
 * so `prioritizeResolution` moves the reveal up. Without that the model answers
 * with whichever suspect the narrative accused first.
 */
async function fetchCaseResolution(
  pageTitle: string
): Promise<{ text: string; culprit?: string } | null> {
  const index = await fetchSectionIndex(pageTitle, /^(resolution|conclusion)$/i)
  if (!index) return null
  const html = await fetchSectionHtml(pageTitle, index)
  if (!html) return null

  const raw = extractSectionText(html, MAX_RESOLUTION_SCAN)
  if (raw.length <= 60) return null

  const culprit = extractCulpritName(raw)
  return { text: prioritizeResolution(raw).slice(0, MAX_RESOLUTION_CHARS), culprit: culprit ?? undefined }
}

/**
 * The anime episode list from a DCW "X Appearances" page.
 *
 * The page's own section order is Manga, Anime, Movies, OVAs, Specials, so the
 * episode answer is in the "Anime" section — fetching the page whole would fill
 * the budget with manga file numbers. Falls back to "Movies" for characters who
 * only ever appeared in a film.
 *
 * The list is trimmed to whole entries and closed with a count of what was left
 * out, because the prompt truncates every extract it prints: a list cut at the
 * character budget ends mid-title ("Episode 277 | English Teacher vs. Great"),
 * which reads as a broken answer rather than a shortened one.
 */
const APPEARANCES_TAIL_CHARS = 70

async function fetchAppearancesList(
  pageTitle: string
): Promise<{ list: string; count: number; shown: number } | null> {
  for (const section of [/^anime$/i, /^films?$|^movies$/i]) {
    const index = await fetchSectionIndex(pageTitle, section)
    if (!index) continue
    const html = await fetchSectionHtml(pageTitle, index)
    if (!html) continue

    const count = (html.match(/<li\b/gi) ?? []).length
    const list = extractListItems(html, MAX_APPEARANCES_CHARS - APPEARANCES_TAIL_CHARS)
    if (list.length <= 40) continue

    const shown = list.split(" · ").length
    const remaining = count - shown
    return {
      list: remaining > 0 ? `${list} · …and ${remaining} more episodes` : list,
      count,
      shown,
    }
  }
  return null
}

/**
 * Search the Detective Conan World wiki using MediaWiki search API.
 *
 * MediaWiki ANDs every term in `srsearch`, which is why the old
 * "try the whole question" approach returned 0 hits for real questions. We
 * issue progressively looser queries and, critically, keep only pages whose
 * title shares a keyword with the question — otherwise the model gets served
 * generic franchise pages and has to guess around them.
 */
export async function searchDcwWiki(query: string): Promise<DcwWikiResult[]> {
  const keywords = tokenize(query)
  if (keywords.length === 0) return []

  const words = queryWords(query)
  const appearancesWanted = wantsAppearances(query)
  const queries = buildWikiQueries(query)
  const seenTitles = new Set<string>()
  const candidates: DcwSearchResult[] = []

  for (const q of queries) {
    try {
      const searchData = await dcwQuery<DcwSearchResponse>({
        action: "query",
        list: "search",
        srsearch: q,
        srlimit: "5",
        srnamespace: "0",
        format: "json",
        formatversion: "2",
      })

      for (const r of searchData.query?.search ?? []) {
        if (seenTitles.has(r.title)) continue
        if (!isRelevantTitle(r.title, searchTerms(keywords))) continue
        // A gallery subpage is never the answer; don't spend a fetch on it.
        if (isGalleryTitle(r.title)) continue
        seenTitles.add(r.title)
        candidates.push(r)
      }
    } catch {
      continue
    }
    if (candidates.length >= MAX_DCW_RESULTS * 2) break
  }

  if (candidates.length === 0) return []

  // MediaWiki's ordering is not relevance to this question: it put
  // "List of characters who know Ai Haibara's identity" above "Ai Haibara".
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: scoreWikiTitle(candidate.title, words, { wantsAppearances: appearancesWanted }),
    }))
    .sort((a, b) => b.score - a.score)

  const results: DcwWikiResult[] = []
  // `redirects: 1` resolves aliases, so several candidates can be the same
  // article ("Ai Haibara" four times over) — the model does not need it twice.
  const seenResults = new Set<string>()

  for (const { candidate } of ranked.slice(0, MAX_DCW_RESULTS)) {
    try {
      // "All of Vermouth's appearances" is answered by the wiki's own episode
      // index for her, not by her article — the index is the answer, and the
      // article's lead never lists 115 appearances.
      if (appearancesWanted && isAppearancesTitle(candidate.title)) {
        const appearances = await fetchAppearancesList(candidate.title)
        if (appearances) {
          const key = candidate.title.toLowerCase()
          if (!seenResults.has(key)) {
            seenResults.add(key)
            results.push({
              title: candidate.title,
              url: wikiUrl(DCW_WIKI_BASE, candidate.title),
              extract: `Anime appearances, in order (${appearances.count} in total): ${appearances.list}`,
              source: "dcw",
              appearancesList: { count: appearances.count, shown: appearances.shown },
            })
          }
          continue
        }
      }

      const parseData = await dcwQuery<DcwParseResponse>({
        action: "parse",
        page: candidate.title,
        prop: "text",
        format: "json",
        formatversion: "2",
        redirects: "1",
      })

      const title = parseData.parse?.title ?? candidate.title
      const extract = extractLeadText(parseHtml(parseData.parse), MAX_EXTRACT_CHARS)

      // DCW hides spoiler pages behind a "soft redirect". Following it once
      // is the difference between an answer and a click-through notice.
      if (isSoftRedirect(extract)) {
        const target = firstWikiLinkTarget(parseHtml(parseData.parse))
        if (target && target !== title) {
          const targetData = await dcwQuery<DcwParseResponse>({
            action: "parse",
            page: target,
            prop: "text",
            format: "json",
            formatversion: "2",
            redirects: "1",
          })
          const targetExtract = extractLeadText(parseHtml(targetData.parse), MAX_EXTRACT_CHARS)
          if (targetExtract.length > 30) {
            const resolved = targetData.parse?.title ?? target
            const key = resolved.toLowerCase()
            if (seenResults.has(key)) continue
            seenResults.add(key)
            results.push({
              title: resolved,
              url: wikiUrl(DCW_WIKI_BASE, resolved),
              extract: targetExtract,
              source: "dcw",
            })
            continue
          }
        }
      }

      if (isJunkWikiExtract(extract)) continue
      if (extract.length > 30) {
        const key = title.toLowerCase()
        if (seenResults.has(key)) continue
        seenResults.add(key)
        results.push({
          title,
          url: wikiUrl(DCW_WIKI_BASE, title),
          extract,
          source: "dcw",
        })
      }
    } catch {
      continue
    }
  }

  return results
}

/* ───────────────────── Wikipedia Search ───────────────────── */

interface WikiSearchResult {
  title: string
  pageid: number
}

interface WikiSearchResponse {
  query?: {
    search?: WikiSearchResult[]
  }
}

interface WikiExtractResponse {
  query?: {
    pages?: Record<
      string,
      {
        title?: string
        extract?: string
      }
    >
  }
}

const WIKI_API = "https://en.wikipedia.org/w/api.php"

/**
 * Search Wikipedia for Detective Conan content as a fallback.
 *
 * Same strategy as the DCW search: several query shapes, then a relevance gate
 * on the returned titles.
 */
export async function searchWikipedia(query: string): Promise<DcwWikiResult[]> {
  const keywords = tokenize(query)
  if (keywords.length === 0) return []

  const queries = buildWikiQueries(query).slice(0, 4)
  const seenIds = new Set<number>()
  const candidates: WikiSearchResult[] = []

  for (const q of queries) {
    try {
      const params = new URLSearchParams({
        action: "query",
        list: "search",
        srsearch: q,
        srlimit: "3",
        format: "json",
        formatversion: "2",
      })

      const res = await fetch(`${WIKI_API}?${params}`, {
        headers: { "User-Agent": "DCPH-Tracker/1.0 (chatbot)" },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) continue

      const data = (await res.json()) as WikiSearchResponse
      for (const r of data.query?.search ?? []) {
        if (seenIds.has(r.pageid)) continue
        if (!isRelevantTitle(r.title, searchTerms(keywords))) continue
        seenIds.add(r.pageid)
        candidates.push(r)
      }
    } catch {
      continue
    }
    if (candidates.length >= 3) break
  }

  if (candidates.length === 0) return []

  const results: DcwWikiResult[] = []
  for (const result of candidates.slice(0, 3)) {
    try {
      const params = new URLSearchParams({
        action: "query",
        titles: result.title,
        prop: "extracts",
        exintro: "true",
        explaintext: "true",
        exchars: String(MAX_EXTRACT_CHARS),
        format: "json",
        formatversion: "2",
      })

      const res = await fetch(`${WIKI_API}?${params}`, {
        headers: { "User-Agent": "DCPH-Tracker/1.0 (chatbot)" },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) continue

      const data = (await res.json()) as WikiExtractResponse
      const page = Object.values(data.query?.pages ?? {})[0]
      if (!page?.extract || page.extract.length < 30) continue

      const title = page.title ?? result.title
      results.push({
        title,
        url: wikiUrl("https://en.wikipedia.org/wiki/", title),
        extract: page.extract.slice(0, MAX_EXTRACT_CHARS),
        source: "wikipedia",
      })
    } catch {
      continue
    }
  }

  return results
}

/* ───────────────────── Tracker Search ───────────────────── */

/**
 * Search content_entries by title, synopsis, dcw_title, or episode/movie number.
 *
 * Two-stage by necessity:
 *   1. SQL fetches a candidate pool using only the two MOST SELECTIVE keywords.
 *      Filtering on all six keywords at once ORs them together, which for a
 *      question like "Heiji Hattori first appears" matches most of the table
 *      and makes the pool useless.
 *   2. rankEntries() scores every candidate against ALL keywords and numbers.
 */
export async function searchEpisodes(
  query: string,
  options: { preferRecent?: boolean; preferEarliest?: boolean } = {}
): Promise<ContentRow[]> {
  const supabase = await createClient()
  const keywords = tokenize(query)
  const numbers = extractNumbers(query)
  if (keywords.length === 0 && numbers.length === 0) return []

  const pool: ContentRow[] = []
  const seen = new Set<string>()
  const collect = (rows: ContentRow[] | null) => {
    for (const row of rows ?? []) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      pool.push(row)
    }
  }

  // Exact number matches are almost always what the user meant, so fetch them
  // directly rather than hoping they survive the keyword filter.
  if (numbers.length > 0) {
    const numberClauses = numbers
      .flatMap((n) => [`episode_number.eq.${n}`, `movie_number.eq.${n}`])
      .join(",")

    const { data } = await supabase
      .from("content_entries")
      .select("*")
      .or(numberClauses)
      .limit(MAX_EPISODES)

    collect(data)
  }

  const keywordRows = await collectByTermGroups<ContentRow>(
    supabase,
    "content_entries",
    EPISODE_COLUMNS,
    // Chronological order only decides WHICH rows enter the pool; ranking
    // decides what survives.
    query,
    { column: "air_date", ascending: !options.preferRecent }
  )
  collect(keywordRows)

  return rankEntries(pool, rankingTerms(keywords), {
    limit: MAX_EPISODES,
    numbers,
    preferRecent: options.preferRecent,
    preferEarliest: options.preferEarliest,
  })
}

/**
 * Runs every term group from searchTermGroups() and unions the results.
 *
 * Union rather than first-hit-wins: the groups are different recall strategies
 * (selective keywords, all keywords, character aliases) and each one reaches
 * rows the others miss. Ranking is what keeps precision.
 */
async function collectByTermGroups<T extends { id: string }>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: "content_entries" | "dcw_cases",
  columns: string[],
  query: string,
  order?: { column: string; ascending: boolean }
): Promise<T[]> {
  const keywords = tokenize(query)
  const rows: T[] = []
  const seen = new Set<string>()

  for (const group of searchTermGroups(keywords)) {
    const filter = buildOrFilter(group, columns)
    if (!filter) continue

    let builder = supabase.from(table).select("*").or(filter).limit(CANDIDATE_POOL)
    if (order) builder = builder.order(order.column, { ascending: order.ascending })

    const { data } = await builder
    for (const row of (data ?? []) as unknown as T[]) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      rows.push(row)
    }
  }

  return rows
}

interface CaseSearch {
  cases: CaseRow[]
  /** Every entry_id referenced by any candidate case, ranked or not. */
  entryIds: string[]
  /**
   * Concatenated case text per entry_id, built from the FULL candidate pool
   * (not just the ranked cases) so episodes linked in below can still be
   * scored.
   */
  textByEntry: Map<string, string>
}

/**
 * Search dcw_cases by victim, suspects, crime type, location, cause of death,
 * or description.
 *
 * `entryIds` is returned alongside the ranked cases because an episode is often
 * only findable THROUGH its case record: Ep 57 ("Holmes Freak Murder Case") has
 * a null synopsis and never names Heiji in its title, but its case description
 * says "when Conan and Heiji looked inside the window".
 */
async function findCases(query: string): Promise<CaseSearch> {
  const supabase = await createClient()
  const keywords = tokenize(query)
  if (keywords.length === 0) return { cases: [], entryIds: [], textByEntry: new Map() }

  const pool = await collectByTermGroups<CaseRow>(supabase, "dcw_cases", CASE_COLUMNS, query)

  const textByEntry = new Map<string, string>()
  for (const c of pool) {
    if (!c.entry_id) continue
    const text = [
      c.page_title,
      c.crime_type,
      c.victim,
      c.suspects,
      c.location,
      c.cause_death,
      c.description,
    ]
      .filter(Boolean)
      .join(" ")
    const previous = textByEntry.get(c.entry_id)
    textByEntry.set(c.entry_id, previous ? `${previous} ${text}` : text)
  }

  return {
    cases: rankEntries(pool, rankingTerms(keywords), { limit: MAX_CASES }),
    entryIds: Array.from(textByEntry.keys()),
    textByEntry,
  }
}

/** Search dcw_cases by victim, suspects, crime type, location, cause of death, or description. */
export async function searchCases(query: string): Promise<CaseRow[]> {
  return (await findCases(query)).cases
}

/* ───────────────────── Filtered listings ───────────────────── */

/** "Ep 141 — Title — Stab wound", the shape every listing line takes. */
function listingLine(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(" — ")
}

/**
 * "Give me the episodes that have stabbing" — a filtered sweep of the case
 * files rather than a relevance search.
 *
 * Relevance ranking answers every question with its best twelve rows, which is
 * the wrong shape for a list request: the tracker files 190+ stabbing cases, so
 * the answer has to be an ordered slice of them plus the URL of the filter that
 * shows the rest.
 *
 * Only questions that actually ask for a list reach this path (prefersList),
 * and generic groups like plain "murder" additionally require an explicit
 * "list/all/every" — otherwise every ordinary case question would drag forty
 * rows of context along with it.
 */
export async function findCrimeMethodEpisodes(
  query: string,
  siteUrl: string
): Promise<CrimeMethodList | undefined> {
  if (!prefersList(query)) return undefined

  const match = matchCrimeMethod(query)
  if (!match) return undefined

  // Validate against the canonical group lists /cases itself filters on, so a
  // slug that no longer exists degrades to no list instead of an empty one.
  const known =
    match.kind === "cause" ? isMethodGroupSlug(match.slug) : isCrimeGroupSlug(match.slug)
  if (!known) return undefined

  const supabase = await createClient()
  const { data, count, error } = await supabase
    .from("all_episodes_with_crimes")
    .select("entry_episode_number, entry_title, page_title, cause_death", { count: "exact" })
    .eq(match.kind === "cause" ? "cause_slug" : "crime_slug", match.slug)
    // A crime page with no tracker entry has no episode number to list.
    .not("entry_episode_number", "is", null)
    .order("entry_episode_number", { ascending: true })
    .limit(MAX_METHOD_FETCH)

  if (error || !data || data.length === 0) return undefined

  // A multi-part case files one row per part, and one case can be charged with
  // the same method twice; the list is of episodes, so collapse those.
  const seen = new Set<string>()
  const lines: string[] = []
  for (const row of data) {
    const title = row.entry_title ?? row.page_title ?? "Untitled case"
    const key = `${row.entry_episode_number}|${title}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(listingLine([`Ep ${row.entry_episode_number}`, title, row.cause_death]))
  }

  return {
    kind: match.kind,
    slug: match.slug,
    label: match.label,
    linkLabel: `${match.label} case files (${seen.size})`,
    total: seen.size,
    truncated: (count ?? data.length) > data.length,
    href:
      match.kind === "cause"
        ? `${siteUrl}/cases?cause=${match.slug}`
        : `${siteUrl}/cases?type=${match.slug}`,
    lines,
  }
}

/** Specials, OVAs and the long-format episodes ("the 2-hour specials"). */
export async function findSpecialEntries(
  query: string,
  siteUrl: string
): Promise<SpecialList | undefined> {
  const kind = matchSpecialKind(query)
  if (!kind) return undefined

  const supabase = await createClient()
  let builder = supabase
    .from("content_entries")
    .select("title, type, episode_number, movie_number, runtime_minutes, air_date", {
      count: "exact",
    })
    // Feature films run 95-110 minutes, so a plain "85+ minutes" sweep returns
    // the entire movie list and answers a question nobody asked. Long-format
    // here means television: episodes, specials and OVAs.
    .neq("type", "movie")
    .order("air_date", { ascending: true })

  if (kind === "two-hour") builder = builder.gte("runtime_minutes", 85)
  else if (kind === "one-hour") builder = builder.gte("runtime_minutes", 40).lt("runtime_minutes", 85)
  else builder = builder.or("type.in.(special,ova),runtime_minutes.gte.40")

  const { data, count, error } = await builder.limit(MAX_SPECIAL_ROWS)
  if (error || !data || data.length === 0) return undefined

  const labels: Record<SpecialKind, string> = {
    "two-hour": "Two-hour specials (85+ minutes of television)",
    "one-hour": "One-hour specials (40-84 minutes)",
    specials: "Specials, OVAs and long episodes (40+ minutes)",
  }

  // The reply's link is a title; the labels above are what the model reasons
  // with. Printed verbatim the long one wrapped to three lines in the chat.
  const linkLabels: Record<SpecialKind, string> = {
    "two-hour": "Two-hour specials",
    "one-hour": "One-hour specials",
    specials: "Specials, OVAs & long episodes",
  }

  const total = count ?? data.length

  return {
    kind,
    label: labels[kind],
    linkLabel: `${linkLabels[kind]} (${total})`,
    total,
    href: `${siteUrl}/tracker`,
    lines: data.map((row) =>
      listingLine([
        row.episode_number != null
          ? `Ep ${row.episode_number}`
          : row.movie_number != null
            ? `Movie ${row.movie_number}`
            : row.type.replace(/_/g, " "),
        row.title,
        row.runtime_minutes != null ? `${row.runtime_minutes} min` : null,
        row.air_date,
      ])
    ),
  }
}

/**
 * How much of the series the tracker actually holds.
 *
 * "How many episodes are there?" has no keyword answer, and the old bot
 * answered it from memory — which is how a count that contradicted its own
 * context ended up in the chat.
 */
export async function fetchTrackerTotals(query: string): Promise<TrackerTotals | undefined> {
  if (
    !/\b(how many|total|number of|count of)\b/i.test(query) ||
    !/\b(episodes?|movies?|specials?|ovas?|entries)\b/i.test(query)
  ) {
    return undefined
  }

  const supabase = await createClient()
  const countOf = async (type?: ContentRow["type"]): Promise<number> => {
    let builder = supabase.from("content_entries").select("id", { count: "exact", head: true })
    if (type) builder = builder.eq("type", type)
    const { count } = await builder
    return count ?? 0
  }

  const [entries, episodes, movies, specials] = await Promise.all([
    countOf(),
    countOf("episode"),
    countOf("movie"),
    countOf("special"),
  ])

  if (entries === 0) return undefined
  return { entries, episodes, movies, specials }
}

/* ───────────────────── Watch History ───────────────────── */

/** Summarise the signed-in user's watch data for prompt context. */
export async function getUserWatchHistory(
  userId: string
): Promise<ChatContext["watchHistory"]> {
  const supabase = await createClient()

  const { count } = await supabase
    .from("watch_status")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["watched", "rewatched"])

  const { data } = await supabase
    .from("watch_status")
    .select("status, watch_count, favorite, content_entries ( title, episode_number )")
    .eq("user_id", userId)
    .or("status.eq.watched,status.eq.rewatched,favorite.is.true")
    .limit(500)

  if (!data) {
    return { watched: [], rewatched: [], favorites: [], totalWatched: count ?? 0 }
  }

  const watched: string[] = []
  const rewatched: { title: string; count: number }[] = []
  const favorites: string[] = []

  for (const row of data as unknown as Array<{
    status: string
    watch_count: number | null
    favorite: boolean | null
    content_entries: { title: string; episode_number: number | null } | null
  }>) {
    const entry = row.content_entries
    if (!entry) continue

    const label =
      entry.episode_number != null ? `Ep ${entry.episode_number}: ${entry.title}` : entry.title

    if (row.status === "watched" || row.status === "rewatched") watched.push(label)
    if (row.status === "rewatched") {
      rewatched.push({ title: label, count: row.watch_count ?? 2 })
    }
    if (row.favorite) favorites.push(label)
  }

  return {
    watched,
    rewatched: rewatched.sort((a, b) => b.count - a.count),
    favorites,
    totalWatched: count ?? watched.length,
  }
}

/* ───────────────────── Combined Search ───────────────────── */

/** How many cases one "who did it?" question pulls a resolution for. */
const MAX_RESOLUTIONS = 2

/**
 * DCW "Resolution" sections for the cases a question is about.
 *
 * The tracker already stores each entry's DCW page title, so the page does not
 * have to be searched for: "who's the murderer in episode 141" resolves to that
 * episode's own wiki page, whose Resolution section names the culprit and
 * explains the trick.
 */
async function fetchResolutions(
  episodes: ContentRow[],
  query: string
): Promise<CaseResolution[] | undefined> {
  // A question that names an episode number is about that one episode: pulling
  // a second resolution in adds a case the user never asked about.
  const limit = extractNumbers(query).length > 0 ? 1 : MAX_RESOLUTIONS
  const candidates = episodes
    .filter((entry) => (entry.dcw_title ?? "").trim().length > 0)
    .slice(0, limit)

  const found = await Promise.all(
    candidates.map(async (entry): Promise<CaseResolution | null> => {
      const page = articleTitle(entry.dcw_title as string)
      const resolution = await fetchCaseResolution(page)
      if (!resolution) return null

      const number =
        entry.episode_number != null
          ? `Ep ${entry.episode_number}`
          : entry.movie_number != null
            ? `Movie ${entry.movie_number}`
            : entry.type.replace(/_/g, " ")

      return {
        label: `${number} — ${entry.title}`,
        url: wikiUrl(DCW_WIKI_BASE, page),
        text: resolution.text,
        culprit: resolution.culprit,
      }
    })
  )

  const resolutions = found.filter((row): row is CaseResolution => row !== null)
  return resolutions.length > 0 ? resolutions : undefined
}

/**
 * Combined search.
 *
 *   1. DCW Wiki (character info, trivia, general questions)
 *   2. Wikipedia (fallback when DCW has nothing)
 *   3. Tracker episodes (title, number, synopsis)
 *   4. Tracker cases (victim, crime type, location)
 *   5. Filtered listings (crime method, specials/long episodes, totals) — only
 *      for questions that ask for a list rather than a place to look things up
 *   6. DCW "Resolution" sections — only for questions that ask how a case ended
 *
 * The first five run in parallel; the two wiki sources are merged with DCW
 * taking precedence. Cross-links are then pulled in: cases attached to matched
 * episodes and episodes attached to matched cases, so the model can answer
 * "which episode has X" without a second round-trip.
 *
 * `siteUrl` only shapes the links printed next to a listing, so the bot can
 * send the user to the filter page that shows the rest of the rows.
 */
export async function searchAll(
  query: string,
  userId?: string,
  siteUrl = "https://dcphtracker.vercel.app"
): Promise<ChatContext> {
  const supabase = await createClient()

  const recentFirst = prefersRecent(query)
  // A debut question wins over nothing else; "latest" wins over "first" if a
  // question somehow contains both.
  const earliestFirst = !recentFirst && prefersEarliest(query)

  const keywords = tokenize(query)
  const terms = rankingTerms(keywords)
  const numbers = extractNumbers(query)

  // A crime-method list question is answered by the case files, and the
  // Wikipedia fallback only pollutes it: "give me eps that have stabbing"
  // pulled in "Stabbing Westward" and a 2024 news article, which the model then
  // had to be trusted to ignore.
  const listingQuery = prefersList(query) && matchCrimeMethod(query) !== null

  const [dcwWiki, wikiBackup, episodes, caseSearch, crimeMethod, specials, totals, watchHistory] =
    await Promise.all([
      searchDcwWiki(query),
      listingQuery ? Promise.resolve([] as DcwWikiResult[]) : searchWikipedia(query),
      searchEpisodes(query, { preferRecent: recentFirst, preferEarliest: earliestFirst }),
      findCases(query),
      findCrimeMethodEpisodes(query, siteUrl),
      findSpecialEntries(query, siteUrl),
      fetchTrackerTotals(query),
      userId ? getUserWatchHistory(userId) : Promise.resolve(undefined),
    ])

  const seenWikiTitles = new Set(dcwWiki.map((r) => r.title.toLowerCase()))
  const wikiResults: DcwWikiResult[] = [...dcwWiki]
  for (const r of wikiBackup) {
    const key = r.title.toLowerCase()
    if (seenWikiTitles.has(key)) continue
    seenWikiTitles.add(key)
    wikiResults.push(r)
  }

  // Recency questions need the newest movies, which keyword search cannot find.
  const latestMovies = recentFirst ? await fetchLatestMovies() : []

  // Pull in episodes reachable only through their case record.
  const knownIds = new Set([...latestMovies, ...episodes].map((e) => e.id))
  const missingEntryIds = caseSearch.entryIds.filter((id) => !knownIds.has(id))

  const { data: linkedEpisodes } = missingEntryIds.length
    ? await supabase
        .from("content_entries")
        .select("*")
        .in("id", missingEntryIds)
        .limit(CANDIDATE_POOL)
    : { data: [] as ContentRow[] }

  // ONE ranking pass over the merged pool. Ranking episodes and linked
  // episodes separately is what let a loudly-titled 2007 episode outrank
  // Heiji's actual 1997 debut.
  //
  // fetchLatestMovies() is deliberately NOT part of the ranked pool: it is an
  // intent-driven answer, not a keyword match, and "Detective Conan Movie 29"
  // scores zero against the word "movies" — ranking would silently delete the
  // only entries that actually answer the question.
  const rankedEpisodes = rankEntries(
    dedupeById([...episodes, ...((linkedEpisodes as ContentRow[]) ?? [])]),
    terms,
    {
      limit: MAX_EPISODES,
      numbers,
      preferRecent: recentFirst,
      preferEarliest: earliestFirst,
      fieldsOf: (entry) => ({ ...entry, extra: caseSearch.textByEntry.get(entry.id) ?? null }),
    }
  )

  // Case details for the episodes we are actually going to show.
  const finalEpisodes = dedupeById([...latestMovies, ...rankedEpisodes]).slice(
    0,
    MAX_EPISODES + 6
  )

  const { data: linkedCases } = finalEpisodes.length
    ? await supabase
        .from("dcw_cases")
        .select("*")
        .in("entry_id", finalEpisodes.map((e) => e.id))
        .limit(MAX_CASES + 6)
    : { data: [] as CaseRow[] }

  return {
    episodes: finalEpisodes,
    cases: dedupeById([...caseSearch.cases, ...((linkedCases as CaseRow[]) ?? [])]).slice(
      0,
      MAX_CASES + 6
    ),
    dcwWiki: wikiResults,
    resolutions: wantsCulprit(query) ? await fetchResolutions(finalEpisodes, query) : undefined,
    crimeMethod,
    specials,
    totals,
    watchHistory,
  }
}
