/**
 * The deterministic router: the plan a request gets without asking a model.
 *
 * This is the default path (plan deviation D1) and the planner is the escalation,
 * so the router is a real planner rather than a stub. It recognizes the curated
 * names the corpus is built from, reads episode and range references, decides
 * whether a question is lore-shaped (the ladder's wiki round is what it needs), and
 * decides whether it is confident enough that paying for a model call would buy
 * nothing.
 *
 * Three properties the rest of the pipeline depends on:
 *
 * 1. It never throws and never returns an invalid plan. The route calls it on the
 *    answer path, where a throw is a 500 on a question the ladder could have
 *    answered, and an invalid plan is a request lost to a parse error.
 * 2. The plan is a pure function of the message. Identical inputs produce
 *    deep-equal plans, which is what makes `[E3]` mean the same document on a retry
 *    and the fixture calibration in the test repeatable.
 * 3. Names come from the modules `lib/ai/corpus/curated.ts` imports them from, so a
 *    name the corpus can answer is a name the router can recognize and the two can
 *    never disagree about what a character or an arc is called.
 */
import { GADGETS } from "@/lib/ai/corpus/curated"
import {
  MAX_KEYWORD_CHARS,
  MAX_NAME_QUERY_CHARS,
  MAX_PLAN_KEYWORDS,
  MAX_PLAN_STEPS,
  MAX_QUERY_CHARS,
  parseQueryPlan,
  type PlanStep,
  type QueryPlan,
} from "@/lib/ai/pipeline/plan"
import { RECURRING_THREADS, STORY_ARCS } from "@/lib/arcs-guide"
import { CHARACTERS } from "@/lib/characters-guide"
import { classifyChatIntent } from "@/lib/chat/intent"
import {
  extractNumbers,
  normalizeText,
  prefersEarliest,
  prefersRecent,
  tokenize,
} from "@/lib/chat/query"

/** Who produced a plan: the router, the model, or the router as a fallback. */
export type PlanSource = "router" | "model" | "fallback"

/**
 * Why a plan says what it says. Logged per request and, at `AI_PLANNER=auto`, the
 * input to D1's decision: only the confident codes skip the model call.
 *
 * A closed set rather than a free string, so a log line can be counted and a test
 * can name every possibility.
 */
export const ROUTER_WHY = [
  "out-of-scope", // the intent pre-check refused: no retrieval is wanted
  "lore", // a LORE_MARKERS hit: the question wants the wiki round
  "ambiguous", // a comparison, or nothing but a generic catalog search
  "list", // an enumeration question no single document answers
  "bare-number", // nothing but an episode/movie reference
  "exact-entity", // a curated name, an episode or a range was recognized
  "chitchat", // a greeting, or a message with nothing in it to retrieve
] as const

export type RouterWhy = (typeof ROUTER_WHY)[number]

export interface RoutedPlan {
  plan: QueryPlan
  /** False sends the question to the planner (D1); has nothing to do with the answer. */
  confident: boolean
  why: RouterWhy
}

/**
 * Plot vocabulary: the questions whose answer is not a field of any corpus
 * document. The corpus holds an arc's range and tagline; the events inside it are
 * wiki material, which is exactly the round `needsLore` buys.
 *
 * Calibrated against the golden fixture's 11 `needsLore` cases — the arc, thread
 * and storyline shapes and the open-ended "tell me about" request. Bare number
 * lookups are excluded separately below, because "tell me about movie 26" asks for
 * one document and not for lore.
 */
export const LORE_MARKERS: RegExp[] = [
  /\barcs?\b/i,
  /\bthreads?\b/i,
  /\bstory ?lines?\b/i,
  /\bsagas?\b/i,
  /\bplot ?lines?\b/i,
  // Open-ended requests ask for background rather than for a field.
  /\b(?:tell me about|what can you tell me about|what do you know about)\b/i,
  // The Organization plot: codenames, the drug, and the boss.
  /\b(?:organization|apotoxin|aptx)\b/i,
]

