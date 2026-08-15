import Link from "next/link"
import { createClient } from "@/utils/supabase/server"
import {
  CONTENT_TYPE_LABELS,
  CONTENT_TYPE_ICONS,
} from "@/lib/constants"
import type { ContentType } from "@/lib/constants"
import { LatestContentGrid } from "./LatestContentGrid"

// Lean preview query — homepage only needs these six columns, not the full row.
async function getLatestContent() {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("content_entries")
      .select("id, title, type, episode_number, air_date, slug")
      .order("air_date", { ascending: false })
      .limit(6)

    if (error) return null
    return data
  } catch {
    // Homepage must never crash because the content feed is unavailable —
    // render nothing and let the rest of the page load.
    return null
  }
}

export async function LatestContent() {
  const entries = await getLatestContent()

  if (!entries || entries.length === 0) return null

  return <LatestContentGrid entries={entries} />
}