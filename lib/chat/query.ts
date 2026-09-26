/**
 * Pure query helpers for DCPH Bot retrieval.
 *
 * Zero imports and zero I/O on purpose: these are the parts that decide WHAT
 * the model is allowed to see, so they must be unit-testable without a
 * database or a request context. lib/chat/search.ts owns the fetching and
 * calls into here.
 */

/**
 * Words too common to be search signals. Kept in one place so the tracker
 * query, the wiki query and the relevance filter all agree.
 */
export const STOPWORDS = new Set([
  // articles, pronouns, prepositions
  "a", "an", "and", "any", "are", "as", "at", "be", "but", "by", "for", "from",
  "in", "is", "it", "its", "of", "on", "or", "the", "their", "there", "these",
  "this", "that", "them", "then", "than", "to", "up", "was", "were", "with",
  "you", "your", "my", "me", "i",
  // question + instruction words
  "can", "could", "did", "do", "does", "find", "give", "has", "have", "how",
  "know", "list", "show", "some", "tell", "what", "whats", "when", "where",
  "which", "who", "whom", "whos", "why", "would", "should", "about", "also",
  // filler verbs that describe the asking, not the subject
  "appeared", "appear", "appears", "happen", "happened", "happens", "been",
  "being", "get", "got", "made", "make", "need", "needs", "used", "using",
  "want", "wants", "like", "just", "only", "very", "more", "most", "much",
  "many", "into", "over", "after", "before", "thing", "things", "first",
  "last", "next",
  // franchise boilerplate: nearly every row mentions these, so they carry
  // no discriminating power.
  "conan", "detective", "episode", "episodes",
])

/**
 * Meaningful keywords shorter than MIN_KEYWORD_LENGTH.
 * "Ai" is Haibara's given name and is the only two-letter term users search for.
 */
const SHORT_TERMS = new Set(["ai"])

const MIN_KEYWORD_LENGTH = 3

/**
 * Lowercases, drops punctuation and collapses whitespace.
 *
 * PUNCTUATION IS LOAD-BEARING: the previous tokenizer split on whitespace only,
 * so "Who is Ai Haibara?" produced the keyword `haibara?` — which matched zero
 * rows and left the bot with no tracker context at all.
 */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * PostgREST `or()` filters are parsed as a comma/paren/dot delimited string, so
 * any of those characters inside a user value will corrupt the filter. Strip
 * them plus LIKE wildcards before interpolating.
 */
