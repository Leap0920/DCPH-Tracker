import { createClient } from "@/utils/supabase/server"

/**
 * Safety floor mirrored from app/(app)/tracker/page.tsx so the badge can never
 * regress below what the tracker reports (e.g. an empty/failed read).
 */
const EPISODE_FLOOR = 1209

/**
 * Highest approved episode number in content_entries.
 *
 * Runs on the server against the anon-readable content_entries table, so it
 * works for logged-out visitors and never ships a query or key to the browser.
 * Every request re-reads, so the moment an admin approves a sync_staging row
 * into content_entries the badge reflects it on the next page load.
 */
async function getLatestEpisodeNumber(): Promise<number> {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("content_entries")
      .select("episode_number")
      .eq("type", "episode")
      .not("episode_number", "is", null)
      .order("episode_number", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return EPISODE_FLOOR

    return Math.max(EPISODE_FLOOR, data?.episode_number ?? 0)
  } catch {
    // Never let a hero badge take down the homepage.
    return EPISODE_FLOOR
  }
}

/** Static twin of the live badge, used as the Suspense fallback in app/page.tsx. */
export function LiveEpisodeBadgeSkeleton() {
  return (
    <span
      aria-hidden
      className="inline-flex items-center gap-1.5 rounded-full border border-ink-dim/20 bg-surface/80 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-ink-dim shadow-card backdrop-blur-sm sm:text-[11px]"
    >
      <span className="h-2 w-2 rounded-full bg-ink-dim/40" />
      Live ep …
    </span>
  )
}

export async function LiveEpisodeBadge() {
  const episode = await getLatestEpisodeNumber()

  return (
    <span
      aria-label={`Currently airing: episode ${episode}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-surface/90 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-accent shadow-card backdrop-blur-sm sm:text-[11px]"
    >
      {/* Pulsing presence dot — matches the LiveStats "active right now" pill. */}
      <span aria-hidden className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70 motion-reduce:animate-none" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      Live ep {episode} now
    </span>
  )
}