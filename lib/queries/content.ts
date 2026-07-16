import { createClient } from "@/utils/supabase/server"
import type { Database } from "@/types/database.types"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

export async function getContentEntryBySlug(slug: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("content_entries")
    .select("*, arcs(*)")
    .eq("slug", slug)
    .single()

  if (error) throw error

  return data
}
