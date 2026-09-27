import { createClient } from "@/utils/supabase/server"
import type { Database } from "@/types/database.types"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

export async function getContentEntryBySlug(slug: string) {
  const supabase = await createClient()

  // maybeSingle, not single: a missing slug is a 404 the page handles, but
  // single() raises PGRST116 and turns every bad URL into a 500.
  const { data, error } = await supabase
    .from("content_entries")
    .select("*, arcs(*)")
    .eq("slug", slug)
    .maybeSingle()

  if (error) throw error

  return data
}
