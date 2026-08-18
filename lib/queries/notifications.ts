import { createClient } from "@/utils/supabase/server"

/**
 * One in-app notification, flattened for the bell. `slug` comes from a
 * LEFT JOIN on content_entries so the bell can link comment_reply items
 * to `/tracker/<slug>`; it is null for chat_mention rows (content_id is
 * null for those).
 */
export interface NotificationItem {
  id: string
  type: "comment_reply" | "chat_mention"
  message: string
  is_read: boolean
  created_at: string
  slug: string | null
}

/**
 * A user's notifications, newest first.
 *
 * RLS on notifications is own-rows only (see supabase/migration-notifications.sql),
 * so this must run through the authenticated server client — never the anon
 * client and never the admin client.
 */
export async function getNotifications(
  userId: string,
  limit = 20
): Promise<NotificationItem[]> {
  const supabase = await createClient()

  const { data: rows, error } = await supabase
    .from("notifications")
    .select("id, type, message, is_read, created_at, content_entries(slug)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw error

  return (rows ?? []).map((row) => {
    // The FK embed may come back as a single object (PostgREST to-one join)
    // or an array depending on the declared relationship — same defensive
    // handling as getUserFavorites (lib/queries/favorites.ts).
    const entry = Array.isArray(row.content_entries)
      ? row.content_entries[0]
      : row.content_entries
    return {
      id: row.id,
      type: row.type,
      message: row.message,
      is_read: row.is_read,
      created_at: row.created_at,
      slug: entry?.slug ?? null,
    }
  })
}

/** Number of unread notifications for the bell badge. */
export async function getUnreadCount(userId: string): Promise<number> {
  const supabase = await createClient()

  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false)

  if (error) throw error
  return count ?? 0
}

/** Marks every unread notification of the user as read. */
export async function markAllRead(userId: string): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("is_read", false)

  if (error) throw error
}
