import { createClient } from "@/utils/supabase/client"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"

export type ChatRoom = Database["public"]["Tables"]["chat_rooms"]["Row"]
export type ChatProfile = {
  username: string
  display_name: string
  avatar_url: string | null
}
export type ChatMessage = Database["public"]["Tables"]["chat_messages"]["Row"] & {
  profiles: ChatProfile | null
}

// chat_messages.user_id references auth.users(id) — there is NO foreign key to
// profiles, so PostgREST cannot embed profiles here. We fetch author profiles
// in a second query and join them in code (see attachProfiles).
const MESSAGE_COLUMNS = "id, room_id, user_id, content, created_at"
const PAGE_SIZE = 100
type ChatMessageRow = Database["public"]["Tables"]["chat_messages"]["Row"]

/** Attach author profiles to a batch of messages with one extra query. */
async function attachProfiles<T extends { user_id: string }>(
  rows: T[],
  supabase: SupabaseClient<Database>
): Promise<(T & { profiles: ChatProfile | null })[]> {
  const ids = [...new Set(rows.map((r) => r.user_id))]
  if (ids.length === 0) return rows as (T & { profiles: ChatProfile | null })[]
  const { data: profs } = await supabase
    .from("public_profiles")
    .select("user_id, username, display_name, avatar_url")
    .in("user_id", ids)
  const byId = new Map((profs ?? []).map((p) => [p.user_id, p]))
  return rows.map((r) => ({ ...r, profiles: byId.get(r.user_id) ?? null }))
}

/** Most recent page of messages, newest first (caller flips for rendering). */
export async function fetchChatMessages(roomId: string): Promise<ChatMessage[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from("chat_messages")
    .select(MESSAGE_COLUMNS)
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE)

  if (error) throw error
  return attachProfiles((data ?? []) as ChatMessageRow[], supabase)
}

/** Next page of messages older than `beforeIso`, newest first. */
export async function fetchOlderChatMessages(
  roomId: string,
  beforeIso: string
): Promise<ChatMessage[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from("chat_messages")
    .select(MESSAGE_COLUMNS)
    .eq("room_id", roomId)
    .lt("created_at", beforeIso)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE)

  if (error) throw error
  return attachProfiles((data ?? []) as ChatMessageRow[], supabase)
}

/** Single message by id (used by the realtime INSERT handler). */
export async function fetchChatMessageById(id: string): Promise<ChatMessage | null> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from("chat_messages")
    .select(MESSAGE_COLUMNS)
    .eq("id", id)
    .single()

  if (error) return null
  const [withProfile] = await attachProfiles([data] as ChatMessageRow[], supabase)
  return withProfile
}

export async function sendChatMessage(
  roomId: string,
  userId: string,
  content: string,
  senderProfile: ChatProfile | null
): Promise<ChatMessage> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({ room_id: roomId, user_id: userId, content })
    .select(MESSAGE_COLUMNS)
    .single()

  if (error) throw error
  return { ...(data as ChatMessage), profiles: senderProfile }
}

export const CHAT_PAGE_SIZE = PAGE_SIZE