/** The most character lookups a plan carries: a comparison names two. */
const MAX_CHARACTER_STEPS = 2

/** The most episode classifications a plan carries. */
const MAX_EPISODE_STEPS = 1

/** Step kinds, in the order they keep a slot when a message earns more than four. */
const STEP_LIMIT = MAX_PLAN_STEPS

/**
 * An explicit range — what `arc_for_range` answers. The episode noun is optional
 * because "what happened between 500 and 600" is the same question; the endpoints
 * are still filtered through `extractNumbers`, so the year rule and the count cap
 * apply here too.
 */
const RANGE_PATTERN =
  /\b(?:ep(?:isode)?s?[\s:#]*)?(\d{1,4})\s*(?:-|–|—|to|through|thru|hanggang)\s*(\d{1,4})\b/i

/** An episode noun before the number: "episode 500", "ep 500", "eps 500". */
const EPISODE_NOUN_PATTERN = /\bep(?:isode)?s?[\s:#]*(\d{1,4})\b/gi

/** A number a canon/filler word classifies: "500 ba filler?", "129 is manga canon". */
const EPISODE_CLASS_PATTERN =
  /\b(\d{1,4})\s*(?:ba\s+|ay\s+)?(?:is\s+|a\s+|an\s+)?(?:filler|canon|manga|anime[- ]original)\b/i

/**
 * Words that can surround a number without changing what is asked. "What is
 * episode 1 about?" and "tell me about movie 26" are both nothing but a number
 * lookup; "which arc covers episodes 179 to 345?" is a plot question that happens
 * to name numbers, and one word outside this set is what tells them apart.
 */
const BARE_NUMBER_FILLER = new Set([
  "what", "which", "who", "whos", "is", "are", "was", "were", "about",
  "tell", "me", "in", "to", "of", "the", "a", "an", "on", "for", "please",
  "episode", "episodes", "ep", "eps", "movie", "movies", "chapter", "chapters",
  "case", "cases", "ova", "ovas", "special", "specials",
  // Tagalog framing: "ano ang episode 500", "500 ba".
  "ano", "ang", "ng", "si", "sino", "ba", "po", "yung", "ito", "iyan", "nito",
])

/** The comparison markers rule 5 names, Tagalog forms included. */
const COMPARISON_MARKERS: RegExp[] = [
  /\bvs\.?\b/i,
  /\bversus\b/i,
  /\bor\b/i,
  /\bo mas magaling\b/i,
  /\bmas magaling pa kay\b/i,
]

/** Plural nouns a list question enumerates — but not a numbered episode reference. */
const LIST_NOUNS =
  /\b(episodes|movies|specials|ovas|arcs|characters|cases|gadgets|threads|fillers)\b(?![\s:#]*\d)/i

/** The frame that turns an enumeration into a list question. */
const LIST_FRAME = /\b(list|enumerate|which|what|show|give|name|ilan|ano)\b/i

/**
 * Words that identify a document *kind* rather than an entity. Without this,
 * "arc" would hit all seven arcs at once and "officer" two characters, so one
 * mention would become a pile of steps.
 */
const GENERIC_NAME_TOKENS = new Set([
  "arc", "arcs", "movie", "movies", "episode", "episodes", "special", "specials",
  "ova", "ovas", "thread", "threads", "storyline", "storylines", "series",
  "season", "chapter", "the", "and", "of", "vs",
  "professor", "officer", "inspector", "detective", "mr", "mrs", "ms", "dr",
])

/**
 * Shortest name word that can identify an entity. "Ai" is the cast list's only
 * two-letter name, and matching two-letter words would make it hit every message
 * that mentions AI at all.
 */
const MIN_NAME_TOKEN_LENGTH = 3

/**
 * The words a message can be made of and still be a greeting rather than a
 * question. A status word ("bot", "conan") may appear as a vocative; an entity hit
 * disqualifies the message regardless, which is what keeps "Who is Conan?" a
 * lookup.
 */
const CHITCHAT_WORDS = new Set([
  "hi", "hii", "hey", "hello", "yo", "sup", "there", "good", "morning",
  "afternoon", "evening", "night", "thanks", "thank", "you", "ty", "salamat",
  "please", "po", "ok", "okay", "sige", "cool", "nice", "great", "haha", "lol",
  "welcome", "kamusta", "kumusta", "musta", "how", "are", "who", "what", "can",
  "do", "does", "bot", "dcph", "conan", "tracker",
])

interface CuratedEntity {
  kind: "character" | "arc" | "thread" | "gadget"
  /** The step's argument: a character's canonical name, or the title to search for. */
  label: string
  /** Whole words that identify the entity in a message. */
  tokens: string[]
  /**
   * The entity's names and aliases, one per part: "Ai Haibara / Shiho Miyano" is
   * two names, and a message that says one of them should keep that one.
   */
  parts: string[]
}

/** The name words of a curated entry, minus the generic kind words. */
function nameTokens(values: readonly string[]): string[] {
  const tokens: string[] = []

  for (const value of values) {
    for (const token of normalizeText(value).split(" ")) {
      if (token.length < MIN_NAME_TOKEN_LENGTH) continue
      if (GENERIC_NAME_TOKENS.has(token)) continue
      if (!tokens.includes(token)) tokens.push(token)
    }
  }

  return tokens
}

/** One normalized name per curated name or alias, split where the data joins two. */
function nameParts(values: readonly string[]): string[] {
  const parts: string[] = []

  for (const value of values) {
    for (const part of value.split(/\s*[/&,]\s*/)) {
      const normalized = normalizeText(part)
      if (normalized && !parts.includes(normalized)) parts.push(normalized)
    }
  }

  return parts
}

function curatedEntity(
  kind: CuratedEntity["kind"],
  label: string,
  values: readonly string[]
): CuratedEntity {
  return { kind, label, tokens: nameTokens(values), parts: nameParts(values) }
}

const CURATED_ENTITIES: CuratedEntity[] = [
  ...CHARACTERS.map((character) =>
    curatedEntity("character", character.name, [character.name, ...(character.aliases ?? [])])
  ),
  ...STORY_ARCS.map((arc) => curatedEntity("arc", arc.title, [arc.title])),
  ...RECURRING_THREADS.map((thread) => curatedEntity("thread", thread.title, [thread.title])),
  ...GADGETS.map((gadget) =>
    curatedEntity("gadget", gadget.name, [gadget.name, ...gadget.aliases])
  ),
]

/** The plan a fallback needs to be runnable: nothing to gather, nothing to say. */
const EMPTY_PLAN: QueryPlan = {
  intent: "chitchat",
  steps: [],
  keywords: [],
  numbers: [],
  needsLore: false,
  preferRecent: false,
  preferEarliest: false,
}

interface EntityHit {
  entity: CuratedEntity
  /** Indices into the message's token list, ascending. */
  positions: number[]
  /** The entity's names the message says in full, for the keyword list. */
  phrases: string[]
}

/** The message's words, in order, as `normalizeText` sees them. */
function messageTokens(message: string): string[] {
  return normalizeText(message).split(" ").filter(Boolean)
}

/**
 * The curated entities a message names.
 *
 * A hit is a whole-word match on any of an entity's name words, and the longest
 * name wins when a shorter one sits inside its span: "Who is Sonoko Suzuki?" names
 * one character, not all five Suzukis, and "the Black Organization" names the thread
 * rather than James Black.
 */
function findEntities(tokens: string[]): EntityHit[] {
  const positionsOf = new Map<string, number[]>()
  tokens.forEach((token, index) => {
    const seen = positionsOf.get(token)
    if (seen) seen.push(index)
    else positionsOf.set(token, [index])
  })

  const hits: EntityHit[] = []
  for (const entity of CURATED_ENTITIES) {
    const positions: number[] = []
    for (const token of entity.tokens) {
      for (const index of positionsOf.get(token) ?? []) positions.push(index)
    }
    if (positions.length === 0) continue
    positions.sort((left, right) => left - right)
    // A name the message says in full is worth a phrase keyword: the entity branch
    // scores an exact title match above a token hit (lib/ai/retrieval/source.ts).
    const phrases = entity.parts.filter((part) =>
      part.split(" ").every((token) => positionsOf.has(token))
    )
    hits.push({ entity, positions, phrases })
  }

  // Strongest first: more of the name's words matched, then the tighter span, then
  // the source order (characters, arcs, threads, gadgets) — a stable sort, so the
  // result stays a pure function of the message.
  hits.sort(
    (left, right) => right.positions.length - left.positions.length || spanOf(left) - spanOf(right)
  )

  const kept: EntityHit[] = []
  for (const hit of hits) {
    const subsumed = kept.some(
      (stronger) =>
        stronger.positions.length > hit.positions.length &&
        hit.positions.every(
          (position) => position >= stronger.positions[0] && position <= last(stronger.positions)
        )
    )
    if (!subsumed) kept.push(hit)
  }

  return kept
}

function spanOf(hit: EntityHit): number {
  return last(hit.positions) - hit.positions[0]
}

function last(values: number[]): number {
  return values[values.length - 1]
}

/** Whether a smaller step set still asks what the message asks. */
function isComparison(message: string): boolean {
  return COMPARISON_MARKERS.some((marker) => marker.test(message))
}

function isListQuestion(message: string): boolean {
  return LIST_NOUNS.test(message) && LIST_FRAME.test(message)
}

function isChitchat(tokens: string[]): boolean {
  return tokens.every((token) => CHITCHAT_WORDS.has(token))
}

/**
 * True when the message is nothing but an episode/movie reference: every word in it
 * is framing or a number. This is the exception rule 4 carves out of `needsLore`,
 * and it is why "tell me about movie 26" asks for one document while "which arc
 * covers episodes 179 to 345?" asks for lore.
 */
function isBareNumberLookup(tokens: string[]): boolean {
  if (!tokens.some((token) => /^\d+$/.test(token))) return false
  return tokens.every((token) => BARE_NUMBER_FILLER.has(token) || /^\d+$/.test(token))
}

/** Every number in `numbers` that the message references as an episode. */
function episodeNumbers(message: string, numbers: number[]): number[] {
  const found: number[] = []
  const wanted = new Set(numbers)

  for (const match of message.matchAll(EPISODE_NOUN_PATTERN)) {
    const value = Number.parseInt(match[1], 10)
    if (wanted.has(value) && !found.includes(value)) found.push(value)
  }

  const classified = EPISODE_CLASS_PATTERN.exec(message)
  if (classified) {
    const value = Number.parseInt(classified[1], 10)
    if (wanted.has(value) && !found.includes(value)) found.push(value)
  }

  return found
}

/**
 * The episode range the message names, or null. Both endpoints must be numbers
 * `extractNumbers` returned — that is what keeps "episode 2024 to 2025" from
 * becoming a range.
 */
function episodeRange(message: string, numbers: number[]): [number, number] | null {
  const match = RANGE_PATTERN.exec(message)
  if (!match) return null

  const start = Number.parseInt(match[1], 10)
  const end = Number.parseInt(match[2], 10)
  if (!numbers.includes(start) || !numbers.includes(end)) return null

  return [start, end]
}

/**
 * The steps a plan runs, in the order that decides which survive the cap.
 *
 * The order is the retention order, so the drop order is its reverse: curated
 * catalog searches first — the executor routes `search_catalog` through the ladder
 * anyway (Task 6), so their query never reaches a tool — then the second character
 * lookup, then the floor. The floor outranks the entity steps because rule 6 makes
 * it mandatory: a plan may never be able to gather nothing.
 */
function buildSteps(input: {
  message: string
  range: [number, number] | null
  episodes: number[]
  characterHits: EntityHit[]
  catalogHits: EntityHit[]
  wantsFloor: boolean
}): PlanStep[] {
  const candidates: PlanStep[] = []

  if (input.range) {
    candidates.push({ name: "arc_for_range", start: input.range[0], end: input.range[1] })
  }

  for (const episode of input.episodes.slice(0, MAX_EPISODE_STEPS)) {
    candidates.push({ name: "classify_episode", episode })
  }

  // The floor: the question itself as a catalog search, so a lookup/compare/list
  // plan always names at least one way to find evidence.
  const trimmed = input.message.trim()
  if (input.wantsFloor && trimmed.length > 0) {
    candidates.push({ name: "search_catalog", query: trimmed.slice(0, MAX_QUERY_CHARS) })
  }

  for (const hit of input.characterHits.slice(0, MAX_CHARACTER_STEPS)) {
    // The canonical name, which `lookupCharacter` resolves exactly. The matched
    // token is not good enough: "officer" is a substring of two names, and the
    // tool returns null rather than guessing between them.
    candidates.push({
      name: "lookup_character",
      name_query: hit.entity.label.slice(0, MAX_NAME_QUERY_CHARS),
    })
  }

  for (const hit of input.catalogHits) {
    candidates.push({ name: "search_catalog", query: hit.entity.label.slice(0, MAX_QUERY_CHARS) })
  }

  return dedupeSteps(candidates).slice(0, STEP_LIMIT)
}

/** First occurrence wins, so a name matched twice spends one step. */
function dedupeSteps(steps: PlanStep[]): PlanStep[] {
  const seen = new Set<string>()
  const kept: PlanStep[] = []

  for (const step of steps) {
    const identity = JSON.stringify(
      Object.entries(step).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    )
    if (seen.has(identity)) continue
    seen.add(identity)
    kept.push(step)
  }

  return kept
}

/** The ladder's retrieval hints: the user's own words, plus the names recognized. */
function buildKeywords(message: string, hits: EntityHit[], tokens: string[]): string[] {
  const candidates = [
    ...tokenize(message, MAX_PLAN_KEYWORDS),
    ...hits.flatMap((hit) => hit.positions.map((position) => tokens[position])),
    ...hits.flatMap((hit) => hit.phrases),
  ]

  const seen = new Set<string>()
  const keywords: string[] = []

  for (const candidate of candidates) {
    // A name longer than the cap is truncated rather than dropped: a 4 kB token is
    // still a word the user typed, and the schema rejects an over-long keyword.
    const keyword = candidate.slice(0, MAX_KEYWORD_CHARS)
    if (!keyword || seen.has(keyword)) continue
    seen.add(keyword)
    keywords.push(keyword)
  }

  // Most specific first, the order `tokenize` uses, so the cap keeps the terms with
  // the most discriminating power.
  return keywords.sort((left, right) => right.length - left.length).slice(0, MAX_PLAN_KEYWORDS)
}

/**
 * One plan per request, from the message alone.
 *
 * `priorUserMessages` and `now` are part of the shape Task 3 shares and are
 * deliberately unread here: a plan that depended on history would not be a function
 * of the message, and this router's determinism is what the tests and the fixture
 * calibration rest on.
 */
export function routeQuery(input: {
  message: string
  priorUserMessages?: string[]
  now?: () => number
}): RoutedPlan {
  // A non-string is a caller bug, not a request. Planning an empty message answers
  // it without a throw, because this runs on the answer path.
  const message = typeof input.message === "string" ? input.message : ""

  const tokens = messageTokens(message)
  const numbers = extractNumbers(message)
  const hits = findEntities(tokens)
  const characterHits = hits.filter((hit) => hit.entity.kind === "character")
  const catalogHits = hits.filter((hit) => hit.entity.kind !== "character")

  const range = episodeRange(message, numbers)
  // A range answers its own span, so the endpoints are not also single-episode
  // questions — the user asked about 100-120, not about 100.
  const episodes = episodeNumbers(message, numbers).filter(
    (episode) => !range || episode < range[0] || episode > range[1]
  )

  const allowed = classifyChatIntent(message).action === "allow"
  const intent = planIntent({ allowed, message, tokens, hits })

  const needsLore =
    allowed && !isBareNumberLookup(tokens) && LORE_MARKERS.some((marker) => marker.test(message))

  // The floor is for the question-shaped intents; a greeting and a refusal have
  // nothing to gather, and a floor search for "hello!" would return noise.
  const wantsFloor = intent === "lookup" || intent === "compare" || intent === "list"

  const candidate: QueryPlan = {
    intent,
    steps: buildSteps({ message, range, episodes, characterHits, catalogHits, wantsFloor }),
    // A refused question is never retrieved for, so its words are not hints.
    keywords: intent === "out_of_scope" ? [] : buildKeywords(message, hits, tokens),
    numbers,
    needsLore,
    preferRecent: prefersRecent(message),
    preferEarliest: prefersEarliest(message),
  }

  // Belt and braces. The plan is built inside the schema's bounds — keywords are
  // truncated, numbers come from `extractNumbers`, steps are deduped and capped — so
  // this parse is expected to be a no-op, but "a runnable plan, never a throw" is
  // this function's contract and this is where it is enforced.
  const parsed = parseQueryPlan(candidate)
  const plan = parsed ?? EMPTY_PLAN
  const accepted = parsed !== null

  // The false conditions are checked first, so a lore-shaped or comparison question
  // is never confident even when it also matches a true one (rule 7).
  let why: RouterWhy
  if (intent === "out_of_scope") why = "out-of-scope"
  else if (needsLore) why = "lore"
  else if (intent === "compare") why = "ambiguous"
  else if (intent === "list") why = "list"
  else if (!accepted) why = "ambiguous"
  else if (isBareNumberLookup(tokens)) why = "bare-number"
  else if (intent === "chitchat") why = "chitchat"
  else if (hasPreciseStep(plan) && plan.keywords.length > 0) why = "exact-entity"
  else why = "ambiguous"

  return { plan, confident: accepted && isConfident(why), why }
}

/** A step that names something: the questions a model would not ask again about. */
function hasPreciseStep(plan: QueryPlan): boolean {
  return plan.steps.some(
    (step) =>
      step.name === "classify_episode" ||
      step.name === "arc_for_range" ||
      step.name === "lookup_character"
  )
}

/**
 * What the question asks for, from the message's shape alone. A refusal comes from
 * `classifyChatIntent`, so the router and the route's own gate can never disagree
 * about what is out of domain.
 */
function planIntent(input: {
  allowed: boolean
  message: string
  tokens: string[]
  hits: EntityHit[]
}): QueryPlan["intent"] {
  if (!input.allowed) return "out_of_scope"
  if (isComparison(input.message) && input.hits.length >= 2) return "compare"
  if (isListQuestion(input.message)) return "list"
  // No words at all (an empty message, an emoji) is nothing to look up rather than
  // a question the corpus might answer.
  if (input.tokens.length === 0 || isChitchat(input.tokens)) return "chitchat"
  return "lookup"
}

/**
 * The confident reasons: an unambiguous answer to "what is this about". Everything
 * else — a comparison, a lore question, a question whose plan is only the floor —
 * is what D1 spends the planner's call on.
 */
function isConfident(why: RouterWhy): boolean {
  return (
    why === "out-of-scope" ||
    why === "list" ||
    why === "bare-number" ||
    why === "exact-entity" ||
    why === "chitchat"
  )
}
