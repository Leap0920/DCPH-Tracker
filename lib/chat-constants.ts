/**
 * Shared chat limits.
 *
 * Deliberately free of "server-only" and of any Supabase import: this module is
 * imported by BOTH the server route (app/api/chat/route.ts) and the client
 * component (components/community/ChatWindow.tsx), so it must stay isomorphic.
 * The server cap is authoritative; the client `maxLength` is UX only.
 */
export const MAX_MESSAGE_LENGTH = 2000

/**
 * How long a chat message survives before the scheduled purge deletes it.
 *
 * The pg_cron job in supabase/migration-chat-purge-12h.sql is AUTHORITATIVE;
 * this constant only drives the notice under the composer. If you change the
 * retention interval in that SQL file, change this number to match, or the UI
 * will lie to users about how long their history lasts.
 */
export const CHAT_RETENTION_HOURS = 12
