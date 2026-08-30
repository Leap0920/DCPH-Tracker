import { createClient } from "@/utils/supabase/server"
import { dcwQuery } from "@/lib/dcw"
import {
  buildOrFilter,
  buildWikiQueries,
  dedupeById,
  extractNumbers,
  isRelevantTitle,
  prefersEarliest,
  prefersRecent,
  rankEntries,
  rankingTerms,
  searchTermGroups,
  tokenize,
} from "@/lib/chat/query"
import type { Database } from "@/types/database.types"

type ContentRow = Database["public"]["Tables"]["content_entries"]["Row"]
type CaseRow = Database["public"]["Tables"]["dcw_cases"]["Row"]

export interface DcwWikiResult {
  title: string
  url: string
  extract: string
  source: "dcw" | "wikipedia"
}

export interface ChatContext {
  episodes: ContentRow[]
  cases: CaseRow[]
  dcwWiki: DcwWikiResult[]
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

interface DcwParseResponse {
  parse?: {
    title: string
    pageid: number
    text?: { "*": string }
  }
}

/** Strip HTML tags and wikitext markup from a snippet to get plain text. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Extract the first N characters of readable text from a wikitext HTML blob. */
function extractLeadText(html: string, maxChars: number): string {
  let text = stripHtml(html)
  text = text.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
  text = text.replace(/\{\{[^}]*\}\}/g, "")
  text = text.replace(/\[https?:\/\/[^\s]+\]/g, "")
  const paragraphs = text.split(/\n{2,}/)
  let result = ""
  for (const p of paragraphs) {
    const clean = p.trim()
    if (clean.length < 20) continue
    result += (result ? " " : "") + clean
    if (result.length >= maxChars) break
  }
  return result.slice(0, maxChars)
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
function wikiUrl(base: string, title: string): string {
  return `${base}${encodeURIComponent(title.replace(/ /g, "_"))}`
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
        if (!isRelevantTitle(r.title, keywords)) continue
        seenTitles.add(r.title)
        candidates.push(r)
      }
    } catch {
      continue
    }
    if (candidates.length >= MAX_DCW_RESULTS) break
  }

  if (candidates.length === 0) return []

  const results: DcwWikiResult[] = []
  for (const result of candidates.slice(0, MAX_DCW_RESULTS)) {
    try {
      const parseData = await dcwQuery<DcwParseResponse>({
        action: "parse",
        page: result.title,
        prop: "text",
        format: "json",
        formatversion: "2",
        redirects: "1",
      })

      const title = parseData.parse?.title ?? result.title
      const extract = extractLeadText(parseData.parse?.text?.["*"] ?? "", MAX_EXTRACT_CHARS)

      if (extract.length > 30) {
        results.push({
          title,
          url: wikiUrl("https://www.detectiveconanworld.com/wiki/", title),
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
        if (!isRelevantTitle(r.title, keywords)) continue
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

/**
 * Combined search.
 *
 *   1. DCW Wiki (character info, trivia, general questions)
 *   2. Wikipedia (fallback when DCW has nothing)
 *   3. Tracker episodes (title, number, synopsis)
 *   4. Tracker cases (victim, crime type, location)
 *
 * All four run in parallel; the two wiki sources are merged with DCW taking
 * precedence. Cross-links are then pulled in: cases attached to matched
 * episodes and episodes attached to matched cases, so the model can answer
 * "which episode has X" without a second round-trip.
 */
export async function searchAll(query: string, userId?: string): Promise<ChatContext> {
  const supabase = await createClient()

  const recentFirst = prefersRecent(query)
  // A debut question wins over nothing else; "latest" wins over "first" if a
  // question somehow contains both.
  const earliestFirst = !recentFirst && prefersEarliest(query)

  const keywords = tokenize(query)
  const terms = rankingTerms(keywords)
  const numbers = extractNumbers(query)

  const [dcwWiki, wikiBackup, episodes, caseSearch, watchHistory] = await Promise.all([
    searchDcwWiki(query),
    searchWikipedia(query),
    searchEpisodes(query, { preferRecent: recentFirst, preferEarliest: earliestFirst }),
    findCases(query),
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
    watchHistory,
  }
}
