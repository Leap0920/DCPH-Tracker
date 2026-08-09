/**
 * Query-key factory — the single source of truth for react-query cache keys.
 *
 * Every key is a FLAT array (never nested objects) so serialization is stable
 * and `invalidateQueries` prefix-matching works. Per-user keys include the
 * userId/username as a segment so data never cross-contaminates between users.
 *
 * Pure module — zero imports, safe from any context.
 */
export const queryKeys = {
  content: {
    all: () => ["content", "all"] as const,
    bySlug: (slug: string) => ["content", "bySlug", slug] as const,
  },
  watchStatus: {
    all: (userId: string) => ["watchStatus", "all", userId] as const,
    byContent: (userId: string, contentId: string) =>
      ["watchStatus", "byContent", userId, contentId] as const,
  },
  analytics: {
    self: (userId: string) => ["analytics", "self", userId] as const,
  },
  leaderboard: {
    all: () => ["leaderboard", "all"] as const,
  },
  profile: {
    byUsername: (username: string) => ["profile", "byUsername", username] as const,
    byId: (userId: string) => ["profile", "byId", userId] as const,
    stats: (userId: string) => ["profile", "stats", userId] as const,
  },
  chat: {
    rooms: () => ["chat", "rooms"] as const,
    roomBySlug: (slug: string) => ["chat", "roomBySlug", slug] as const,
    messages: (roomId: string) => ["chat", "messages", roomId] as const,
  },
} as const
