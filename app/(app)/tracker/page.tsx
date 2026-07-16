"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { ContentGrid } from "@/components/tracker/ContentGrid"
import { ProgressIndicator } from "@/components/tracker/ProgressIndicator"
import { Button } from "@/components/ui/button"
import { createClient } from "@/utils/supabase/client"
import type { Database } from "@/types/database.types"
import type { WatchStatus } from "@/lib/constants"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

export default function TrackerPage() {
  const [entries, setEntries] = useState<ContentEntry[]>([])
  const [userStatuses, setUserStatuses] = useState<Map<string, WatchStatus>>(new Map())
  const [user, setUser] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  async function loadData() {
    setLoading(true)
    setError(null)

    const { data: contentData, error: contentError } = await supabase
      .from("content_entries")
      .select("*")
      .order("air_date", { ascending: true })

    if (contentError) {
      setError("We couldn't load the case files. Please try again.")
      setLoading(false)
      return
    }

    setEntries(contentData ?? [])

    const { data: { user } } = await supabase.auth.getUser()
    setUser(user?.id ?? null)
    if (user) {
      const { data: statusData } = await supabase
        .from("watch_status")
        .select("content_id, status")
        .eq("user_id", user.id)

      if (statusData) {
        const map = new Map<string, WatchStatus>()
        statusData.forEach((s) => map.set(s.content_id, s.status as WatchStatus))
        setUserStatuses(map)
      }
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
      currentStatus === "watched"
        ? "unwatched"
        : currentStatus === "watching"
          ? "watched"
          : "watching"

    const { error } = await supabase
      .from("watch_status")
      .upsert(
        { user_id: user.id, content_id: contentId, status: nextStatus },
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
  }

  return (
    <div className="px-0 sm:px-6 py-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
        {loading ? (
          <div className="text-center py-24">
            <div className="inline-flex items-center gap-3">
              <div className="h-2 w-2 bg-gray-900 rounded-full animate-pulse" />
              <p className="font-display text-lg uppercase text-gray-500 animate-pulse tracking-widest">
                Loading case files...
              </p>
              <div className="h-2 w-2 bg-gray-900 rounded-full animate-pulse" style={{ animationDelay: "0.3s" }} />
            </div>
          </div>
        ) : error && entries.length === 0 ? (
          <div className="text-center py-24 px-6">
            <p className="font-display text-lg uppercase tracking-widest text-gray-900 mb-2">
              Investigation stalled
            </p>
            <p className="text-sm text-gray-500 mb-6">{error}</p>
            <Button onClick={loadData} className="rounded-lg">
              Try Again
            </Button>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-24 px-6">
            <p className="font-display text-lg uppercase tracking-widest text-gray-900 mb-2">
              No case files yet
            </p>
            <p className="text-sm text-gray-500">
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
            <ProgressIndicator entries={entries} userStatuses={userStatuses} />
            {!user && (
              <div className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-white p-5">
                <div className="flex-1">
                  <p className="font-display text-base uppercase tracking-wide text-gray-900">
                    Sign in to track your progress
                  </p>
                  <p className="text-sm text-gray-500">
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
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
              <ContentGrid
                entries={entries}
                userStatuses={userStatuses}
                onToggleStatus={user ? handleToggleStatus : undefined}
                onMarkAll={user ? handleMarkAll : undefined}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
