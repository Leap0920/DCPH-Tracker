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
  // Tagalog function words and politeness filler. Most of the audience asks in
  // Filipino, and these are long enough to eat the whole MAX_KEYWORDS budget:
  // "may list po kayo ng episodes kung sino sino po ang mga napaliit ng
  // APTX-4869" tokenized to [napaliit, maraming, salamat, tanong, good, lang]
  // and dropped "aptx" entirely, so the bot answered with no APTX context.
  "ang", "mga", "si", "ni", "kay", "kina", "nito", "nila", "namin", "natin",
  "kami", "kayo", "sila", "ninyo", "kanila", "kanino", "akin", "iyo", "kanya",
  "sya", "siya", "ako", "tayo",
  "ito", "iyan", "iyon", "yung", "ung", "dito", "diyan", "doon", "po", "pong",
  "opo", "ho", "ba", "naman", "lang", "lamang", "din", "rin", "daw", "raw",
  "kasi", "pero", "at", "o", "ay", "na", "pa", "may", "meron", "mayroon",
  "wala", "kung", "kapag", "kaya", "sana", "muna", "ulit", "tapos", "saka",
  "nga", "pala", "yata", "siguro", "masyado", "sobra", "buong", "lahat",
  // "gawa" and its affixed forms are "do / make / did" — pure filler.
  "gawa", "gawin", "ginawa", "gumawa", "makagawa", "nakagawa", "gumagawa",
  // Tagalog interrogatives: intent classification reads these off the raw
  // query, they are not search terms.
  "ano", "sino", "saan", "alin", "ilan", "kailan", "bakit", "paano", "magkano",
  // question shells and courtesy
  "tanong", "nagtanong", "itanong", "sagot", "sagutin", "tulong", "tulungan",
  "hanap", "hanapin", "maghanap", "tingnan", "makita", "kita", "sabihin",
  "sabi", "malaman", "alam", "nalalaman", "gusto", "ibig", "pwede", "puwede",
  "maaari", "paki", "pakiusap", "mangyaring", "salamat", "maraming", "maganda",
  "magandang", "araw", "umaga", "gabi", "tanghali", "good", "day", "hello",
  "hi", "kumusta", "musta", "welcome", "naging", "nang", "nag", "pag", "para",
  "pala", "mismo", "talaga", "syempre", "ewan", "hindi", "oo", "opo",
])

/**
 * Meaningful keywords shorter than MIN_KEYWORD_LENGTH.
 * "Ai" is Haibara's given name and is the only two-letter term users search for.
 */
const SHORT_TERMS = new Set(["ai"])

const MIN_KEYWORD_LENGTH = 3

/**
 * Tagalog content words mapped to the English the tracker and the wiki use.
 *
 * The databases are written in English, so a Filipino question's own words
 * match nothing: "kriminal" and "paretoke" returned zero rows for the episode
 * where a plastic-surgery double frames Shinichi, so the bot never saw
 * "Murderer, Shinichi Kudo" (Ep 521) and named the closest-looking episode
 * instead. These are additive recall terms, never replacements — the user's
 * own words are still searched and still score.
 *
 * Keys are matched as substrings once they are at least five characters long,
 * because Tagalog marks aspect and focus with affixes: "paretoke" also covers
 * "nagparetoke" / "pinaretoke", "lason" covers "nilason" / "pagkalason".
 */
const TAGALOG_TERMS: Record<string, readonly string[]> = {
  // crime and culprits
  kriminal: ["murderer", "criminal", "culprit"],
  krimen: ["crime", "murder"],
  salarin: ["culprit", "suspect"],
  pumatay: ["murderer", "killer", "murder"],
  patay: ["killed", "death", "dead"],
  namatay: ["died", "death"],
  pagpatay: ["murder", "killing"],
  biktima: ["victim"],
  motibo: ["motive"],
  kaso: ["case"],
  // disguise and identity
  paretoke: ["plastic", "surgery", "disguise"],
  nagpanggap: ["disguise", "impostor", "impersonate"],
  pagpapanggap: ["disguise", "impostor"],
  peke: ["fake", "impostor"],
  pagkatao: ["identity"],
  kilala: ["known", "identity"],
  tunay: ["real", "true"],
  isisi: ["frame", "framed", "blame"],
  // shrinking (APTX-4869)
  napaliit: ["shrink", "shrinking", "smaller"],
  lumiit: ["shrink", "shrinking", "smaller"],
  pagliit: ["shrink", "shrinking"],
  // methods of death
  lason: ["poison", "poisoning", "poisoned"],
  lasong: ["poison", "poisoning"],
  saksak: ["stab", "stabbed", "stabbing"],
  baril: ["gunshot", "shot", "gun"],
  sunog: ["burned", "burning", "arson"],
  lunod: ["drowned", "drowning"],
  bigti: ["hanged", "hanging"],
  sabog: ["explosion", "bombing", "bomb"],
  bomba: ["bomb", "bombing"],
  nakaw: ["theft", "robbery", "stolen"],
  dukot: ["kidnapped", "abduction"],
  // media
  pelikula: ["movie", "film"],
  palabas: ["series"],
  serye: ["series"],
  misteryo: ["mysterious", "mystery"],
}

