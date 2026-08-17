"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Check,
  X,
  CheckCheck,
  Trash2,
  Loader2,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Search,
  ArrowUpDown,
  Filter,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  approveStagedEntry,
  rejectStagedEntry,
  approveAllStagedEntries,
  rejectAllStagedEntries,
  clearStagingHistory,
} from "@/lib/actions/admin-sync"

type StagedRow = {
  id: string
  source: string
  slug: string
  title: string
  type: string
  episode_number: number | null
  movie_number: number | null
  air_date: string | null
  canon_order: number | null
  synopsis: string | null
  image_url: string | null
  runtime_minutes: number | null
  status: "pending" | "approved" | "rejected"
  created_at: string
}

type SortOption = "newest" | "oldest" | "a-z" | "z-a"

export function SyncApprovalQueue({ items }: { items: StagedRow[] }) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [bulkPending, startTransition] = useTransition()

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState<string>("")
  const [sortOrder, setSortOrder] = useState<SortOption>("newest")
  const [typeFilter, setTypeFilter] = useState<string>("all")

  // Pagination State
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [pageSize, setPageSize] = useState<number>(12)

  const pendingItems = items.filter((i) => i.status === "pending")
  const reviewedItems = items.filter((i) => i.status !== "pending")

  // Apply Search, Type Filter, and Sorting
  const filteredPendingItems = pendingItems
    .filter((item) => {
      if (typeFilter !== "all" && item.type !== typeFilter) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const titleMatch = item.title.toLowerCase().includes(q)
        const slugMatch = item.slug.toLowerCase().includes(q)
        const numMatch = String(item.episode_number ?? item.movie_number ?? "").includes(q)
        if (!titleMatch && !slugMatch && !numMatch) return false
      }
      return true
    })
    .sort((a, b) => {
      if (sortOrder === "a-z") return a.title.localeCompare(b.title)
      if (sortOrder === "z-a") return b.title.localeCompare(a.title)
      if (sortOrder === "oldest") {
        const dateA = a.air_date || a.created_at
        const dateB = b.air_date || b.created_at
        return dateA.localeCompare(dateB)
      }
      // newest
      const dateA = a.air_date || a.created_at
      const dateB = b.air_date || b.created_at
      return dateB.localeCompare(dateA)
    })

  const totalPages = Math.max(1, Math.ceil(filteredPendingItems.length / pageSize))
  const safePage = Math.min(currentPage, totalPages)

  const startIndex = (safePage - 1) * pageSize
  const endIndex = Math.min(startIndex + pageSize, filteredPendingItems.length)
  const paginatedPendingItems = filteredPendingItems.slice(startIndex, endIndex)

  function handleApprove(id: string) {
    setPendingId(id)
    approveStagedEntry(id).then((res) => {
      setPendingId(null)
      if (res.ok) router.refresh()
      else alert(res.error)
    })
  }

  function handleReject(id: string) {
    setPendingId(id)
    rejectStagedEntry(id).then((res) => {
      setPendingId(null)
      if (res.ok) router.refresh()
      else alert(res.error)
    })
  }

  function handleApproveAll() {
    if (
      !confirm(
        `Are you sure you want to approve and publish all ${pendingItems.length} pending items to the tracker?`
      )
    )
      return
    startTransition(async () => {
      const res = await approveAllStagedEntries()
      if (res.ok) {
        setCurrentPage(1)
        router.refresh()
      } else {
        alert(res.error)
      }
    })
  }

  function handleRejectAll() {
    if (!confirm(`Are you sure you want to reject all ${pendingItems.length} pending items?`)) return
    startTransition(async () => {
      const res = await rejectAllStagedEntries()
      if (res.ok) {
        setCurrentPage(1)
        router.refresh()
      } else {
        alert(res.error)
      }
    })
  }

  function handleClearHistory() {
    startTransition(async () => {
      const res = await clearStagingHistory()
      if (res.ok) router.refresh()
      else alert(res.error)
    })
  }

  return (
    <div className="space-y-6">
      {/* Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border border-slate-200 bg-surface p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600 border border-amber-200 shrink-0">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-display text-sm font-semibold text-ink">
              Pending Sync Approvals ({pendingItems.length})
            </h3>
            <p className="text-xs text-ink-dim">
              Items synced from APIs must be approved before appearing on the official tracker.
            </p>
          </div>
        </div>

        {pendingItems.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleApproveAll}
              disabled={bulkPending}
              className="gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-display"
            >
              {bulkPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCheck className="h-3.5 w-3.5" />
              )}
              Approve All ({pendingItems.length})
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRejectAll}
              disabled={bulkPending}
              className="gap-1 text-xs border-red-200 text-red-600 hover:bg-red-50"
            >
              <X className="h-3.5 w-3.5" />
              Reject All
            </Button>
          </div>
        )}
      </div>

      {/* Search, Sort, and Filter Controls Bar */}
      {pendingItems.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-12 rounded-xl border border-slate-200 bg-surface p-3 shadow-card">
          {/* Search Input */}
          <div className="relative sm:col-span-6">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setCurrentPage(1)
              }}
              placeholder="Search pending titles, ep #, or slug..."
              className="w-full h-9 rounded-lg border border-slate-200 bg-surface pl-9 pr-3 text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-faint" />
          </div>

          {/* Sort Selector */}
          <div className="relative sm:col-span-3">
            <select
              value={sortOrder}
              onChange={(e) => {
                setSortOrder(e.target.value as SortOption)
                setCurrentPage(1)
              }}
              className="w-full h-9 rounded-lg border border-slate-200 bg-surface pl-8 pr-3 text-xs text-ink focus:border-accent focus:outline-none font-display"
            >
              <option value="newest">Sort: Newest to Oldest</option>
              <option value="oldest">Sort: Oldest to Newest</option>
              <option value="a-z">Sort: Title (A to Z)</option>
              <option value="z-a">Sort: Title (Z to A)</option>
            </select>
            <ArrowUpDown className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-ink-faint" />
          </div>

          {/* Type Filter */}
          <div className="relative sm:col-span-3">
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value)
                setCurrentPage(1)
              }}
              className="w-full h-9 rounded-lg border border-slate-200 bg-surface pl-8 pr-3 text-xs text-ink focus:border-accent focus:outline-none font-display"
            >
              <option value="all">Filter: All Types</option>
              <option value="episode">Episodes</option>
              <option value="movie">Movies</option>
              <option value="special">Specials</option>
              <option value="ova">OVAs</option>
              <option value="magic_kaito">Magic Kaito</option>
              <option value="hanzawa">The Culprit Hanzawa</option>
              <option value="zero_tea_time">Zero's Tea Time</option>
              <option value="yaiba">Yaiba</option>
            </select>
            <Filter className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-ink-faint" />
          </div>
        </div>
      )}

      {/* Page Splitter / Count Bar */}
      {filteredPendingItems.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-slate-200 bg-surface-muted/50 px-4 py-2.5 text-xs text-ink-dim">
          <div className="flex items-center gap-2 font-mono">
            <span>
              Showing <strong className="text-ink font-semibold">{startIndex + 1}</strong> to{" "}
              <strong className="text-ink font-semibold">{endIndex}</strong> of{" "}
              <strong className="text-ink font-semibold">{filteredPendingItems.length}</strong> matching items
              {filteredPendingItems.length < pendingItems.length && (
                <span className="text-ink-faint text-[11px] ml-1">
                  (filtered from {pendingItems.length} total)
                </span>
              )}
            </span>
          </div>

          <div className="flex items-center gap-4">
            {/* Page Size Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-ink-faint font-mono text-[11px]">Per Page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setCurrentPage(1)
                }}
                className="h-7 rounded border border-slate-200 bg-surface px-2 text-xs font-mono text-ink focus:border-accent focus:outline-none"
              >
                <option value={12}>12</option>
                <option value={24}>24</option>
                <option value={48}>48</option>
                <option value={96}>96</option>
              </select>
            </div>

            {/* Pagination Buttons */}
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="h-7 px-2 text-xs gap-1"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev
              </Button>

              <span className="px-2 font-mono text-xs font-semibold text-ink">
                Page {safePage} of {totalPages}
              </span>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="h-7 px-2 text-xs gap-1"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Pending Items List */}
      {filteredPendingItems.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-surface p-10 text-center shadow-card">
          <CheckCheck className="mx-auto h-10 w-10 text-green-500 mb-2" />
          <h4 className="font-display text-base text-ink font-semibold">
            {pendingItems.length === 0 ? "Queue is Clean!" : "No Matching Pending Items"}
          </h4>
          <p className="mt-1 text-xs text-ink-dim max-w-md mx-auto">
            {pendingItems.length === 0
              ? "There are no new synced entries waiting for review. When API sync discovers new episodes or movies, they will appear here."
              : "No pending entries matched your search query or filters. Try adjusting your filter parameters."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {paginatedPendingItems.map((item) => {
            const isProcessing = pendingId === item.id || bulkPending

            return (
              <div
                key={item.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-surface p-4 shadow-card hover:border-slate-300 transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-medium text-slate-700 border border-slate-200 uppercase">
                      {item.type}{" "}
                      {item.episode_number
                        ? `#${item.episode_number}`
                        : item.movie_number
                        ? `#${item.movie_number}`
                        : ""}
                    </span>
                    <span className="font-mono text-[10px] text-amber-600 uppercase font-semibold">
                      Via {item.source}
                    </span>
                  </div>

                  <div className="flex gap-3 items-start mb-3">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.title}
                        className="h-14 w-10 rounded object-cover border border-slate-200 shrink-0"
                      />
                    ) : (
                      <div className="h-14 w-10 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-[9px] text-ink-faint shrink-0">
                        No image
                      </div>
                    )}
                    <div>
                      <h4 className="font-display text-sm font-semibold text-ink line-clamp-2">
                        {item.title}
                      </h4>
                      <p className="text-[11px] font-mono text-ink-faint mt-0.5">
                        Air Date: {item.air_date ?? "Unknown"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                  <Button
                    size="sm"
                    onClick={() => handleApprove(item.id)}
                    disabled={isProcessing}
                    className="flex-1 gap-1 h-8 text-xs bg-green-600 hover:bg-green-700 text-white font-display"
                  >
                    {pendingId === item.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleReject(item.id)}
                    disabled={isProcessing}
                    className="h-8 px-3 text-xs border-red-200 text-red-600 hover:bg-red-50"
                  >
                    <X className="h-3.5 w-3.5" />
                    Reject
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Bottom Pagination Bar */}
      {filteredPendingItems.length > 0 && totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-200 pt-4">
          <div className="text-xs font-mono text-ink-faint">
            Page {safePage} of {totalPages} ({filteredPendingItems.length} matching pending)
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="h-8 px-3 text-xs gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous Page
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="h-8 px-3 text-xs gap-1"
            >
              Next Page
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Reviewed History */}
      {reviewedItems.length > 0 && (
        <div className="space-y-3 pt-6 border-t border-slate-200">
          <div className="flex items-center justify-between">
            <h4 className="font-display text-xs font-semibold text-ink-dim uppercase tracking-wider">
              Recent Staging History ({reviewedItems.length})
            </h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearHistory}
              disabled={bulkPending}
              className="gap-1 text-xs text-ink-faint hover:text-ink"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear History
            </Button>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-surface-muted/50 font-display text-[10px] text-ink-dim uppercase">
                <tr>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reviewedItems.slice(0, 10).map((item) => (
                  <tr key={item.id} className="hover:bg-surface-muted/30">
                    <td className="px-3 py-2 font-medium text-ink truncate max-w-xs">{item.title}</td>
                    <td className="px-3 py-2 text-ink-dim">{item.type}</td>
                    <td className="px-3 py-2 text-ink-faint uppercase font-mono">{item.source}</td>
                    <td className="px-3 py-2">
                      {item.status === "approved" ? (
                        <span className="inline-flex items-center text-green-600 font-medium font-mono text-[10px]">
                          ✓ Approved
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-red-500 font-medium font-mono text-[10px]">
                          ✕ Rejected
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
