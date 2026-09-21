/**
 * The transparency feature's two pure functions: the matcher that recognises a
 * question about the user's own remembered facts, and the plain-text answer to
 * it.
 *
 * The matcher is the riskiest code in this phase, because the chat route turns a
 * match into a direct answer that skips retrieval entirely. A false positive
 * therefore hijacks a tracker question -- "what do you remember about episode
 * 5" would come back as a list of remembered facts instead of an episode -- so
 * the rule is deliberately narrow in one direction only: the question must make
 * the USER the object ("about me", "my memories"), and any question naming a
 * tracker noun is rejected before the object patterns are even consulted. A
 * false negative costs a little latency and a model call; a false positive costs
 * the answer.
 *
 * No I/O, no clock, no randomness: the route calls this on the response path
 * before retrieval (constraint 14), so it has to be instant and offline-testable.
 */

import type { MemoryFact } from "@/lib/ai/memory/port"
import { MEMORY_KINDS, type MemoryKind } from "@/lib/ai/memory/slots"

/**
 * The nouns the tracker, the corpus and the wiki own. A question containing one
 * of these is a domain question whatever else it says: "my memories of episode
 * 5" is asking about episode 5, and "do you know what episode I'm on" is asking
 * the tracker, not the memory table.
 */
const DOMAIN_NOUN =
  /\b(?:episodes?|movies?|ovas?|specials?|seasons?|chapters?|mangas?|arcs?|cases?|crimes?|murders?|victims?|suspects?|culprits?|killers?|heists?|gadgets?|characters?|trackers?|fillers?|canons?|villains?|organizations?|watch order|watchlist)\b/i

/**
 * Character names are domain nouns too, and they are the shape a memory question
 * most plausibly collides with ("what do you know about me and Haibara" is a
 * question about Haibara). Kept separate from the list above because it is a
 * different reason for the same veto.
 */
const CHARACTER_NAME =
  /\b(?:conan|shinichi|haibara|sherry|kogoro|mouri|mori|ran|kaito|kid|vermouth|heiji|kazuha|akai|amuro|bourbon|agasa|sonoko|yusaku|yukiko)\b/i

/**
 * The user as the object of the question. Each form names the user explicitly,
 * which is what separates "what do you remember about me" from the bare "what do
 * you remember": the latter has no object at all, and the assistant's memory of
 * the series is not a stored fact.
 *
 * The distance bound in the first pattern keeps a memory cue in one sentence
 * from reaching an "about me" in the next; the perfect-tense form is its own
 * rule because "what have you remembered" states its object as the conversation
 * so far rather than repeating "about me".
 */
const USER_AS_OBJECT: RegExp[] = [
  /\b(?:remember|remembered|remembers|recall|recalled|recalls|know|knows|knew|memorized|memorised|memories|memory)\b[^?!.]{0,60}?\babout\s+(?:me|myself)\b/,
  /\b(?:my|mine)\s+(?:memor(?:y|ies)|facts?)\b/,
  /\bwhat\s+(?:have|has|'ve)\s+you\s+(?:remembered|recalled|memorized|memorised)\b/,
  /\b(?:do|did|can|could)\s+you\s+(?:remember|recall|know)\s+me\b/,
]

/** True only for questions about the USER's remembered facts. */
export function isMemoryRecallQuestion(text: string): boolean {
  if (typeof text !== "string") return false
  const normalized = text
    .trim()
    .toLowerCase()
    // An apostrophe typed as a typographic quote must not hide the perfect
    // tense ("what've you remembered") from the pattern that reads it.
    .replace(/[\u2018\u2019]/g, "'")
  if (normalized.length === 0) return false

  // Veto first: a tracker question never becomes a memory one, even when it
  // mentions the user.
  if (DOMAIN_NOUN.test(normalized) || CHARACTER_NAME.test(normalized)) return false

  return USER_AS_OBJECT.some((pattern) => pattern.test(normalized))
}

/**
 * How groups are headed. The kinds themselves are the storage vocabulary
 * (`favorite_character`, `watch_progress`), which is not what a user reads.
 */
const KIND_LABELS: Record<MemoryKind, string> = {
  preference: "Preferences",
  progress: "Progress",
  identity: "Identity",
  interest: "Interests",
  constraint: "Constraints",
}

const HEADER = "Here is what I remember about you:"

const DELETE_HINT = "You can delete any of these from your memory list."

/**
 * The empty case states the two things a user needs to know and neither of them
 * is a fact: nothing is stored, and a fact comes from what they say in
 * conversation. The deletion sentence is here as well as in the list, because
 * "how do I remove something" is asked most often by someone who has just seen
 * what is there.
 */
const NOTHING_STORED =
  "I do not have anything remembered about you yet. I pick facts up from what you tell me in conversation — a favorite character, where you are in the series, that sort of thing — and you can delete anything I remember from your memory list."

/**
 * The answer to a recall question: the user's own facts, grouped by kind in
 * `MEMORY_KINDS` order and newest-confirmed first inside each group, with the
 * confidence visible.
 *
 * Only `active` facts are rendered -- a superseded value is a value the user
 * has already replaced, and repeating it would read as the bot contradicting
 * them -- and every line comes from a fact that was handed in, so the answer
 * cannot invent one. An expired-but-active fact is the caller's to filter
 * (the store's `loadActive` owns that clock decision); this function has no
 * clock precisely so it stays pure.
 */
export function renderMemoryAnswer(facts: MemoryFact[]): string {
  const active = facts.filter((fact) => fact.status === "active")
  if (active.length === 0) return NOTHING_STORED

  const lines = [HEADER]

  for (const kind of MEMORY_KINDS) {
    // A copy before sorting: the caller's array is not this function's to
    // reorder, and the store hands the same list to more than one reader.
    const group = active.filter((fact) => fact.kind === kind).sort(compareNewestFirst)
    if (group.length === 0) continue

    lines.push("", KIND_LABELS[kind])
    for (const fact of group) {
      lines.push(`- ${fact.key}: ${fact.value} (confidence ${fact.confidence.toFixed(2)})`)
    }
  }

  lines.push("", DELETE_HINT)
  return lines.join("\n")
}

/** Newest confirmation first, then id: the same tie-break the store's list uses. */
function compareNewestFirst(a: MemoryFact, b: MemoryFact): number {
  if (a.lastConfirmedAt !== b.lastConfirmedAt) return b.lastConfirmedAt - a.lastConfirmedAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
