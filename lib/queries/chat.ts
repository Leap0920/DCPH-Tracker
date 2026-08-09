import { createClient } from "@/utils/supabase/server"
import type { Database } from "@/types/database.types"

type ChatRoom = Database["public"]["Tables"]["chat_rooms"]["Row"]
type ChatProfile = {
  username: string
  display_name: string
  avatar_url: string | null
}
type ChatMessage = Database["public"]["Tables"]["chat_messages"]["Row"] & {
  profiles: ChatProfile | null
}

// chat_messages.user_id references auth.users(id) — there is NO foreign key to
// profiles, so PostgREST cannot embed profiles here. We fetch author profiles
// in a second query and join them in code (see attachProfiles).
const MESSAGE_COLUMNS = "id, room_id, user_id, content, created_at"

async function attachProfiles<T extends { user_id: string }>(
  rows: T[],
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<(T & { profiles: ChatProfile | null })[]> {
  const ids = [...new Set(rows.map((r) => r.user_id))]
  if (ids.length === 0) return rows as (T & { profiles: ChatProfile | null })[]
  const { data: profs } = await supabase
    .from("profiles")
    .select("user_id, username, display_name, avatar_url")
    .in("user_id", ids)
  const byId = new Map((profs ?? []).map((p) => [p.user_id, p]))
  return rows.map((r) => ({ ...r, profiles: byId.get(r.user_id) ?? null }))
}

export async function getChatRooms() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("chat_rooms")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true })

  if (error) throw error

  return data ?? []
}

export async function getChatRoomBySlug(slug: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("chat_rooms")
    .select("*")
    .eq("slug", slug)
    .single()

  if (error) throw error

  return data
}

export async function getChatMessages(roomId: string, limit = 50) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("chat_messages")
    .select(MESSAGE_COLUMNS)
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) throw error

  return attachProfiles((data ?? []) as { user_id: string }[], supabase)
}

export async function sendChatMessage(
  roomId: string,
  userId: string,
  content: string,
  senderProfile: ChatProfile | null
) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({ room_id: roomId, user_id: userId, content })
    .select(MESSAGE_COLUMNS)
    .single()

  if (error) throw error

  return { ...(data as ChatMessage), profiles: senderProfile }
}
