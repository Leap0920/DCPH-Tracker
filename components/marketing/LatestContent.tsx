import Link from "next/link"
import { createClient } from "@/utils/supabase/server"
import {
  CONTENT_TYPE_LABELS,
  CONTENT_TYPE_ICONS,
} from "@/lib/constants"
import type { ContentType } from "@/lib/constants"

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

  return (
    <section className="mx-auto max-w-5xl px-6">
      <h2 className="font-display text-2xl sm:text-3xl text-center text-ink">
        Latest content
      </h2>
      <p className="mt-2 text-center text-ink-dim max-w-xl mx-auto">
        Fresh off the air — jump back in where the case left off.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => {
          // DB type union is narrower than ContentType (no "yaiba") — upcast is
          // safe because lookups below fall back to a sensible default.
          const type = entry.type as ContentType
          const label = CONTENT_TYPE_LABELS[type] ?? "Content"
          const icon = CONTENT_TYPE_ICONS[type] ?? "📕"

          return (
            <Link
              key={entry.id}
              href={`/tracker?type=${entry.type}`}
              className="group rounded-lg border border-slate-200 bg-surface p-5 shadow-card transition-colors hover:border-slate-300 hover:bg-surface-muted"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-ink-faint">
                  {icon} {label}
                </span>
                <span className="font-mono text-xs text-ink-faint whitespace-nowrap">
                  {entry.air_date}
                </span>
              </div>
              <h3 className="mt-3 font-display text-base text-ink leading-snug line-clamp-2 transition-colors group-hover:text-accent">
                {entry.title}
              </h3>
              {entry.episode_number != null && (
                <p className="mt-2 text-sm text-ink-dim">
                  Ep. {entry.episode_number}
                </p>
              )}
            </Link>
          )
        })}
      </div>
    </section>
  )
}
