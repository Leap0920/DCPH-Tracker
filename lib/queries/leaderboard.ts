import { createClient } from "@/utils/supabase/server"
import type { Database } from "@/types/database.types"

type LeaderboardRow = Database["public"]["Views"]["leaderboard"]["Row"]

export async function getLeaderboard(limit = 50) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("leaderboard")
    .select("*")
    .limit(limit)

  if (error) throw error

  return (data ?? []) as LeaderboardRow[]
}

export async function refreshLeaderboard() {
  const supabase = await createClient()

  const { error } = await supabase.rpc("refresh_leaderboard" as never)

  if (error) throw error
}
