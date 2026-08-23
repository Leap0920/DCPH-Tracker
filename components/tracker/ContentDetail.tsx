"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  EyeOff,
  Film,
  Heart,
  RefreshCw,
  Star,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { CONTENT_TYPE_LABELS, type ContentType, type WatchStatus } from "@/lib/constants"
import { typeBadgeVariant } from "@/lib/badges"
import { cn, formatDate, padNumber } from "@/lib/utils"
import { createClient } from "@/utils/supabase/client"
import { openAuthModal } from "@/lib/auth-modal"
import { queryKeys } from "@/lib/queries/keys"
import {
  fetchUserWatchStatuses,
  incrementRewatch,
  nextWatchState,
  setRating,
  setWatchStatus,
  toggleFavorite,
  type UserWatchStatuses,
} from "@/lib/queries/client/watch-status"
import {
  fetchAdjacentEntries,
  fetchContentRating,
} from "@/lib/queries/client/episode"
import { CommentSection } from "@/components/tracker/CommentSection"
import { EpisodeWikiDetails } from "@/components/tracker/EpisodeWikiDetails"
import type { Database } from "@/types/database.types"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"] & {
  arcs: Database["public"]["Tables"]["arcs"]["Row"] | null
}

/** Read-only half-star row (full / half / empty) for the community average. */
function StarRow({ halfStars }: { halfStars: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => {
        const isFull = halfStars >= i
        const isHalf = !isFull && halfStars >= i - 0.5
        return (
          <span key={i} className="relative inline-block h-4 w-4">
            <Star className="absolute inset-0 h-4 w-4 text-ink-faint" />
            {isHalf && (
              <span className="absolute inset-0 overflow-hidden" style={{ width: "50%" }}>
                <Star className="h-4 w-4 fill-current text-accent" />
              </span>
            )}
            {isFull && <Star className="absolute inset-0 h-4 w-4 fill-current text-accent" />}
          </span>
        )
      })}
    </div>
  )
}