/**
 * English recall terms for any Tagalog words in `keywords`, in order.
 *
 * Additive on purpose: the caller still searches the user's literal words, so
 * an English question is unaffected and a Filipino one gains a second chance
 * at the same rows.
 */
export function translateTerms(keywords: string[]): string[] {
  const out: string[] = []
  const seen = new Set(keywords)

  for (const kw of keywords) {
    for (const [key, terms] of Object.entries(TAGALOG_TERMS)) {
      // Substring match only for keys long enough that a false positive is
      // unlikely; short keys ("patay", "peke") must match whole words.
      const hit = kw === key || (key.length >= 5 && kw.includes(key))
      if (!hit) continue
      for (const term of terms) {
        if (seen.has(term)) continue
        seen.add(term)
        out.push(term)
      }
    }
  }

  return out
}

/** Every term a relevance filter should accept: the user's words plus translations. */
export function searchTerms(keywords: string[]): string[] {
  return [...keywords, ...translateTerms(keywords)]
}

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
 * Two halves to the contract:
 *  - WHICH keywords survive is decided by specificity: for "Which episode has
 *    the ski resort murder?", `resort` and `murder` are the discriminating
 *    terms and should survive the MAX_KEYWORDS cut.
 *  - The survivors keep their QUERY order, because `keywords` is not a bag of
 *    terms — scoreEntry() and buildWikiQueries() read `keywords.join(" ")` as a
 *    phrase. Length-sorting the run turned "Who is Heiji Hattori?" into
 *    ["hattori", "heiji"], which is a contiguous substring of six episode
 *    titles ("Hattori Heiji …") but not of the character's own "Heiji Hattori",
 *    so the episodes outranked the answer.
 */
