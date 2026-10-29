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
 * Live hero stats: all-time visits, episodes tracked, detectives online.
 * On first mount it registers this browser's visit and seeds the counters,
 * then a 60s heartbeat (visible tabs only) keeps the session alive.
 *
 * Set as one inline mono row separated by hairlines instead of a stack of
 * bordered pills: three boxes above the fold read as badges, three numbers
 * on a line read as a dashboard.
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
    // One anonymous id per browser tab, reused across visits so a reload
    // heartbeats instead of double-counting.
    const sessionId = sessionStorage.getItem("dcph-session") ?? randomId()
    sessionStorage.setItem("dcph-session", sessionId)

    let cancelled = false

    const refresh = async () => {
      // Skip hidden tabs: every tick is one PostgREST request plus a row
      // write, and these are a large slice of the project's request volume
      // (all of it logged against the Supabase quota). heartbeat()'s window
      // is 2 minutes, so a backgrounded tab drops off "online now" shortly
      // after the user stops looking, which is the honest reading anyway.
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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint sm:text-[11px]">
      <span>
        <span className="text-ink">{stats.totalVisits.toLocaleString()}</span> visits
      </span>

      {stats.trackedEpisodes != null && (
        <>
          <span aria-hidden className="hidden h-3 w-px bg-line sm:block" />
          <span className="hidden sm:inline">
            <span className="text-ink">{stats.trackedEpisodes.toLocaleString()}</span> episodes tracked
          </span>
        </>
      )}

      {stats.activeNow != null && (
        <>
          <span aria-hidden className="h-3 w-px bg-line" />
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full bg-emerald-500 ${reduce ? "" : "animate-pulse"}`}
            />
            <span className="text-ink">{stats.activeNow}</span> online
          </span>
        </>
      )}
    </div>
  )
}