export function sanitizeLike(value: string): string {
  return value.replace(/[,().*%\\"':;]/g, " ").replace(/\s+/g, " ").trim()
}

/**
 * Splits a question into search keywords.
 *
 * Sorted by specificity (longest first) rather than by frequency: for
 * "Which episode has the ski resort murder?", `resort` and `murder` are the
 * discriminating terms and should survive the MAX_KEYWORDS cut.
 */
export function tokenize(query: string, maxKeywords = 6): string[] {
  const tokens = normalizeText(query)
    .split(" ")
    .filter((t) => (t.length >= MIN_KEYWORD_LENGTH || SHORT_TERMS.has(t)) && !STOPWORDS.has(t))

  const unique = Array.from(new Set(tokens)).sort((a, b) => b.length - a.length)
  return unique.slice(0, maxKeywords)
}

/**
 * Pulls candidate episode/movie numbers out of a question.
 *
 * Skips 4-digit numbers that look like years (1900-2100): "Conan 2024" is not
 * asking for episode 2024, and the old code wasted a query clause on it.
 */
export function extractNumbers(query: string): number[] {
  const matches = query.match(/\d{1,4}/g)
  if (!matches) return []

  const nums = matches
    .map((m) => Number.parseInt(m, 10))
    .filter((n) => n > 0 && n < 2000 && !(n >= 1900 && n <= 2100))

  return Array.from(new Set(nums)).slice(0, 3)
}

/** True when the question is asking for the newest rather than the earliest. */
export function prefersRecent(query: string): boolean {
  return /\b(new|newest|incoming|upcoming|latest|recent|current|soon)\b/i.test(query)
}

/**
 * True when the question is asking for a debut.
 *
 * "Who appears first?" is a temporal question, but relevance ranking answers it
 * with whichever entry shouts the character's name loudest — for Heiji Hattori
 * that was "Three Days with Hattori Heiji" (2007) instead of his actual debut.
 */
export function prefersEarliest(query: string): boolean {
  return /\b(first|debut|earliest|earlier|oldest|introduced|introduction|beginning)\b/i.test(
    query
  )
}

/**
 * Alternate names for the main cast.
 *
 * The tracker records characters under whichever name a given episode used, so
 * a search for one name misses every episode that used another. Ai Haibara's
 * debut (Ep 129) is filed as "Shiho Miyano"; Akai appears as "Subaru Okiya";
 * Amuro as "Rei Furuya" / "Bourbon". Without this map those entries are
 * unreachable, which is exactly why "whats haibara first apperance" returned
 * the wrong episode.
 */
const CHARACTER_ALIASES: Record<string, readonly string[]> = {
  // Two deliberate omissions, both learned the hard way:
  //  - "ai": ILIKE '%ai%' matches "against", "train", "detail", "wait". It
  //    flooded the pool with the oldest 80 episodes and buried the debut.
  //  - "miyano": shared with her sister Akemi, so it pulls in Ep 128 ("One
  //    Billion Yen Robbery", where Akemi dies) ahead of Haibara's real debut.
  haibara: ["shiho", "sherry"],
  sherry: ["haibara", "shiho"],
  shiho: ["haibara", "sherry"],
  conan: ["shinichi", "kudo"],
  shinichi: ["conan", "kudo"],
  kid: ["kaito", "kuroba", "phantom"],
  kaito: ["kid", "kuroba"],
  akai: ["subaru", "okiya", "moroboshi"],
  subaru: ["akai", "okiya"],
  amuro: ["rei", "furuya", "bourbon"],
  bourbon: ["amuro", "rei", "furuya"],
  vermouth: ["sharon", "vineyard"],
  rei: ["amuro", "furuya", "bourbon"],
}

/**
 * Adds the alternate names of any character in `keywords`.
 *
 * Used both to widen the SQL recall step and as ranking terms, so an episode
 * that only ever says "Shiho" still qualifies for a "Haibara" question.
 */
export function expandAliases(keywords: string[]): string[] {
  const out: string[] = []
  const seen = new Set(keywords)

  for (const kw of keywords) {
    for (const alias of CHARACTER_ALIASES[kw] ?? []) {
      if (seen.has(alias)) continue
      // Aliases are used in ILIKE '%term%' filters, where anything under three
      // characters matches far more than it selects.
      if (alias.length < MIN_KEYWORD_LENGTH) continue
      seen.add(alias)
      out.push(alias)
    }
  }

  return out
}

/**
 * The keyword groups to try against Postgres, most selective first.
 *
 * Every group is fetched and the results are UNIONED: the groups are recall
 * strategies, and rankEntries() decides what actually survives. Aliases come
 * last because they are a long shot rather than the user's literal words.
 */
export function searchTermGroups(keywords: string[]): string[][] {
  const groups: string[][] = []
  if (keywords.length > 2) groups.push(keywords.slice(0, 2))
  if (keywords.length > 0) groups.push(keywords)

  const aliases = expandAliases(keywords)
  if (aliases.length > 0) groups.push(aliases)

  return groups.length > 0 ? groups : [[]]
}

/** Every term that should count when scoring: the user's words plus aliases. */
export function rankingTerms(keywords: string[]): string[] {
  return [...keywords, ...expandAliases(keywords)]
}

/** Builds a PostgREST `or()` value: every keyword ILIKE-matched on every column. */
export function buildOrFilter(keywords: string[], columns: string[]): string {
  const clauses: string[] = []
  for (const kw of keywords) {
    const safe = sanitizeLike(kw)
    if (!safe) continue
    for (const col of columns) clauses.push(`${col}.ilike.%${safe}%`)
  }
  return clauses.join(",")
}

/**
 * The fields both `content_entries` and `dcw_cases` can be matched on, with the
 * weight each field deserves. A title hit is a far stronger signal than a
 * passing mention in a synopsis.
 */
export interface RankableEntry {
  title?: string | null
  dcw_title?: string | null
  page_title?: string | null
  synopsis?: string | null
  description?: string | null
  victim?: string | null
  suspects?: string | null
  crime_type?: string | null
  location?: string | null
  cause_death?: string | null
  /**
   * Text that belongs to a related row rather than to this entry — currently
   * the case record linked to an episode. Kept separate so callers can inject
   * it without mutating the row.
   */
  extra?: string | null
  episode_number?: number | null
  movie_number?: number | null
  air_date?: string | null
}

const FIELD_WEIGHTS: ReadonlyArray<readonly [keyof RankableEntry, number]> = [
  ["title", 3],
  ["page_title", 3],
  ["dcw_title", 2],
  ["victim", 2],
  ["crime_type", 2],
  ["location", 2],
  ["suspects", 2],
  ["extra", 2],
  ["cause_death", 1],
  ["description", 1],
  ["synopsis", 1],
]

/** Bonus when the whole phrase appears in a title, e.g. "ski lodge murder case". */
const BONUS_PHRASE_IN_TITLE = 4
/** An exact episode/movie number beats every keyword match. */
const BONUS_EXACT_NUMBER = 10

/** Concatenates the title-like fields used for the whole-phrase bonus. */
function titleText(entry: RankableEntry): string {
  return normalizeText([entry.title, entry.dcw_title, entry.page_title].filter(Boolean).join(" "))
}

/**
 * Scores how well an entry matches the query. Higher is better.
 *
 * WHY SCORING EXISTS: the old code OR'd every keyword across every column and
 * then took the first 12 rows ordered by air_date ASC. For "Episode where
 * Heiji Hattori first appears" that matched 69 rows and returned the 12
 * OLDEST — episodes 5, 7, 59 — while the actual answer was never in the
 * context the model saw. Relevance ranking fixes that; ordering is now a
 * tie-breaker, not the selection mechanism.
 */
export function scoreEntry(
  entry: RankableEntry,
  keywords: string[],
  numbers: number[] = []
): number {
  let score = 0
  let matched = 0

  for (const kw of keywords) {
    let best = 0
    for (const [field, weight] of FIELD_WEIGHTS) {
      if (weight <= best) continue
      const raw = entry[field]
      if (typeof raw !== "string" || !raw) continue
      if (normalizeText(raw).includes(kw)) best = weight
    }
    if (best > 0) {
      score += best
      matched += 1
    }
  }

  // Reward entries matching several keywords over entries matching one.
  if (matched > 1) score += matched

  const phrase = keywords.join(" ")
  if (keywords.length > 1 && phrase.length > 0 && titleText(entry).includes(phrase)) {
    score += BONUS_PHRASE_IN_TITLE
  }

  for (const n of numbers) {
    if (entry.episode_number === n || entry.movie_number === n) {
      score += BONUS_EXACT_NUMBER
    }
  }

  return score
}

/**
 * Sorts candidate entries and keeps the best `limit`.
 *
 * Two modes:
 *  - relevance-first (default): highest score wins, air date breaks ties.
 *  - chronological-first (`preferRecent` / `preferEarliest`): air date decides
 *    and score only breaks ties. "Which episode does Heiji first appear in?"
 *    is a question about time, and relevance ranking answers it with whichever
 *    entry shouts the name loudest — the 2007 episode titled after him, rather
 *    than his 1997 debut.
 *
 * `fieldsOf` lets the caller inject text that is not on the row itself, e.g.
 * an episode's case record.
 */
export function rankEntries<T>(
  entries: T[],
  keywords: string[],
  options: {
    limit?: number
    numbers?: number[]
    preferRecent?: boolean
    preferEarliest?: boolean
    fieldsOf?: (entry: T) => RankableEntry
  } = {}
): T[] {
  const {
    limit = 12,
    numbers = [],
    preferRecent = false,
    preferEarliest = false,
    fieldsOf,
  } = options

  const identity = (entry: T) => entry as unknown as RankableEntry
  const fields = fieldsOf ?? identity
  const chronological = preferRecent || preferEarliest

  return entries
    .map((entry) => {
      const entryFields = fields(entry)
      return {
        entry,
        score: scoreEntry(entryFields, keywords, numbers),
        air: entryFields.air_date ?? "",
      }
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (chronological && a.air !== b.air) {
        return preferEarliest ? (a.air < b.air ? -1 : 1) : a.air < b.air ? 1 : -1
      }
      if (b.score !== a.score) return b.score - a.score
      if (a.air !== b.air) return a.air < b.air ? -1 : 1
      return 0
    })
    .slice(0, limit)
    .map((row) => row.entry)
}

/** Drops duplicate rows by id, preserving order. */
export function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const row of rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }
  return out
}

