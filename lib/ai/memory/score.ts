/**
 * Decay scoring and selection for the user's long-term facts.
 *
 * The spec's formula (`0.55*lexical + 0.25*confidence + 0.20*exp(-age/45)`) in
 * JS, over the <= 50 active facts a user can have (D7's cap). Two properties
 * are load-bearing, and both come from this running on the response path
 * (constraint 14): it is pure and synchronous -- the facts are already in
 * memory, `now` is handed in, and there is no I/O, no logging and no timer --
 * and it is bounded in both dimensions, by MEMORY_LIMIT facts and by
 * MEMORY_TOKEN_BUDGET tokens of prompt.
 *
 * Tokenisation is imported from `lib/chat/query.ts` rather than re-implemented
 * (constraint 16, that file is read-only): retrieval and memory must agree on
 * what a question's keywords are, or a fact would be selected by a match the
 * tracker search would never have made.
 */

import { normalizeText, tokenize } from "@/lib/chat/query"
import type { MemoryFact } from "@/lib/ai/memory/port"

/**
 * The age at which a fact's recency term halves.
 *
 * 45 days is long enough that a stated preference survives a season of not
 * being mentioned, and short enough that a watch-progress fact from another
 * year stops competing with what the user is asking about now. The half-life
 * form is deliberate: a linear decay would drop every old fact to zero at a
 * cutoff, while this one makes an old fact weak rather than absent, which is
 * what lets confidence and relevance still speak for it.
 */
export const HALF_LIFE_DAYS = 45

/**
 * The weights. Relevance is the majority of the score on purpose -- a
 * confident, recent fact about something else is noise in the prompt, and this
 * is the memory analogue of the retrieval rule that a wrong context costs more
 * than a missing one. Confidence is worth more than recency because it is
 * evidence: a fact stated twice yesterday and once ten months ago are not the
 * same claim, and the second one should not win on freshness alone.
 *
 * The three sum to 1, so a fully matched, fully confident, just-confirmed fact
 * scores exactly 1 and nothing can score above it.
 */
export const W_LEXICAL = 0.55
export const W_CONFIDENCE = 0.25
export const W_RECENCY = 0.20

/** How many facts may reach the prompt, however many matched. */
export const MEMORY_LIMIT = 12

/**
 * How much prompt room memory may take. Small next to the corpus sections:
 * memory is a personalisation layer, never ground truth (constraint 15), so it
 * is the first thing that should run out of room.
 */
export const MEMORY_TOKEN_BUDGET = 200

/** The repo's rough token estimate, shared with the block accounting. */
export const CHARS_PER_TOKEN = 4

const MS_PER_DAY = 86_400_000

export interface SelectMemoriesOptions {
  limit?: number
  tokenBudget?: number
  now?: number
}

/**
 * The fraction of the query's tokens this fact mentions, as a substring of its
 * key and value.
 *
 * Substring rather than whole-word matching, for the same reason the tracker
 * search uses `ilike`: a remembered value is free text ("caught up to episode
 * 500"), and a word-boundary rule would miss the plural or the inflection that
 * carries the match.
 *
 * An empty token list scores 0, not 1: a message with no keywords ("hi") must
 * fall back to confidence and recency rather than make every stored fact look
 * perfectly relevant.
 */
export function lexicalMatch(queryTokens: string[], fact: MemoryFact): number {
  if (queryTokens.length === 0) return 0

  const haystack = normalizeText(`${fact.key} ${fact.value}`)
  let matched = 0

  for (const token of queryTokens) {
    // Normalising the token as well keeps the comparison honest when a caller
    // passes a raw word; an empty token matches nothing.
    const needle = normalizeText(token)
    if (needle.length > 0 && haystack.includes(needle)) matched += 1
  }

  return matched / queryTokens.length
}

/**
 * The fact's relevance to the query at `now`, in [0, 1].
 *
 * `ageDays` is clamped at 0: a `lastConfirmedAt` in the future is clock skew,
 * not extra evidence, and it must not score above the perfect 1.
 */
export function scoreMemory(fact: MemoryFact, queryTokens: string[], now: number): number {
  const ageDays = Math.max(0, (now - fact.lastConfirmedAt) / MS_PER_DAY)

  return (
    W_LEXICAL * lexicalMatch(queryTokens, fact) +
    W_CONFIDENCE * fact.confidence +
    W_RECENCY * Math.exp(-ageDays / HALF_LIFE_DAYS)
  )
}

