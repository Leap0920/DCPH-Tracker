import type { ChatMessage } from "@/lib/queries/client/chat"

/**
 * A freshly fetched row and a still-pending optimistic row are treated as the
 * same send when author, text and timestamp all line up this closely.
 */
export const ECHO_WINDOW_MS = 20_000

/** Optimistic rows carry a client-side id with this prefix. */
export const TEMP_ID_PREFIX = "temp-"

/**
 * Merge a freshly fetched page into what the cache already holds, newest-first.
 *
 * Polling makes this necessary. Letting react-query replace the array wholesale
 * would:
 *   - blink out an in-flight optimistic send whose POST has not returned yet
 *   - discard pages pulled in by "Load earlier" (they are older than the
 *     latest-100 window, so a refetch never contains them)
 *   - resurrect a message this client just unsent, if the poll raced the DELETE
 *
 * `removedIds` is the tombstone set for that last case: ids this client has
 * deleted, or seen deleted over realtime. It always wins.
 */
export function mergeChatMessages(
  previous: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
  removedIds: ReadonlySet<string> = new Set()
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>()
  const pending: ChatMessage[] = []

  for (const msg of previous) {
    if (msg.id.startsWith(TEMP_ID_PREFIX)) pending.push(msg)
    else if (!removedIds.has(msg.id)) byId.set(msg.id, msg)
  }
  // Incoming wins on conflict: it carries the server's content (post-redaction)
  // and the author profile.
  for (const msg of incoming) {
    if (msg.id.startsWith(TEMP_ID_PREFIX)) continue
    if (!removedIds.has(msg.id)) byId.set(msg.id, msg)
  }

  const real = [...byId.values()].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1
    // Stable tie-break so equal timestamps do not reorder between polls.
    return b.id.localeCompare(a.id)
  })

  // Drop an optimistic row once its real counterpart has landed by another
  // route. Each real row may claim only ONE temp, so sending "ok" twice in a
  // row does not silently lose the second bubble.
  const claimed = new Set<string>()
  const stillPending = pending.filter((temp) => {
    const tempAt = new Date(temp.created_at).getTime()
    const match = real.find(
      (m) =>
        !claimed.has(m.id) &&
        m.user_id === temp.user_id &&
        m.content === temp.content &&
        Math.abs(new Date(m.created_at).getTime() - tempAt) < ECHO_WINDOW_MS
    )
    if (!match) return true
    claimed.add(match.id)
    return false
  })

  // Temps are the newest thing on screen, and the cache is newest-first.
  return [...stillPending, ...real]
}
