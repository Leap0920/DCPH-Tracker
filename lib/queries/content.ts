import { createClient } from "@/utils/supabase/server"
import type { Database } from "@/types/database.types"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]
type ContentInsert = Database["public"]["Tables"]["content_entries"]["Insert"]
type ContentUpdate = Database["public"]["Tables"]["content_entries"]["Update"]

export interface ContentFilters {
  type?: string
  status?: string
  sort?: "air_date" | "canon_order"
  arc_id?: string
  search?: string
  limit?: number
  offset?: number
}

export async function getContentEntries(filters: ContentFilters = {}) {
  const supabase = await createClient()

  let query = supabase
    .from("content_entries")
    .select("*", { count: "exact" })

  if (filters.type && filters.type !== "all") {
    query = query.eq("type", filters.type as ContentEntry["type"])
  }

  if (filters.arc_id) {
    query = query.eq("arc_id", filters.arc_id)
  }

  if (filters.search) {
    query = query.ilike("title", `%${filters.search}%`)
  }

  const sortField = filters.sort === "canon_order" ? "canon_order" : "air_date"
  query = query.order(sortField, { ascending: true })

  if (filters.limit) {
    query = query.range(
      filters.offset ?? 0,
      (filters.offset ?? 0) + filters.limit - 1
    )
  }

  const { data, error, count } = await query

  if (error) throw error

  return { entries: data ?? [], total: count ?? 0 }
}

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

export async function getContentByArc(arcId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("content_entries")
    .select("*")
    .eq("arc_id", arcId)
    .order("canon_order", { ascending: true })

  if (error) throw error

  return data ?? []
}
