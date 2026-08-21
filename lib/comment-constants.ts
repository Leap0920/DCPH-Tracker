/**
 * Shared comment limits.
 *
 * Deliberately free of "server-only" and of any Supabase import: this module is
 * imported by BOTH the server route (app/api/comments/route.ts) and the client
 * component (components/tracker/CommentSection.tsx), so it must stay isomorphic.
 * Mirrors lib/chat-constants.ts. The server cap is authoritative; the client
 * `maxLength` is UX only.
 */
export const MAX_COMMENT_LENGTH = 2000
