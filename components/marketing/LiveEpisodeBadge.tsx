import { EPISODE_FLOOR, getLatestEpisodeNumber } from "@/lib/homepage-content"

/**
 * Highest approved episode number in content_entries.
 *
 * Runs on the server against the anon-readable content_entries table, so it
 * works for logged-out visitors and never ships a query or key to the browser.
 * Timeout-wrapped in lib/homepage-content so a slow DB falls back to
 * EPISODE_FLOOR instead of hanging the homepage.
 *
 * Rendered as a plain mono line, not a bordered pill: the information is the
 * point, the chrome around it never was.
 */

/** Static twin of the live badge, used as the Suspense fallback in app/page.tsx. */
export function LiveEpisodeBadgeSkeleton() {
  return (
    <span
      aria-hidden
      className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-faint sm:text-[11px]"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-ink-faint/40" />
      Ep ...
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
      className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-dim sm:text-[11px]"
    >
      <span aria-hidden className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
      </span>
      <span className="text-ink-dim">
        Ep <span className="text-ink">{display}</span> / airing now
      </span>
    </span>
  )
}
