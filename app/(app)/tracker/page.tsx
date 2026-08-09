"use client"

import { useState, useEffect, useRef, Suspense, useCallback } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ContentGrid, type StatusFilter } from "@/components/tracker/ContentGrid"
import { ProgressIndicator } from "@/components/tracker/ProgressIndicator"
import { MotivationStats } from "@/components/tracker/MotivationStats"
import { Button } from "@/components/ui/button"
import { createClient } from "@/utils/supabase/client"
import type { Database } from "@/types/database.types"
import {
  WATCH_STATUSES,
  VIEW_MODES,
  CONTENT_TYPES,
  type WatchStatus,
  type ViewMode,
  type ContentType,
} from "@/lib/constants"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

const VALID_TYPES = new Set<string>([CONTENT_TYPES.EPISODE, CONTENT_TYPES.MOVIE, CONTENT_TYPES.SPECIAL, CONTENT_TYPES.OVA, CONTENT_TYPES.LIVE_ACTION, CONTENT_TYPES.MAGIC_KAITO, CONTENT_TYPES.HANZAWA, CONTENT_TYPES.ZERO_TEA_TIME])
const VALID_STATUS = new Set<string>([WATCH_STATUSES.UNWATCHED, WATCH_STATUSES.WATCHED, WATCH_STATUSES.REWATCHED])
const MAX_EPISODE = 1209

function clampInt(value: string | null, min: number, max: number): number | null {
  if (!value) return null
  const n = Number.parseInt(value, 10)
  if (!Number.isInteger(n) || n < min || n > max) return null
  return n
}

