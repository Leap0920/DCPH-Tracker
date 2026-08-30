/**
 * Shared chat limits.
 *
 * Deliberately free of "server-only" and of any Supabase import: this module is
 * imported by BOTH the server route (app/api/chat/route.ts) and the client
 * component (components/community/ChatWindow.tsx), so it must stay isomorphic.
 * The server cap is authoritative; the client `maxLength` is UX only.
 */
export const MAX_MESSAGE_LENGTH = 2000

