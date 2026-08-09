"use client"

import { useState, useEffect, useRef, Suspense, useCallback } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { ContentGrid, type StatusFilter } from "@/components/tracker/ContentGrid"
import { ProgressIndicator } from "@/components/tracker/ProgressIndicator"
import { MotivationStats } from "@/components/tracker/MotivationStats"
import { Button } from "@/components/ui/button"
import { createClient } from "@/utils/supabase/client"
import { fetchContentEntries } from "@/lib/queries/client/content"
import {
  fetchUserWatchStatuses,
  nextWatchState,
  toggleWatchStatus,
  toggleFavorite,
  setRating,
  markAll,
  type UserWatchStatuses,
} from "@/lib/queries/client/watch-status"
import { queryKeys } from "@/lib/queries/keys"
import {
  WATCH_STATUSES,
  VIEW_MODES,
  CONTENT_TYPES,
  type WatchStatus,
  type ViewMode,
  type ContentType,
} from "@/lib/constants"

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
  const [user, setUser] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queryClient = useQueryClient()

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

  // ── Auth (non-react-query: auth state is not cacheable data) ──
  useEffect(() => {
    let active = true
    supabase.auth.getUser().then(({ data }) => {
      if (active) setUser(data.user?.id ?? null)
    })
    return () => {
      active = false
    }
  }, [supabase])

  // ── Queries ──
  const contentQuery = useQuery({
    queryKey: queryKeys.content.all(),
    queryFn: fetchContentEntries,
  })
  const entries = contentQuery.data?.entries ?? []
  const arcMap = contentQuery.data?.arcMap ?? null

  const watchStatusQuery = useQuery({
    queryKey: queryKeys.watchStatus.all(user ?? ""),
    queryFn: () => fetchUserWatchStatuses(user as string),
    enabled: !!user,
  })
  const userStatuses = watchStatusQuery.data?.statuses ?? new Map<string, WatchStatus>()
  const watchCounts = watchStatusQuery.data?.counts ?? new Map<string, number>()
  const favorites = watchStatusQuery.data?.favorites ?? new Map<string, boolean>()
  const ratings = watchStatusQuery.data?.ratings ?? new Map<string, number>()

  const statusKey = () => queryKeys.watchStatus.all(user as string)

  // ── Mutations (optimistic with rollback) ──
  const toggleStatusMutation = useMutation({
    mutationFn: ({
      contentId,
      currentStatus,
      existingCount,
    }: {
      contentId: string
      currentStatus: WatchStatus | null
      existingCount: number
    }) => toggleWatchStatus(user as string, contentId, currentStatus, existingCount),
    onMutate: async ({ contentId, currentStatus, existingCount }) => {
      await queryClient.cancelQueries({ queryKey: statusKey() })
      const prev = queryClient.getQueryData<UserWatchStatuses>(statusKey())
      if (prev) {
        const { nextStatus, nextCount } = nextWatchState(currentStatus, existingCount)
        queryClient.setQueryData<UserWatchStatuses>(statusKey(), {
          statuses: new Map(prev.statuses).set(contentId, nextStatus),
          counts: new Map(prev.counts).set(contentId, nextCount),
          favorites: prev.favorites,
          ratings: prev.ratings,
        })
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(statusKey(), ctx.prev)
      setMutationError("Couldn't update your progress. Please try again.")
    },
    onSuccess: () => setMutationError(null),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: statusKey() })
    },
  })

  const toggleFavoriteMutation = useMutation({
    mutationFn: ({ contentId, current }: { contentId: string; current: boolean }) =>
      toggleFavorite(user as string, contentId, current),
    onMutate: async ({ contentId, current }) => {
      await queryClient.cancelQueries({ queryKey: statusKey() })
      const prev = queryClient.getQueryData<UserWatchStatuses>(statusKey())
      if (prev) {
        queryClient.setQueryData<UserWatchStatuses>(statusKey(), {
          ...prev,
          favorites: new Map(prev.favorites).set(contentId, !current),
        })
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(statusKey(), ctx.prev)
      setMutationError("Couldn't update your favorites. Please try again.")
    },
    onSuccess: () => setMutationError(null),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: statusKey() })
    },
  })

  const setRatingMutation = useMutation({
    mutationFn: ({ contentId, starValue }: { contentId: string; starValue: number }) =>
      setRating(user as string, contentId, starValue),
    onMutate: async ({ contentId, starValue }) => {
      await queryClient.cancelQueries({ queryKey: statusKey() })
      const prev = queryClient.getQueryData<UserWatchStatuses>(statusKey())
      if (prev) {
        const dbRating = starValue === 0 ? null : starValue * 2
        const ratings = new Map(prev.ratings)
        if (dbRating === null) ratings.delete(contentId)
        else ratings.set(contentId, dbRating)
        queryClient.setQueryData<UserWatchStatuses>(statusKey(), {
          ...prev,
          ratings,
        })
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(statusKey(), ctx.prev)
      setMutationError("Couldn't save your rating. Please try again.")
    },
    onSuccess: () => setMutationError(null),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: statusKey() })
    },
  })

  const markAllMutation = useMutation({
    mutationFn: ({
      ids,
      status,
      countByContent,
    }: {
      ids: string[]
      status: WatchStatus
      countByContent: Map<string, number>
    }) => markAll(user as string, ids, status, countByContent),
    onMutate: async ({ ids, status }) => {
      await queryClient.cancelQueries({ queryKey: statusKey() })
      const prev = queryClient.getQueryData<UserWatchStatuses>(statusKey())
      if (prev) {
        const statuses = new Map(prev.statuses)
        const counts = new Map(prev.counts)
        ids.forEach((id) => {
          statuses.set(id, status)
          counts.set(id, Math.max(counts.get(id) ?? 0, 1))
        })
        queryClient.setQueryData<UserWatchStatuses>(statusKey(), {
          ...prev,
          statuses,
          counts,
        })
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(statusKey(), ctx.prev)
      setMutationError("Couldn't update the section. Please try again.")
    },
    onSuccess: () => setMutationError(null),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: statusKey() })
    },
  })

  function requireUser(): boolean {
    if (user) return true
    window.location.href = "/login"
    return false
  }

  function handleToggleStatus(contentId: string, currentStatus: WatchStatus | null) {
    if (!requireUser()) return
    toggleStatusMutation.mutate({
      contentId,
      currentStatus,
      existingCount: watchCounts.get(contentId) ?? 0,
    })
  }

  function handleToggleFavorite(contentId: string, current: boolean) {
    if (!requireUser()) return
    toggleFavoriteMutation.mutate({ contentId, current })
  }

  function handleSetRating(contentId: string, starValue: number) {
    if (!requireUser()) return
    setRatingMutation.mutate({ contentId, starValue })
  }

  function handleMarkAll(ids: string[], status: WatchStatus) {
    if (!requireUser()) return
    markAllMutation.mutate({ ids, status, countByContent: watchCounts })
  }

  const loading = contentQuery.isLoading
  const error = contentQuery.isError ? "We couldn't load the case files. Please try again." : mutationError

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
            <Button onClick={() => contentQuery.refetch()} className="rounded-lg">
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
