"use client"

import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "framer-motion"
import { createClient } from "@/utils/supabase/client"
import {
  heartbeatAndGetStats,
  recordVisitAndGetStats,
  type SiteStats,
} from "@/lib/queries/client/stats"

const POLL_INTERVAL_MS = 60_000

/**
 * Live hero stats: "N all-time visits" + "M detectives active right now" + "K episodes tracked".
 * On first mount it registers this browser's visit and seeds both counters,
 * then a 60s heartbeat keeps the session alive and refreshes them.
 *
 * Client-only: stats start null and nothing renders until the hydration
 * fetch resolves, so this never appears in SSR output. Pre-migration
 * (PGRST202) the query layer returns nulls and the row stays hidden.
 */
export function LiveStats() {
  const [stats, setStats] = useState<SiteStats>({ totalVisits: null, activeNow: null, trackedEpisodes: null })
  const mountedRef = useRef(false)
  const reduce = useReducedMotion()

  useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true

    const supabase = createClient()
    // One anonymous id per browser tab — reused across visits so a reload
    // heartbeats instead of double-counting.
    const sessionId = sessionStorage.getItem("dcph-session") ?? crypto.randomUUID()
    sessionStorage.setItem("dcph-session", sessionId)

    let cancelled = false

    const refresh = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const next = await heartbeatAndGetStats(sessionId, user?.id ?? null)
      if (!cancelled) setStats(next)
    }

    // First visit: record_visit() bumps the all-time total, then we read
    // both counters.
    recordVisitAndGetStats().then((s) => {
      if (!cancelled) setStats(s)
    })

    // Keep the session alive and refresh the counters every 60s.
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (stats.totalVisits == null) return null

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="font-mono text-[11px] sm:text-xs uppercase tracking-widest text-ink-dim">
        {stats.totalVisits.toLocaleString()} all-time visits
      </span>
      {stats.activeNow != null && (
        <span className="font-mono text-[11px] sm:text-xs uppercase tracking-widest text-ink-dim">
          <span
            aria-hidden
            className={`h-2 w-2 rounded-full bg-emerald-500 inline-block mr-1.5 ${
              reduce ? "" : "animate-pulse"
            }`}
          />
          {stats.activeNow} detectives active right now
        </span>
      )}
      {stats.trackedEpisodes != null && (
        <span className="font-mono text-[11px] sm:text-xs uppercase tracking-widest text-ink-dim">
          {stats.trackedEpisodes.toLocaleString()} episodes tracked
        </span>
      )}
    </div>
  )
}