export function ContentDetail({ entry, inModal }: { entry: ContentEntry; inModal?: boolean }) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [userId, setUserId] = useState<string | null>(null)
  const [hoverStar, setHoverStar] = useState(0)
  const [mutationError, setMutationError] = useState<string | null>(null)

  // ── Auth (ChatWindow.tsx:86-105 pattern) ──
  useEffect(() => {
    let active = true
    supabase.auth.getUser().then(({ data }) => {
      if (data.user && active) setUserId(data.user.id)
    })
    return () => {
      active = false
    }
  }, [supabase])

  const displayNumber = entry.type === "movie"
    ? `MOV ${padNumber(entry.movie_number ?? 0)}`
    : entry.type === "episode"
      ? `EP ${padNumber(entry.episode_number ?? 0)}`
      : entry.type.toUpperCase()

  // ── Watch status (read the signed-in user's maps for THIS entry) ──
  const watchStatusKey = userId ? queryKeys.watchStatus.all(userId) : null
  const watchStatusQuery = useQuery({
    queryKey: watchStatusKey ?? queryKeys.watchStatus.all(""),
    queryFn: () => fetchUserWatchStatuses(userId as string),
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
  })
  const status = watchStatusQuery.data?.statuses.get(entry.id) ?? null
  const watchCount = watchStatusQuery.data?.counts.get(entry.id) ?? 0
  const favorite = watchStatusQuery.data?.favorites.get(entry.id) ?? false
  const dbRating = watchStatusQuery.data?.ratings.get(entry.id) ?? 0
  const starValue = Math.round(dbRating / 2)
  const isSeen = status === "watched" || status === "rewatched"

  // ── Watch/Unwatch toggle — cycles via nextWatchState (watched → rewatched → unwatched) ──
  const toggle = nextWatchState(status, watchCount)
  const toggleLabel =
    toggle.nextStatus === "watched"
      ? "Mark as Watched"
      : toggle.nextStatus === "rewatched"
        ? "Mark as Rewatched"
        : "Mark as Unwatched"
  const ToggleIcon =
    toggle.nextStatus === "watched"
      ? Check
      : toggle.nextStatus === "rewatched"
        ? RefreshCw
        : EyeOff

  // ── Watch-status mutations (optimistic, tracker page.tsx pattern) ──
  const watchMutation = useMutation({
    mutationFn: ({
      nextStatus,
      nextCount,
    }: {
      nextStatus: WatchStatus
      nextCount: number
    }) => setWatchStatus(userId as string, entry.id, nextStatus, nextCount),
    onMutate: async ({ nextStatus, nextCount }) => {
      if (!watchStatusKey) return { prev: undefined }
      await queryClient.cancelQueries({ queryKey: watchStatusKey })
      const prev = queryClient.getQueryData<UserWatchStatuses>(watchStatusKey)
      if (prev) {
        queryClient.setQueryData<UserWatchStatuses>(watchStatusKey, {
          statuses: new Map(prev.statuses).set(entry.id, nextStatus),
          counts: new Map(prev.counts).set(entry.id, nextCount),
          favorites: prev.favorites,
          ratings: prev.ratings,
        })
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev && watchStatusKey) queryClient.setQueryData(watchStatusKey, ctx.prev)
      setMutationError("Couldn't update your progress. Please try again.")
    },
    onSettled: () => {
      if (watchStatusKey) queryClient.invalidateQueries({ queryKey: watchStatusKey })
    },
  })

  const rewatchMutation = useMutation({
    mutationFn: () => incrementRewatch(userId as string, entry.id, watchCount),
    onMutate: async () => {
      if (!watchStatusKey) return { prev: undefined }
      await queryClient.cancelQueries({ queryKey: watchStatusKey })
      const prev = queryClient.getQueryData<UserWatchStatuses>(watchStatusKey)
      if (prev) {
        queryClient.setQueryData<UserWatchStatuses>(watchStatusKey, {
          statuses: new Map(prev.statuses).set(entry.id, "rewatched"),
          counts: new Map(prev.counts).set(entry.id, watchCount + 1),
          favorites: prev.favorites,
          ratings: prev.ratings,
        })
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev && watchStatusKey) queryClient.setQueryData(watchStatusKey, ctx.prev)
      setMutationError("Couldn't update your rewatch count. Please try again.")
    },
    onSettled: () => {
      if (watchStatusKey) queryClient.invalidateQueries({ queryKey: watchStatusKey })
    },
  })

  const favoriteMutation = useMutation({
    mutationFn: () => toggleFavorite(userId as string, entry.id, favorite),
    onMutate: async () => {
      if (!watchStatusKey) return { prev: undefined }
      await queryClient.cancelQueries({ queryKey: watchStatusKey })
      const prev = queryClient.getQueryData<UserWatchStatuses>(watchStatusKey)
      if (prev) {
        queryClient.setQueryData<UserWatchStatuses>(watchStatusKey, {
          ...prev,
          favorites: new Map(prev.favorites).set(entry.id, !favorite),
        })
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev && watchStatusKey) queryClient.setQueryData(watchStatusKey, ctx.prev)
      setMutationError("Couldn't update your favorites. Please try again.")
    },
    onSettled: () => {
      if (watchStatusKey) queryClient.invalidateQueries({ queryKey: watchStatusKey })
    },
  })

  const ratingMutation = useMutation({
    mutationFn: (star: number) => setRating(userId as string, entry.id, star),
    onMutate: async (star) => {
      if (!watchStatusKey) return { prev: undefined }
      await queryClient.cancelQueries({ queryKey: watchStatusKey })
      const prev = queryClient.getQueryData<UserWatchStatuses>(watchStatusKey)
      if (prev) {
        const db = star === 0 ? null : star * 2
        const ratings = new Map(prev.ratings)
        if (db === null) ratings.delete(entry.id)
        else ratings.set(entry.id, db)
        queryClient.setQueryData<UserWatchStatuses>(watchStatusKey, {
          ...prev,
          ratings,
        })
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev && watchStatusKey) queryClient.setQueryData(watchStatusKey, ctx.prev)
      setMutationError("Couldn't save your rating. Please try again.")
    },
    onSettled: () => {
      if (watchStatusKey) queryClient.invalidateQueries({ queryKey: watchStatusKey })
      // The user's own rating feeds the aggregate — refresh it.
      queryClient.invalidateQueries({ queryKey: queryKeys.content.rating(entry.id) })
    },
  })

  // ── Community rating (degrades to null when the RPC isn't migrated) ──
  const ratingQuery = useQuery({
    queryKey: queryKeys.content.rating(entry.id),
    queryFn: () => fetchContentRating(entry.id),
    staleTime: 1000 * 60 * 10,
  })
  const rating = ratingQuery.data
  const hasRating = rating !== null && rating !== undefined && rating.rating_count > 0 && rating.avg_rating != null
  const avg5 = hasRating ? rating.avg_rating / 2 : 0
  const halfStars = hasRating ? Math.round(avg5 * 2) / 2 : 0
  const avgDisplay = hasRating ? avg5.toFixed(1) : "0.0"

  // ── Prev/Next navigation within the same type ──
  const adjacentQuery = useQuery({
    queryKey: ["content", "adjacent", entry.type, entry.canon_order],
    queryFn: () => fetchAdjacentEntries(entry.type, entry.canon_order),
    staleTime: 1000 * 60 * 30,
  })
  const prev = adjacentQuery.data?.prev ?? null
  const next = adjacentQuery.data?.next ?? null

  // ── Case suspects & culprits (from DCW InfoBox Crime) ──
  const caseQuery = useQuery({
    queryKey: ["dcw-case", entry.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("dcw_cases")
        .select("suspects, culprits, culprit_count")
        .eq("entry_id", entry.id)
        .limit(1)
        .maybeSingle()
      return (data as { suspects: string | null; culprits: string[] | null; culprit_count: number | null } | null) ?? null
    },
    staleTime: 1000 * 60 * 30,
  })

  function handleWatchToggle() {
    if (!userId || watchStatusQuery.isLoading) return
    watchMutation.mutate({ nextStatus: toggle.nextStatus, nextCount: toggle.nextCount })
  }

  function handleSetRating(star: number) {
    if (!userId || ratingMutation.isPending) return
    ratingMutation.mutate(starValue === star ? 0 : star)
  }

  return (
    <div>
      {!inModal && (
        <Link
          href="/tracker"
          className="mb-6 inline-flex items-center gap-2 py-2.5 text-sm text-ink-dim hover:text-ink transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Case Files
        </Link>
      )}

      {/* Hero block */}
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <div className="relative aspect-video bg-surface-muted">
          {entry.image_url ? (
            <img
              src={entry.image_url}
              alt={entry.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <span className="font-display text-6xl text-ink-dim/15 uppercase">
                {displayNumber}
              </span>
            </div>
          )}
          <span className="absolute top-3 right-3 z-10 rounded-md bg-ink/90 px-2 py-0.5 font-mono text-[10px] text-page">
            {displayNumber}
          </span>
        </div>

        <div className="p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={typeBadgeVariant[entry.type] ?? "outline"}>
              {CONTENT_TYPE_LABELS[entry.type as ContentType]}
            </Badge>
            <span className="font-mono text-xs text-ink-dim">
              CANON #{padNumber(entry.canon_order, 3)}
            </span>
          </div>

          <h1 className="mt-3 mb-4 font-display text-2xl tracking-tight text-ink sm:text-4xl">
            {entry.title}
          </h1>

          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-dim">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-ink" />
              <span>{formatDate(entry.air_date)}</span>
            </div>
            {entry.runtime_minutes != null && (
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-ink" />
                <span>{entry.runtime_minutes} min</span>
              </div>
            )}
            {entry.arcs && (
              <div className="flex items-center gap-2">
                <Film className="h-4 w-4 text-ink" />
                <Link
                  href={`/arcs/${entry.arcs.slug}`}
                  className="transition-colors hover:text-ink"
                >
                  {entry.arcs.title}
                </Link>
              </div>
            )}
          </div>

          {/* Action row — signed-in only; guest sees a Sign In CTA */}
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-6">
            {userId ? (
              <>
                <Button
                  onClick={handleWatchToggle}
                  disabled={watchStatusQuery.isLoading || watchMutation.isPending}
                  className={cn(
                    isSeen &&
                      "border-success/50 bg-success/10 text-success hover:border-success hover:bg-success/10"
                  )}
                >
                  <ToggleIcon className="h-4 w-4" />
                  {toggleLabel}
                </Button>

                {isSeen && (
                  <Button
                    variant="outline"
                    onClick={() => rewatchMutation.mutate()}
                    disabled={rewatchMutation.isPending}
                    title="Count another rewatch"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Rewatch{watchCount > 1 ? ` ×${watchCount}` : ""}
                  </Button>
                )}

                <Button
                  variant="outline"
                  onClick={() => favoriteMutation.mutate()}
                  disabled={favoriteMutation.isPending}
                  aria-pressed={favorite}
                  className={cn(
                    favorite &&
                      "border-accent/50 bg-accent-soft text-accent-bright hover:border-accent hover:bg-accent-soft"
                  )}
                >
                  <Heart className={cn("h-4 w-4", favorite && "fill-current")} />
                  {favorite ? "Favorited" : "Favorite"}
                </Button>

                {/* Own 5-star rating (starValue 1-5 ↔ dbRating starValue*2; 0 clears) */}
                <div className="flex items-center gap-1.5">
                  <div
                    className="flex items-center gap-0.5"
                    onMouseLeave={() => setHoverStar(0)}
                    aria-label={`Rated ${starValue} of 5 stars`}
                  >
                    {[1, 2, 3, 4, 5].map((star) => {
                      const active = (hoverStar > 0 ? hoverStar : starValue) >= star
                      return (
                        <button
                          key={star}
                          type="button"
                          onClick={() => handleSetRating(star)}
                          onMouseEnter={() => setHoverStar(star)}
                          className="-mx-1 -my-2 p-2.5 transition-transform hover:scale-110"
                          title={`${active ? "Clear" : "Rate"} ${star} star${star > 1 ? "s" : ""}`}
                          aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
                        >
                          <Star
                            className={cn(
                              "h-5 w-5 transition-colors",
                              active ? "fill-current text-accent" : "text-ink-faint"
                            )}
                          />
                        </button>
                      )
                    })}
                  </div>
                  {starValue > 0 && (
                    <span className="font-mono text-xs text-ink-faint tabular-nums">
                      {starValue}/5
                    </span>
                  )}
                </div>
              </>
            ) : (
              <Button variant="outline" onClick={() => openAuthModal("signin")}>
                Sign In
              </Button>
            )}
          </div>

          {mutationError && (
            <p className="mt-3 text-xs text-danger">{mutationError}</p>
          )}

          {/* Synopsis */}
          {entry.synopsis && (
            <section className="mt-6 border-t border-line pt-6">
              <h2 className="mb-3 font-display text-sm text-ink-dim">Synopsis</h2>
              <p className="font-body leading-relaxed text-ink-dim">{entry.synopsis}</p>
            </section>
          )}

          <EpisodeWikiDetails
            dcwTitle={(entry as { dcw_title?: string | null }).dcw_title ?? null}
            title={entry.title}
            episodeNumber={entry.episode_number ?? null}
            contentType={entry.type ?? null}
            suspects={caseQuery.data?.suspects ?? null}
            culprits={caseQuery.data?.culprits ?? null}
            className="mt-6"
          />

          {/* Community rating */}
          <section className="mt-6 border-t border-line pt-6">
            <h2 className="mb-3 font-display text-sm text-ink-dim">Community Rating</h2>
            {ratingQuery.isLoading ? (
              <div className="flex items-center gap-3">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-4 w-16" />
              </div>
            ) : hasRating ? (
              <div className="flex flex-wrap items-center gap-3">
                <StarRow halfStars={halfStars} />
                <span className="font-mono text-sm text-ink tabular-nums">
                  {avgDisplay} / 5
                </span>
                <span className="text-sm text-ink-dim">
                  {rating.rating_count} rating{rating.rating_count > 1 ? "s" : ""}
                </span>
              </div>
            ) : (
              <p className="text-sm text-ink-faint">No ratings yet</p>
            )}
          </section>

          {/* T4 mount point — episode comments (CommentSection) in its own bordered section */}
          <CommentSection contentId={entry.id} />
        </div>
      </div>

      {/* Prev / Next navigation */}
      {!inModal && (
        <div className="mt-8 flex items-center justify-between gap-4 border-t border-line pt-4">
          {prev ? (
            <Link
              href={`/tracker/${prev.slug}`}
              className="group inline-flex max-w-[45%] items-center gap-2 text-sm text-ink-dim transition-colors hover:text-ink"
            >
              <ChevronLeft className="h-4 w-4 shrink-0 transition-transform group-hover:-translate-x-0.5" />
              <span className="min-w-0">
                <span className="block font-mono text-[10px] tracking-wide text-ink-faint uppercase">
                  Previous Episode
                </span>
                <span className="block truncate font-display text-ink">{prev.title}</span>
              </span>
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}

          {next ? (
            <Link
              href={`/tracker/${next.slug}`}
              className="group inline-flex max-w-[45%] items-center justify-end gap-2 text-right text-sm text-ink-dim transition-colors hover:text-ink"
            >
              <span className="min-w-0">
                <span className="block font-mono text-[10px] tracking-wide text-ink-faint uppercase">
                  Next Episode
                </span>
                <span className="block truncate font-display text-ink">{next.title}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}
        </div>
      )}
    </div>
  )
}
