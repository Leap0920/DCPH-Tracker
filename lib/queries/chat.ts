import { createClient } from "@/utils/supabase/server"
import type { Database } from "@/types/database.types"

type ChatRoom = Database["public"]["Tables"]["chat_rooms"]["Row"]
type ChatMessage = Database["public"]["Tables"]["chat_messages"]["Row"]

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
    .select("*, profiles:user_id(username, display_name, avatar_url)")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) throw error

  return data ?? []
}

export async function sendChatMessage(
  roomId: string,
  userId: string,
  content: string
) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({ room_id: roomId, user_id: userId, content })
    .select("*, profiles:user_id(username, display_name, avatar_url)")
    .single()

  if (error) throw error

  return data
}
