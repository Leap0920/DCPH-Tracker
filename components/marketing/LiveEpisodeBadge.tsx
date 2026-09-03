import { EPISODE_FLOOR, getLatestEpisodeNumber } from "@/lib/homepage-content"

/**
 * Highest approved episode number in content_entries.
 *
 * Runs on the server against the anon-readable content_entries table, so it
 * works for logged-out visitors and never ships a query or key to the browser.
 * Timeout-wrapped in lib/homepage-content so a slow DB falls back to
 * EPISODE_FLOOR instead of hanging the homepage.
 */

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

export async function LiveEpisodeBadge({ episode }: { episode?: number }) {
  const resolved = episode ?? (await getLatestEpisodeNumber())

  // Keep the safety floor even when the caller passes stale data.
  const display = Math.max(EPISODE_FLOOR, resolved)

  return (
    <span
      aria-label={`Currently airing: episode ${display}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-surface/90 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-accent shadow-card backdrop-blur-sm sm:text-[11px]"
    >
      {/* Pulsing presence dot — matches the LiveStats "active right now" pill. */}
      <span aria-hidden className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70 motion-reduce:animate-none" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      Live ep {display} now
    </span>
  )
}