interface RankedFact {
  fact: MemoryFact
  score: number
}

/** Score desc, then newest confirmation, then id: ties never flicker between runs. */
function compareRanked(a: RankedFact, b: RankedFact): number {
  if (b.score !== a.score) return b.score - a.score
  if (a.fact.lastConfirmedAt !== b.fact.lastConfirmedAt) {
    return b.fact.lastConfirmedAt - a.fact.lastConfirmedAt
  }
  return a.fact.id < b.fact.id ? -1 : a.fact.id > b.fact.id ? 1 : 0
}

/**
 * The facts worth putting in front of the model, best first.
 *
 * Drops what the store's policy cannot: a fact must be `active` and must not
 * have passed its `expiresAt` -- the expiry is a clock decision the status
 * column may not have caught up with (Task 8 rule 2).
 *
 * The token budget is a prefix of the ranking, not a knapsack: once a fact
 * does not fit, the facts behind it are dropped too, because skipping ahead
 * would spend the prompt room on a lower-ranked fact while the better one is
 * missing. The one exception is the first fact -- a single fact larger than the
 * whole budget is rendered truncated rather than dropped, since "the memory is
 * enormous" must not read to the model as "the memory is empty".
 */
export function selectMemories(
  facts: MemoryFact[],
  query: string,
  options: SelectMemoriesOptions = {}
): MemoryFact[] {
  const limit = options.limit ?? MEMORY_LIMIT
  const tokenBudget = options.tokenBudget ?? MEMORY_TOKEN_BUDGET
  // The only clock reading, and only when the caller supplies none (Task 12's
  // call site passes facts and a message): every test pins it instead.
  const now = options.now ?? Date.now()
  const tokens = tokenize(query)

  const ranked = facts
    .filter((fact) => fact.status === "active" && (fact.expiresAt === null || fact.expiresAt > now))
    .map((fact) => ({ fact, score: scoreMemory(fact, tokens, now) }))
    .sort(compareRanked)
    .slice(0, limit)

  const chosen: MemoryFact[] = []
  let used = 0

  for (const { fact } of ranked) {
    const cost = Math.ceil(renderLine(fact).length / CHARS_PER_TOKEN)
    if (used + cost <= tokenBudget) {
      chosen.push(fact)
      used += cost
      continue
    }

    if (chosen.length === 0) {
      const shortened = truncateFact(fact, tokenBudget * CHARS_PER_TOKEN)
      if (shortened !== null) chosen.push(shortened)
    }
    break
  }

  return chosen
}

/**
 * The prompt block: one `[MEM]` line per fact, and nothing else.
 *
 * The surrounding wording -- the section heading and the precedence rule -- is
 * the prompt builder's, so this function states nothing it was not given. An
 * empty list returns "": the caller then injects no section at all, which is
 * what keeps today's prompt byte-identical for a user with no facts (Task 11
 * rule 3).
 */
export function renderMemoryBlock(facts: MemoryFact[]): string {
  return facts.map(renderLine).join("\n")
}

/** The one rendering the budget arithmetic and the prompt block share. */
function renderLine(fact: MemoryFact): string {
  return `[MEM] ${fact.key}: ${fact.value} (conf ${roundConfidence(fact.confidence)})`
}

/** Rounded, not padded: the format is "0.9", not "0.90". */
function roundConfidence(confidence: number): number {
  return Math.round(confidence * 100) / 100
}

/**
 * A copy of the fact whose value is cut until its line fits `maxChars`, or null
 * when even the key and the confidence tag do not fit -- a line with no value
 * left says nothing, so the caller drops it. The caller's fact is never
 * mutated; the copy is what `renderMemoryBlock` will then render inside the
 * budget.
 */
function truncateFact(fact: MemoryFact, maxChars: number): MemoryFact | null {
  const prefix = `[MEM] ${fact.key}: `
  const suffix = ` (conf ${roundConfidence(fact.confidence)})`
  const room = maxChars - prefix.length - suffix.length
  if (room < 1) return null

  return { ...fact, value: fact.value.slice(0, room).trimEnd() }
}
