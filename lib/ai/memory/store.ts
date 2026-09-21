/**
 * The memory store: the policy layer over the memory port.
 *
 * The port is a faithful view of the table; the rules that make a fact safe to
 * read live here, so a caller cannot forget them:
 *
 * - `loadActive` re-checks both halves of "active" -- the status and the expiry.
 *   The adapter filters the status in SQL, but the expiry is a clock decision,
 *   and a progress fact whose status was never flipped would otherwise reach the
 *   prompt as a fact contradicting the tracker the user just updated (rule 2).
 * - `list` is the transparency payload, so it is grouped for a reader: active
 *   facts first, then superseded, each newest-confirmed first, capped at
 *   `MEMORY_LIST_LIMIT`.
 * - `delete` never throws. An id that is not the user's, an id that is not
 *   there, and a database that could not answer are all the same answer --
 *   `false` -- because the route turns it into a 404, and that response must not
 *   distinguish the cases.
 *
 * No I/O of its own: the port is injected and the clock is injected, so a test
 * runs every branch offline (constraint 11).
 */

import type { MemoryFact, MemoryPort, NewFact } from "@/lib/ai/memory/port"

/** How many facts the transparency endpoint returns when the caller names no limit. */
export const MEMORY_LIST_LIMIT = 50

/**
 * The reading order for the transparency list. Expired facts are history the
 * same way superseded ones are, so they are shown -- last, because a fact the
 * user can no longer rely on is not what they came to read.
 */
const LIST_STATUS_RANK: Record<MemoryFact["status"], number> = {
  active: 0,
  superseded: 1,
  expired: 2,
}

export interface MemoryStore extends Omit<MemoryPort, "list"> {
  list(userId: string, limit?: number): Promise<MemoryFact[]>
}

export interface MemoryStoreDeps {
  port: MemoryPort
  /** Injected so every test runs on a fixed clock (constraint 11). */
  now?: () => number
  /** Accepted so a caller can hand the store its logger; only `delete` logs. */
  log?: (msg: string) => void
}

/** Active first, then newest-confirmed, then id: a page whose order never flickers. */
function compareForList(a: MemoryFact, b: MemoryFact): number {
  const rank = LIST_STATUS_RANK[a.status] - LIST_STATUS_RANK[b.status]
  if (rank !== 0) return rank
  if (a.lastConfirmedAt !== b.lastConfirmedAt) return b.lastConfirmedAt - a.lastConfirmedAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function createMemoryStore(deps: MemoryStoreDeps): MemoryStore {
  const port = deps.port
  const now = deps.now ?? Date.now
  const log = deps.log ?? (() => {})

  return {
    async loadActive(userId) {
      const facts = await port.loadActive(userId)
      // One clock reading for the whole page, so two facts written with the
      // same expiry cannot land on different sides of it.
      const at = now()
      return facts.filter((fact) => fact.status === "active" && !isExpired(fact, at))
    },

    async countActive(userId) {
      return port.countActive(userId)
    },

    async insert(userId, fact: NewFact, at) {
      return port.insert(userId, fact, at)
    },

    async update(userId, id, patch, at) {
      return port.update(userId, id, patch, at)
    },

    async supersede(userId, oldId, replacement, at) {
      // The port's single atomic write, and the store adds nothing around it: a
      // store that marked the old row and then inserted the new one would be
      // racing the partial unique index on the active slot (rule 3).
      return port.supersede(userId, oldId, replacement, at)
    },

    async list(userId, limit = MEMORY_LIST_LIMIT) {
      // The port's limit bounds the read; the sort and the second cap bound the
      // answer, so a port that ignores its limit cannot widen the page.
      const facts = await port.list(userId, limit)
      return facts.slice().sort(compareForList).slice(0, limit)
    },

    async delete(userId, id) {
      try {
        return await port.delete(userId, id)
      } catch (error) {
        // Swallowed deliberately (rule 4): the response is a 404 either way,
        // and an exception here would charge the user a 500 for a delete they
        // can simply retry.
        log(`[ai-memory] delete failed: ${messageOf(error)}`)
        return false
      }
    },
  }
}

/**
 * An expired fact is one whose shelf life has run out, whether or not the
 * status column was ever updated: the status is a write that may not have
 * happened, the expiry is the fact itself.
 */
function isExpired(fact: MemoryFact, at: number): boolean {
  return fact.expiresAt !== null && fact.expiresAt <= at
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
