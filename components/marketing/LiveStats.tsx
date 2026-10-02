"use client"

import { useEffect, useRef, useState } from "react"
import { createClient } from "@/utils/supabase/client"
import {
  heartbeatAndGetStats,
  recordVisitAndGetStats,
  type SiteStats,
} from "@/lib/queries/client/stats"
import { randomId } from "@/lib/utils"

const POLL_INTERVAL_MS = 60_000

/**
 * Live hero stats: "N all-time visits" + "M detectives active right now" + "K episodes tracked".
 * On first mount it registers this browser's visit and seeds both counters,
 * then a 60s heartbeat (visible tabs only) keeps the session alive and
 * refreshes them.
 *
 * Client-only: stats start null and nothing renders until the hydration
 * fetch resolves, so this never appears in SSR output. Pre-migration
 * (PGRST202) the query layer returns nulls and the row stays hidden.
 */
export function LiveStats() {
  const [stats, setStats] = useState<SiteStats>({ totalVisits: null, activeNow: null, trackedEpisodes: null })
  const mountedRef = useRef(false)
  const [reduce, setReduce] = useState(false)

  useEffect(() => {
    setReduce(window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  }, [])

  useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true

    const supabase = createClient()
    // One anonymous id per browser tab — reused across visits so a reload
    // heartbeats instead of double-counting.
    const sessionId = sessionStorage.getItem("dcph-session") ?? randomId()
    sessionStorage.setItem("dcph-session", sessionId)

    let cancelled = false

    const refresh = async () => {
      // Skip hidden tabs: every tick is one PostgREST request plus a row
      // write, and these are a large slice of the project's request volume
      // (all of it logged against the Supabase quota). heartbeat()'s window
      // is 2 minutes, so a backgrounded tab drops off "online now" shortly
      // after the user stops looking — which is the honest reading anyway.
      if (document.visibilityState !== "visible") return
      // getSession() reads the stored session locally; getUser() would hit
      // the auth server once per minute per open tab.
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const next = await heartbeatAndGetStats(sessionId, session?.user?.id ?? null)
      if (!cancelled) setStats(next)
    }

    // First visit: record_visit() bumps the all-time total, then we read
    // both counters.
    recordVisitAndGetStats().then((s) => {
      if (!cancelled) setStats(s)
    })

    // Keep the session alive and refresh the counters every 60s (visible
    // tabs only), and catch up when the tab comes back to the foreground.
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  if (stats.totalVisits == null) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-lg border border-ink-dim/20 bg-surface px-3 py-1.5 font-mono text-[11px] shadow-card uppercase tracking-widest text-ink-dim sm:text-xs">
          {stats.totalVisits.toLocaleString()} visits
        </span>
        {stats.trackedEpisodes != null && (
          <span className="inline-flex items-center rounded-lg border border-ink-dim/20 bg-surface px-3 py-1.5 font-mono text-[11px] shadow-card uppercase tracking-widest text-ink-dim sm:text-xs">
            {stats.trackedEpisodes.toLocaleString()} episodes tracked
          </span>
        )}
      </div>
      {stats.activeNow != null && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-lg border border-ink-dim/20 bg-surface px-3 py-1.5 font-mono text-[11px] shadow-card uppercase tracking-widest text-ink-dim sm:text-xs">
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full bg-emerald-500 inline-block mr-1.5 ${reduce ? "" : "animate-pulse"
                }`}
            />
            {stats.activeNow} online now
          </span>
        </div>
      )}
    </div>
  )
}
