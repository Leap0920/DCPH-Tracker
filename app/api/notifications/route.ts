import { createClient } from "@/utils/supabase/server"
import { ok, fail, handleApiError } from "@/lib/api-utils"
import {
  getNotifications,
  getUnreadCount,
  markAllRead,
} from "@/lib/queries/notifications"

/**
 * In-app notification bell API.
 *
 * RLS-safe: every query runs through the logged-in user's server client
 * (own-rows-only policies on `notifications`). The admin/service-role client
 * is deliberately NOT used — notification rows are written by the SECURITY
 * DEFINER triggers in supabase/migration-notifications.sql, never by app code.
 */

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return fail(401, "Unauthorized")
    }

    const [items, unreadCount] = await Promise.all([
      getNotifications(user.id),
      getUnreadCount(user.id),
    ])

    return ok({ items, unreadCount })
  } catch (error) {
    return handleApiError(error, "notifications")
  }
}

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return fail(401, "Unauthorized")
    }

    await markAllRead(user.id)

    return ok({ success: true })
  } catch (error) {
    return handleApiError(error, "notifications")
  }
}
