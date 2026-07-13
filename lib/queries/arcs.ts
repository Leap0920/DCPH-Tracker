import { createClient } from "@/utils/supabase/server"
import type { Database } from "@/types/database.types"

type Arc = Database["public"]["Tables"]["arcs"]["Row"]

export async function getArcs() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("arcs")
    .select("*")
    .order("start_episode", { ascending: true })

  if (error) throw error

  return data ?? []
}

export async function getArcBySlug(slug: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("arcs")
    .select("*, content_entries(*)")
    .eq("slug", slug)
    .single()

  if (error) throw error

  return data
}