export function tokenize(query: string, maxKeywords = 6): string[] {
  const tokens = normalizeText(query)
    .split(" ")
    .filter((t) => (t.length >= MIN_KEYWORD_LENGTH || SHORT_TERMS.has(t)) && !STOPWORDS.has(t))

  // First occurrence wins, so `unique` is already in query order.
  const unique = Array.from(new Set(tokens))
  // The cut is by specificity; what comes back is not re-sorted.
  const kept = new Set(unique.slice().sort((a, b) => b.length - a.length).slice(0, maxKeywords))

  return unique.filter((token) => kept.has(token))
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
 * strategies, and rankEntries() decides what actually survives. The user's own
 * words come first; English translations of Tagalog words follow, because a
 * Filipino question's literal words match nothing in an English database.
 * Aliases come last because they are a long shot rather than the user's words.
 */
export function searchTermGroups(keywords: string[]): string[][] {
  const groups: string[][] = []
  // The selective group sorts for itself: `tokenize` now returns query order,
  // and "the two most selective terms" is a different question from "the two
  // the user said first". It stays a small, precise SQL probe.
  if (keywords.length > 2) {
    groups.push([...keywords].sort((a, b) => b.length - a.length).slice(0, 2))
  }
  // The full group keeps the caller's order: buildOrFilter ORs the terms, so
  // the order cannot change which rows match.
  if (keywords.length > 0) groups.push(keywords)

  const translated = translateTerms(keywords)
  // Same reasoning as the selective group above, applied to the translated
  // terms: they inherit the caller's order, so the two longest are the probe.
  if (translated.length > 2) {
    groups.push([...translated].sort((a, b) => b.length - a.length).slice(0, 2))
  }
  if (translated.length > 0) groups.push(translated)

  const aliases = expandAliases(keywords)
  if (aliases.length > 0) groups.push(aliases)

  return groups.length > 0 ? groups : [[]]
}

/**
 * Every term that should count when scoring: the user's words, their English
 * translations when they asked in Tagalog, and character aliases.
 */
export function rankingTerms(keywords: string[]): string[] {
  return [...keywords, ...translateTerms(keywords), ...expandAliases(keywords)]
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
/**
 * Half the phrase bonus, paid when a title holds every keyword as a whole word
 * but in a different order.
 *
 * "Who is Heiji Hattori?" asks for the run "heiji hattori", while six episode
 * titles say "Hattori Heiji …": without this, the character's own entry scores
 * below all six. It stays weaker than the run because it is a weaker signal.
 */
const BONUS_ALL_TERMS_IN_TITLE = 2
/**
 * The most a title can earn for being made of the words the user asked for.
 *
 * A title is the strongest signal the corpus carries, and "how much of it did
 * the question actually use" is what separates the document *about* a subject
 * from a document that merely names it. "Which movie is The Time-Bombed
 * Skyscraper?" uses every meaningful word of that movie's own title, while the
 * case record beside it is titled "… — case 6": two words the question never
 * said. Both match the same keywords on the same fields, so they tie, and the
 * tie was broken by fusion order — which handed the answer to the case record.
 * Scaled by the covered share, so a title carrying extra words ranks below the
 * title that is the subject.
 *
 * Deliberately below BONUS_EXACT_NUMBER: a question naming an episode number is
 * a number question first.
 */
const BONUS_TITLE_COVERED = 5
/**
 * Paid when the title is the phrase and nothing else.
 *
 * The strongest form of the signal above: a title that says exactly what the
 * user asked for, with no word of its own, is the document *about* the subject
 * rather than one that names it in passing. "What happens in Moonlight Sonata
 * Murder Case?" is answered by the episode titled exactly that; the 2021
 * remake's case records are titled "The Moonlight Sonata Murder — case 1" and
 * tie with it on every other term, so they used to win on fusion order.
 *
 * Above BONUS_TITLE_COVERED because it is that measure taken to its limit, and
 * still below BONUS_EXACT_NUMBER: a question naming an episode number is a
 * number question first.
 */
const BONUS_TITLE_EXACT = 6
/** An exact episode/movie number beats every keyword match. */
const BONUS_EXACT_NUMBER = 10

/** Concatenates the title-like fields used for the whole-phrase bonus. */
function titleText(entry: RankableEntry): string {
  return normalizeText([entry.title, entry.dcw_title, entry.page_title].filter(Boolean).join(" "))
}

/**
 * True when every keyword is a whole word of `title` (already normalized).
 *
 * A word set, never `includes`: "ran" is a substring of "brand" and would
 * qualify under a substring test, which is the one way this bonus could leak
 * across the corpus.
 */
function allTermsInTitle(title: string, keywords: string[]): boolean {
  const words = new Set(title.split(" "))
  return keywords.every((keyword) => words.has(keyword))
}

/**
 * The share of a title's own substance that the keywords account for.
 *
 * Grammar is not substance: stopwords and one- or two-letter tokens are dropped
 * because `tokenize` never emits them, so counting them would penalise a title
 * for saying "The …" rather than for mentioning something the user did not ask
 * about. Repetition is kept, not deduplicated — "… — case 2" says "case" twice
 * and that repeat is exactly the extra word this measure exists to see.
 */
function titleCoverage(title: string, keywords: string[]): number {
  const words = title
    .split(" ")
    .filter(
      (word) =>
        word.length > 0 &&
        (word.length >= MIN_KEYWORD_LENGTH || SHORT_TERMS.has(word)) &&
        !STOPWORDS.has(word)
    )
  if (words.length === 0) return 0

  const asked = new Set(keywords)
  let covered = 0
  for (const word of words) {
    if (asked.has(word)) covered += 1
  }
  return covered / words.length
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

  // The two title bonuses are alternatives, not a sum: an entry that matches
  // the run is worth exactly BONUS_PHRASE_IN_TITLE, never the two together.
  const title = titleText(entry)
  const phrase = keywords.join(" ")
  if (keywords.length > 1 && phrase.length > 0) {
    if (title.includes(phrase)) {
      score += BONUS_PHRASE_IN_TITLE
    } else if (allTermsInTitle(title, keywords)) {
      score += BONUS_ALL_TERMS_IN_TITLE
    }
  }

  // Independent of the two bonuses above: those read the ORDER of the keywords
  // in the title, these read how much of the title they cover. A case record
  // can satisfy neither the run nor the full-term set while still naming the
  // subject, which is the tie this breaks.
  score += BONUS_TITLE_COVERED * titleCoverage(title, keywords)
  if (title.length > 0 && title === phrase) score += BONUS_TITLE_EXACT

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

  // Per-word and bigram queries run over the translated terms as well, so a
  // Tagalog question can still reach an English page by its English name.
  const terms = searchTerms(keywords)
  // Longest term first, not in query order: the list above spends the budget on
  // phrase forms, and the whole point of a lone term is that MediaWiki can
  // still match on the most selective one. This order used to come from
  // tokenize()'s sort; it is stated here now that tokenize() keeps the
  // question's order.
  for (const term of [...terms].sort((a, b) => b.length - a.length)) push(term)

  for (let i = 0; i < terms.length - 1; i += 1) {
    push(`${terms[i]} ${terms[i + 1]}`)
  }

  return queries.slice(0, maxQueries)
}

/**
 * Every word of the question, stopwords included.
 *
 * `tokenize` drops stopwords because they are useless as search recall, but a
 * wiki title has to be compared against the question as a whole: "the black
 * organization's goal" must recognise the page title "Black Organization".
 */
export function queryWords(query: string): Set<string> {
  return new Set(normalizeText(query).split(" ").filter(Boolean))
}

/** List-like page titles: they list things rather than describe them. */
const LIST_LIKE_TITLE = /\b(appearances|gallery|timeline|list of)\b/i

/**
 * Orders the wiki pages the model reads.
 *
 * MediaWiki's internal relevance put "List of characters who know Ai Haibara's
 * identity" ahead of "Ai Haibara" itself, and gallery subpages ahead of the
 * pages they illustrate — and the prompt tells the model to trust the first
 * entry, so ordering is part of correctness, not presentation. A title whose
 * every word appears in the question is the entity being asked about (+10);
 * list-like pages and subpages only stand in for it (−6 each).
 *
 * An "X Appearances" page is the exception: for "all of Vermouth's
 * appearances" it is not a stand-in for the article, it IS the answer, so the
 * question's own wording flips its penalty into a bonus.
 */
export function scoreWikiTitle(
  title: string,
  words: Set<string>,
  options: { wantsAppearances?: boolean } = {}
): number {
  const titleWords = normalizeText(title).split(" ").filter(Boolean)
  const appearancesTitle = isAppearancesTitle(title)
  const listLike = LIST_LIKE_TITLE.test(title)
  let score = 0

  if (titleWords.length > 0 && titleWords.every((w) => words.has(w))) score += 10
  if (listLike) score += options.wantsAppearances && appearancesTitle ? 6 : -6
  if (title.includes("/")) score -= 6

  return score
}

/**
 * True for subpages that hold no prose (image galleries).
 *
 * They are skipped during retrieval, but `content_entries.dcw_title` sometimes
 * points at one (Ep 2 → "Company President's Daughter Kidnapping Case/Gallery"),
 * so the culprit path strips the suffix rather than fetching a gallery.
 */
export function isGalleryTitle(title: string): boolean {
  return /\/(gallery|images?|sounds?)$/i.test(title.trim())
}

/** "X Appearances" pages — the wiki's own per-character episode index. */
export function isAppearancesTitle(title: string): boolean {
  return /\S\s+appearances$/i.test(title.trim())
}

/**
 * True when the question is asking for a list of entries rather than one.
 *
 * Listing questions are answered by a different retrieval path (a filtered
 * sweep plus a link to the matching tracker filter), because relevance ranking
 * can only ever return the dozen best-scoring rows — useless when the user
 * asked for "all the episodes where someone is stabbed".
 */
export function prefersList(query: string): boolean {
  if (/\b(?:which|what|list|all|every|give me|show me|name|examples of|how many)\b[^?]{0,50}\b(?:eps|episodes|movies|specials)\b/i.test(query)) {
    return true
  }
  if (/\b(?:eps|episodes)\b[^?]{0,40}\b(?:that|which|with|where|featuring|involving|having|have|has|contain(?:ing|s)?)\b/i.test(query)) {
    return true
  }
  // Tagalog list requests: "mga episode na may saksak", "listahan ng episodes
  // kung saan may lasong". "mga" (plural marker) and "may" (there is / with)
  // stand in for the English list words.
  return /\b(?:mga|listahan|lahat)\b[^?]{0,40}\b(?:eps|episode|episodes)\b/i.test(query) ||
    /\b(?:eps|episode|episodes)\b[^?]{0,40}\b(?:na may|mayroong|meron|kung saan|gumawa|gumamit|naglason|nagsaksak)\b/i.test(query)
}

/**
 * True when the question asks how a case ends — the culprit, the trick, the
 * resolution. Those answers live in DCW's "Resolution" section, which the lead
 * extract never reaches.
 *
 * The Tagalog branch matters: "kung saan si shinichi yung naging kriminal" is
 * a culprit/identity question, but no English keyword appears in it, so the
 * resolution was never fetched and the bot answered with a lookalike episode.
 */
const CULPRIT_RE =
  /\b(culprit|murderer|killer|who (?:did it|killed|dunnit)|perpetrator|offender|solved|solution|resolution|trick|revealed?|true identity|spoiler)\b/i

export function wantsCulprit(query: string): boolean {
  if (CULPRIT_RE.test(query)) return true
  return CULPRIT_RE.test(translateTerms(tokenize(query)).join(" "))
}

/** True when the question asks for a character's appearances rather than facts. */
export function wantsAppearances(query: string): boolean {
  return /\b(appearances?|appeared|appears|appear|debuts?|debuted)\b/i.test(query)
}

/** One crime method or crime type named in the question. */
export interface CrimeMethodMatch {
  kind: "cause" | "crime"
  slug: string
  label: string
}

/**
 * The crime-group slugs that are too common to be a list request on their own.
 *
 * "murder" appears in a large share of ordinary case questions ("the ski lodge
 * murder"), so treating it as a filter would bury the real question under forty
 * rows of murder. The specific methods below are distinctive enough to stand.
 */
const GENERIC_CRIME_SLUGS = new Set([
  "murder",
  "attempted-murder",
  "accident",
  "assault",
  "suicide",
  "vandalism",
  "other",
])

/**
 * Named crime methods and crime types, most specific first.
 *
 * The slugs are the canonical group slugs from lib/dcw-cases.ts (METHOD_GROUPS
 * for causes of death, CRIME_GROUPS for crime types) — the same ones /cases
 * filters on — and the search layer validates them against those lists before
 * querying, so a stale entry here degrades to "no list" rather than to a
 * silently empty answer.
 */
const CRIME_METHOD_TERMS: ReadonlyArray<{ re: RegExp } & CrimeMethodMatch> = [
  { re: /\bstab(?:bed|bing|s|wound)?\b/i, kind: "cause", slug: "stabbing", label: "Stabbing" },
  { re: /\bstrangl(?:ed|ing|e)\b|\bchoke[ds]?\b|\bgarrot/i, kind: "cause", slug: "strangulation", label: "Strangulation" },
  { re: /\bsuffocat/i, kind: "cause", slug: "suffocation", label: "Suffocation" },
  { re: /\bhang(?:ed|ing|s)\b/i, kind: "cause", slug: "hanging", label: "Hanging" },
  { re: /\bdecapitat|\bbehead/i, kind: "cause", slug: "decapitation", label: "Decapitation" },
  { re: /\belectrocut/i, kind: "cause", slug: "electrocution", label: "Electrocution" },
  { re: /\boverdose\b|\bdrugged\b|\bpoison(?:ed|ing|s)?\b/i, kind: "cause", slug: "poisoning", label: "Poisoning" },
  { re: /\bdrown(?:ed|ing|s)?\b/i, kind: "cause", slug: "drowning", label: "Drowning" },
  { re: /\bburn(?:ed|ing|s)?\b|\barson\b|\bimmolat/i, kind: "cause", slug: "burning", label: "Burning" },
  { re: /\bexplos(?:ion|ions|ive|ives)\b|\bbomb(?:ed|ing|s)?\b/i, kind: "cause", slug: "explosion", label: "Explosion" },
  { re: /\bgunshot\b|\bshot\b|\bshoot(?:ing|s|er|ers)?\b|\bbullet\b|\bfirearm\b/i, kind: "cause", slug: "gunshot", label: "Gunshot" },
  { re: /\bblunt[- ]force\b|\bbludgeon|\bbeaten\b|\bbeating\b|\bblunt object\b/i, kind: "cause", slug: "blunt-force", label: "Blunt force" },
  { re: /\bhit[- ]and[- ]run\b|\bvehicl|\bcar crash\b|\btrain\b|\btraffic accident\b/i, kind: "cause", slug: "vehicle", label: "Vehicle & train" },
  { re: /\bfall(?:ing)?\b|\bfell\b|\bfell to (?:his|her) death\b/i, kind: "cause", slug: "fall", label: "Fall" },
  { re: /\bkidnap/i, kind: "crime", slug: "kidnapping", label: "Kidnapping & Hostage" },
  { re: /\bhostage\b|\bbarricad/i, kind: "crime", slug: "kidnapping", label: "Kidnapping & Hostage" },
  { re: /\brobb(?:ery|er|ers|ed|ing)?\b|\btheft\b|\bsteal(?:ing|s)?\b|\bstolen\b|\bheist\b|\bburglar/i, kind: "crime", slug: "robbery", label: "Robbery & Theft" },
  { re: /\bfraud\b|\bscam\b|\bextortion\b|\bblackmail\b|\bcon[- ]?artist\b/i, kind: "crime", slug: "fraud", label: "Scam & Extortion" },
  { re: /\bmissing person\b|\bdisappear/i, kind: "crime", slug: "missing-person", label: "Missing Person" },
  { re: /\bsuicide\b/i, kind: "crime", slug: "suicide", label: "Suicide" },
  { re: /\barson\b/i, kind: "crime", slug: "bombing", label: "Bombing & Arson" },
  { re: /\battempted murder\b/i, kind: "crime", slug: "attempted-murder", label: "Attempted Murder" },
  { re: /\bmurder\b|\bhomicide\b/i, kind: "crime", slug: "murder", label: "Murder" },
]

/**
 * The crime method or crime type the question is about, if any.
 *
 * A generic group (plain "murder") only counts when the question is a real
 * list request — "list all murder episodes" yes, "the ski lodge murder" no.
 */
export function matchCrimeMethod(query: string): CrimeMethodMatch | null {
  const direct = matchCrimeMethodText(query, query)
  if (direct) return direct

  // Tagalog method words ("saksak", "lasong", "nalunod") only match once they
  // are in English; the list-word gate still reads the original question.
  const translated = translateTerms(tokenize(query)).join(" ")
  return translated ? matchCrimeMethodText(translated, query) : null
}

function matchCrimeMethodText(text: string, query: string): CrimeMethodMatch | null {
  for (const { re, kind, slug, label } of CRIME_METHOD_TERMS) {
    if (!re.test(text)) continue
    if (GENERIC_CRIME_SLUGS.has(slug) && !/\b(?:list|all|every|how many|which eps|what eps)\b/i.test(query)) {
      continue
    }
    return { kind, slug, label }
  }
  return null
}

/** Two-hour specials and other long formats, as asked for in the question. */
export type SpecialKind = "two-hour" | "one-hour" | "specials"

/** The question points at one numbered entry rather than at the set. */
const NAMES_ONE_ENTRY = /\b(?:ep|eps|episode|episodes|special|ova)\s*\.?\s*#?\s*\d{1,4}\b/i

/** …which it may ask for anyway ("list all the 2-hour specials"). */
const ASKS_FOR_SET = /\b(?:list|all|every|each|how many|which|mga|lahat|listahan)\b/i

/**
 * Which long-form list the question is asking for, if any.
 *
 * DCW and the tracker both count a "two-hour special" as ~92 minutes of
 * content (a broadcast hour is 46), so the length buckets are 85+ and 40-84.
 *
 * "Special" and "OVA" also describe a single entry — "what is the special
 * episode 1209 about?" — and answering one of those with the 103-row listing
 * put a link to the whole set at the top of the reply. Like the generic crime
 * groups, the listing is only for questions that ask for the set.
 */
export function matchSpecialKind(query: string): SpecialKind | null {
  const kind = longFormKind(query)
  if (!kind) return null
  if (NAMES_ONE_ENTRY.test(query) && !ASKS_FOR_SET.test(query)) return null
  return kind
}

function longFormKind(query: string): SpecialKind | null {
  if (/\b(?:2|two)[- ]?hour\b|\bdouble[- ]?length\b|\b92[- ]?min/i.test(query)) return "two-hour"
  if (/\b(?:1|one)[- ]?hour\b|\bsingle[- ]?hour\b/i.test(query)) return "one-hour"
  if (/\bspecials?\b|\bovas?\b|\blong(?:er)?(?:-| )?(?:episodes?|format)\b/i.test(query)) return "specials"
  return null
}

/** Blurbs that are the entire text of a gallery page — no answer in them. */
const JUNK_EXTRACT = /^this is a (?:gallery|list) of images/i

export function isJunkWikiExtract(text: string): boolean {
  return JUNK_EXTRACT.test(text.trim())
}

/**
 * The first article link on a page. Used to follow DCW's spoiler
 * "soft redirects", which wrap the real page in a click-through notice.
 * Namespace links (File:, Help:, …) are skipped: on those pages the first
 * link is usually the notice icon.
 */
export function firstWikiLinkTarget(html: string): string | null {
  const NAMESPACES = /^(file|help|category|template|special|talk|user|mediawiki|module):/i

  for (const match of html.matchAll(/href="\/wiki\/([^"#?]+)"/gi)) {
    const raw = match[1]
    if (!raw) continue
    let target: string
    try {
      target = decodeURIComponent(raw)
    } catch {
      target = raw
    }
    if (NAMESPACES.test(target)) continue
    return target.replace(/_/g, " ")
  }

  return null
}

/** True when a page is DCW's spoiler-gating stand-in for another page. */
export function isSoftRedirect(text: string): boolean {
  return /soft redirect/i.test(text)
}

/**
 * Sentences that state the real culprit.
 *
 * DCW writes a case's Resolution as narrative, and the narrative deliberately
 * leads with the false solution — "Heiji proclaims the family servant was the
 * murderer", "Sakuraba is soon arrested" — before the reveal. A reader (or a
 * model) that stops at the first accused name gets the wrong answer, which is
 * exactly what happened to "who's the murderer in episode 141": the true culprit
 * was named later, in "The real culprit is revealed to be Kukihito Morizono".
 */
const REVEAL_SENTENCE =
  /\b(?:real|true|actual)\s+(?:culprit|murderer|killer|criminal)\b|\b(?:culprit|murderer|killer|criminal)\s+(?:is|was)\s+revealed\b|\b(?:revealed|turn(?:s|ed)?\s+out)\s+to\s+be\b/i

/** A capitalized name, up to four words, as wiki prose writes one. */
const NAME = "([A-Z][\\p{L}'’-]*(?:\\s+[A-Z][\\p{L}'’-]*){0,3})"

const REVEAL_NAME_PATTERNS: RegExp[] = [
  new RegExp(
    `\\b(?:real|true|actual)\\s+(?:culprit|murderer|killer|criminal)\\s+(?:is|was)?\\s*(?:revealed\\s+to\\s+be|turn(?:s|ed)?\\s+out\\s+to\\s+be|is|was)\\s+${NAME}`,
    "u"
  ),
  new RegExp(`\\b(?:culprit|murderer|killer|criminal)\\s+(?:is|was)\\s+revealed\\s+to\\s+be\\s+${NAME}`, "u"),
  // "turned out to be" is a reveal; a bare "the culprit is X" is not, because
  // DCW uses that phrasing for the false accusation too.
  new RegExp(`\\b(?:culprit|murderer|killer|criminal)\\s+turn(?:s|ed)?\\s+out\\s+to\\s+be\\s+${NAME}`, "u"),
]

/**
 * Puts the sentences that state the real culprit in front of the rest.
 *
 * Order is the whole point: the model reads the resolution top-down and the
 * narrative buries the answer behind the false accusation, so the reveal is
 * moved up rather than left where the case's storyline put it.
 */
export function prioritizeResolution(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text]
  const reveal: string[] = []
  const rest: string[] = []

  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    if (!trimmed) continue
    if (REVEAL_SENTENCE.test(trimmed)) reveal.push(trimmed)
    else rest.push(trimmed)
  }

  return [...reveal, ...rest].join(" ")
}

/** The culprit's name as DCW's own reveal sentence states it, when readable. */
export function extractCulpritName(text: string): string | null {
  for (const pattern of REVEAL_NAME_PATTERNS) {
    const match = text.match(pattern)
    const name = match?.[1]?.trim()
    if (name) return name
  }
  return null
}