/**
 * True when a wiki page title is plausibly about the question.
 *
 * The old wiki path kept whatever MediaWiki returned, so the model received
 * pages like "Arthur Conan Doyle" for a ski-resort question and — as it said
 * out loud in one answer — had to ignore its own "primary" source. Keeping
 * only titles that share a keyword cuts that noise.
 */
export function isRelevantTitle(title: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false
  const normalized = normalizeText(title)
  return keywords.some((kw) => normalized.includes(kw))
}

/** Page titles that answer "what is the newest movie?" style questions. */
const LIST_PAGE_QUERIES = ["List of Detective Conan movies", "Detective Conan film series"]

/**
 * Builds progressively looser wiki queries.
 *
 * MediaWiki's `srsearch` ANDs all terms, so a full question
 * ("whats the movie where kaito kid appeared with the sunflower painting")
 * matches nothing. We therefore also try the keyword run, each significant
 * keyword on its own, and every bigram — measured against the live wiki, the
 * full-question form returned 0 hits for every realistic question.
 */
export function buildWikiQueries(query: string, maxQueries = 6): string[] {
  const keywords = tokenize(query)
  const queries: string[] = []
  const push = (q: string) => {
    const clean = q.trim()
    if (clean && !queries.includes(clean)) queries.push(clean)
  }

  // "Which is the newest movie?" is answered by a list page, not by a
  // keyword match, so it has to be tried before anything else.
  if (prefersRecent(query)) {
    for (const page of LIST_PAGE_QUERIES) push(page)
  }

  push(normalizeText(query))
  if (keywords.length >= 2) push(keywords.join(" "))
  if (keywords.length >= 3) push(keywords.slice(0, 2).join(" "))

  for (const kw of keywords) push(kw)

  for (let i = 0; i < keywords.length - 1; i += 1) {
    push(`${keywords[i]} ${keywords[i + 1]}`)
  }

  return queries.slice(0, maxQueries)
}
