/**
 * The memory vocabulary: five kinds and fifteen slot keys.
 *
 * Extraction is guided to this list and anything outside it is dropped, so the
 * vocabulary is the contract between the model's free text and the slot lookup
 * consolidation performs. It lives in one module for that reason: both sides
 * must answer "is this a slot we know?" the same way, or a fact is written
 * under a key nothing will ever read back.
 *
 * `as const` is load-bearing: the Zod enum in `extract.ts` is built from
 * `MEMORY_KINDS` and `SlotKey` is derived from `SLOT_KEYS`, so the runtime list
 * and the types can never drift apart.
 */

export const MEMORY_KINDS = ["preference", "progress", "identity", "interest", "constraint"] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

/** The controlled vocabulary. Extraction is guided to it, and anything outside it is dropped. */
export const SLOT_KEYS = [
  "favorite_character", "favorite_movie", "favorite_episode", "favorite_case", "favorite_arc",
  "disliked_character", "disliked_element", "watch_progress", "watch_status", "watch_plan",
  "preferred_name", "spoiler_tolerance", "language_preference", "answer_style", "community_interest",
] as const
export type SlotKey = (typeof SLOT_KEYS)[number]

/**
 * How long a progress fact stays valid. The tracker is authoritative and moves
 * on, so a fact older than this would have the prompt contradict the data the
 * user just submitted.
 */
const PROGRESS_TTL_DAYS = 90

const SLOT_KEY_SET: ReadonlySet<string> = new Set(SLOT_KEYS)

/**
 * The canonical form of a slot key: lowercase, every run of non-alphanumerics
 * folded into one `_`, and no leading or trailing separator. The model writes
 * "Favorite Character", "favorite-character" and "favorite  character" alike,
 * and all three have to reach the same stored slot.
 */
export function normalizeSlotKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

/**
 * Normalizes before comparing, so a caller may hand over the model's raw key.
 * The predicate is what makes the controlled vocabulary enforce itself: an
 * unknown key is dropped rather than stored under a slot nothing reads.
 */
export function isKnownSlot(raw: string): raw is SlotKey {
  return SLOT_KEY_SET.has(normalizeSlotKey(raw))
}

/**
 * Only `watch_progress` expires. A remembered watch status or plan is a
 * statement of intent that stays true until the user says otherwise, while a
 * remembered episode number is a claim about data the tracker owns — keeping it
 * past its shelf life is what would put a stale fact in front of a fresh one.
 */
export function isProgressSlot(key: SlotKey): boolean {
  return key === "watch_progress"
}

/** The expiry a progress slot is written with: `now` plus the 90-day shelf life. */
export function progressExpiry(now: number): number {
  return now + PROGRESS_TTL_DAYS * 24 * 60 * 60 * 1000
}