function TrackerPageContent() {
  const [entries, setEntries] = useState<ContentEntry[]>([])
  const [userStatuses, setUserStatuses] = useState<Map<string, WatchStatus>>(new Map())
  const [watchCounts, setWatchCounts] = useState<Map<string, number>>(new Map())
  const [favorites, setFavorites] = useState<Map<string, boolean>>(new Map())
  const [ratings, setRatings] = useState<Map<string, number>>(new Map())
  const [arcMap, setArcMap] = useState<Map<string, { slug: string; title: string }> | null>(null)
  const [user, setUser] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── URL param parsing (invalid values fall back to defaults) ──
  const qParam = searchParams.get("q")?.slice(0, 100) ?? ""
  const typeParam = searchParams.get("type") ?? "all"
  const modeParam = searchParams.get("mode") ?? VIEW_MODES.YEAR
  const statusParam = searchParams.get("status") ?? "all"
  const epParam = clampInt(searchParams.get("ep"), 1, MAX_EPISODE)
  const pageParam = clampInt(searchParams.get("page"), 1, 1000)

  const initialMode: ViewMode = modeParam === VIEW_MODES.CHRONOLOGICAL ? VIEW_MODES.CHRONOLOGICAL : VIEW_MODES.YEAR
  const initialStatus: StatusFilter = VALID_STATUS.has(statusParam) ? (statusParam as WatchStatus) : "all"
  const initialType: ContentType | "all" = VALID_TYPES.has(typeParam) ? (typeParam as ContentType) : "all"
  const initialPage = pageParam && initialType !== "all" ? pageParam - 1 : undefined

  const updateUrl = useCallback(
    (patch: Record<string, string | null>, debounceSearch = false) => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key)
        else next.set(key, value)
      }
      const qs = next.toString()
      const url = qs ? `?${qs}` : "/tracker"
      if (debounceSearch) {
        if (searchTimer.current) clearTimeout(searchTimer.current)
        searchTimer.current = setTimeout(() => router.replace(url, { scroll: false }), 300)
      } else {
        router.replace(url, { scroll: false })
      }
    },
    [router, searchParams]
  )

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [])

  async function loadData() {
    setLoading(true)
    setError(null)

    // PostgREST caps responses at 1,000 rows per request (server max-rows),
    // so fetch all entries in paginated chunks of 1,000.
    const PAGE_SIZE = 1000
    const allEntries: ContentEntry[] = []
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data: chunk, error: chunkError } = await supabase
        .from("content_entries")
        .select("*")
        .order("air_date", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)

      if (chunkError) {
        setError("We couldn't load the case files. Please try again.")
        setLoading(false)
        return
      }

      if (!chunk || chunk.length === 0) break
      allEntries.push(...chunk)
      if (chunk.length < PAGE_SIZE) break
    }

    setEntries(allEntries)

    const { data: { user } } = await supabase.auth.getUser()
    setUser(user?.id ?? null)
    if (user) {
      const { data: statusData } = await supabase
        .from("watch_status")
        .select("content_id, status, watch_count, favorite, rating")
        .eq("user_id", user.id)

      if (statusData) {
        const statusMap = new Map<string, WatchStatus>()
        const countMap = new Map<string, number>()
        const favMap = new Map<string, boolean>()
        const ratingMap = new Map<string, number>()
        statusData.forEach((s) => {
          statusMap.set(s.content_id, s.status as WatchStatus)
          countMap.set(s.content_id, s.watch_count ?? 0)
          favMap.set(s.content_id, s.favorite ?? false)
          ratingMap.set(s.content_id, s.rating ?? 0)
        })
        setUserStatuses(statusMap)
        setWatchCounts(countMap)
        setFavorites(favMap)
        setRatings(ratingMap)
      }
    }

    // Fetch arcs once (id, slug, title) for episode arc badges.
    const { data: arcsData } = await supabase.from("arcs").select("id, slug, title")
    if (arcsData) {
      const map = new Map<string, { slug: string; title: string }>()
      arcsData.forEach((a) => map.set(a.id, { slug: a.slug, title: a.title }))
      setArcMap(map)
    }

    setLoading(false)
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleToggleStatus(contentId: string, currentStatus: WatchStatus | null) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      window.location.href = "/login"
      return
    }

    const nextStatus =
      currentStatus === "rewatched"
        ? "unwatched"
        : currentStatus === "watched"
          ? "rewatched"
          : "watched"

    const existingCount = watchCounts.get(contentId) ?? 0
    const nextCount =
      nextStatus === "unwatched"
        ? existingCount
        : nextStatus === "rewatched"
          ? existingCount + 1
          : Math.max(existingCount, 1)

    const { error } = await supabase
      .from("watch_status")
      .upsert(
        {
          user_id: user.id,
          content_id: contentId,
          status: nextStatus,
          watch_count: nextCount,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,content_id" }
      )

    if (error) {
      setError("Couldn't update your progress. Please try again.")
      return
    }

    setUserStatuses((prev) => {
      const next = new Map(prev)
      next.set(contentId, nextStatus)
      return next
    })
    setWatchCounts((prev) => {
      const next = new Map(prev)
      next.set(contentId, nextCount)
      return next
    })
  }

  async function handleToggleFavorite(contentId: string, current: boolean) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      window.location.href = "/login"
      return
    }

    const nextFavorite = !current

    const { error } = await supabase
      .from("watch_status")
      .upsert(
        {
          user_id: user.id,
          content_id: contentId,
          favorite: nextFavorite,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,content_id" }
      )

    if (error) {
      setError("Couldn't update your favorites. Please try again.")
      return
    }

    setFavorites((prev) => {
      const next = new Map(prev)
      next.set(contentId, nextFavorite)
      return next
    })
  }

  async function handleSetRating(contentId: string, starValue: number) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      window.location.href = "/login"
      return
    }

    // Schema check constraint is rating 1-10; star UI is 1-5, so store star × 2.
    const dbRating = starValue === 0 ? null : starValue * 2

    const { error } = await supabase
      .from("watch_status")
      .upsert(
        {
          user_id: user.id,
          content_id: contentId,
          rating: dbRating,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,content_id" }
      )

    if (error) {
      setError("Couldn't save your rating. Please try again.")
      return
    }

    setRatings((prev) => {
      const next = new Map(prev)
      if (dbRating === null) next.delete(contentId)
      else next.set(contentId, dbRating)
      return next
    })
  }

  async function handleMarkAll(ids: string[], status: WatchStatus) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      window.location.href = "/login"
      return
    }

    const rows = ids.map((id) => ({
      user_id: user.id,
      content_id: id,
      status,
      watch_count: Math.max(watchCounts.get(id) ?? 0, 1),
      updated_at: new Date().toISOString(),
    }))

    const { error } = await supabase
      .from("watch_status")
      .upsert(rows, { onConflict: "user_id,content_id" })

    if (error) {
      setError("Couldn't update the section. Please try again.")
      return
    }

    setUserStatuses((prev) => {
      const next = new Map(prev)
      ids.forEach((id) => next.set(id, status))
      return next
    })
    setWatchCounts((prev) => {
      const next = new Map(prev)
      ids.forEach((id) => next.set(id, Math.max(next.get(id) ?? 0, 1)))
      return next
    })
  }

  return (
    <div className="px-0 sm:px-6 py-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
        {loading ? (
          <div className="text-center py-24">
            <div className="inline-flex items-center gap-3">
              <div className="h-2 w-2 bg-gray-900 rounded-full animate-pulse" />
              <p className="font-display text-lg text-ink-faint animate-pulse tracking-tight">
                Loading case files...
              </p>
              <div className="h-2 w-2 bg-gray-900 rounded-full animate-pulse" style={{ animationDelay: "0.3s" }} />
            </div>
          </div>
        ) : error && entries.length === 0 ? (
          <div className="text-center py-24 px-6">
            <p className="font-display text-lg tracking-tight text-ink mb-2">
              Investigation stalled
            </p>
            <p className="text-sm text-ink-dim mb-6">{error}</p>
            <Button onClick={loadData} className="rounded-lg">
              Try Again
            </Button>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-24 px-6">
            <p className="font-display text-lg tracking-tight text-ink mb-2">
              No case files yet
            </p>
            <p className="text-sm text-ink-dim">
              Content hasn&apos;t been added to the tracker yet. Check back soon.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}
            <MotivationStats entries={entries} userStatuses={userStatuses} userName={user} />
            <ProgressIndicator entries={entries} userStatuses={userStatuses} />
            {!user && (
              <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-surface p-5">
                <div className="flex-1">
                  <p className="font-display text-base tracking-tight text-ink">
                    Sign in to track your progress
                  </p>
                  <p className="text-sm text-ink-dim">
                    Log in to mark episodes watched and climb the rankings.
                  </p>
                </div>
                <Link href="/login">
                  <Button size="sm" className="rounded-lg">
                    Sign In
                  </Button>
                </Link>
              </div>
            )}
            <div className="bg-surface border border-slate-200 rounded-lg overflow-hidden shadow-card">
              <ContentGrid
                entries={entries}
                userStatuses={userStatuses}
                watchCounts={watchCounts}
                favorites={favorites}
                ratings={ratings}
                onToggleStatus={user ? handleToggleStatus : undefined}
                onToggleFavorite={user ? handleToggleFavorite : undefined}
                onSetRating={user ? handleSetRating : undefined}
                onMarkAll={user ? handleMarkAll : undefined}
                initialMode={initialMode}
                initialStatusFilter={initialStatus}
                initialSearch={qParam}
                initialType={initialType}
                initialPage={initialPage}
                onModeChange={(m) => updateUrl({ mode: m, page: null })}
                onStatusFilterChange={(s) => updateUrl({ status: s, page: null })}
                onSearchChange={(q) => updateUrl({ q: q.trim() || null }, true)}
                onTypeChange={(t) => updateUrl({ type: t === "all" ? null : t, page: null })}
                onPageChange={(_key, page) =>
                  updateUrl({ page: initialType !== "all" && page > 0 ? String(page + 1) : null })
                }
                jumpTarget={epParam}
                onJumped={() => updateUrl({ ep: null })}
                arcMap={arcMap}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function TrackerPage() {
  return (
    <Suspense
      fallback={
        <div className="text-center py-24">
          <p className="font-display text-lg text-ink-dim animate-pulse tracking-widest">
            Loading case files...
          </p>
        </div>
      }
    >
      <TrackerPageContent />
    </Suspense>
  )
}
