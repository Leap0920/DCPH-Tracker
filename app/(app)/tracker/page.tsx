"use client"

import { useState, useEffect } from "react"
import { ContentGrid } from "@/components/tracker/ContentGrid"
import { ProgressIndicator } from "@/components/tracker/ProgressIndicator"
import { createClient } from "@/utils/supabase/client"
import type { Database } from "@/types/database.types"
import type { WatchStatus } from "@/lib/constants"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

export default function TrackerPage() {
  const [entries, setEntries] = useState<ContentEntry[]>([])
  const [userStatuses, setUserStatuses] = useState<Map<string, WatchStatus>>(new Map())
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function loadData() {
      const { data: contentData } = await supabase
        .from("content_entries")
        .select("*")
        .order("air_date", { ascending: true })

      if (contentData) setEntries(contentData)

      const { data: { user } } = await supabase.auth.getUser()
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

    loadData()
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

    if (!error) {
      setUserStatuses((prev) => {
        const next = new Map(prev)
        next.set(contentId, nextStatus)
        return next
      })
    }
  }

  async function handleMarkAll(contentIds: string[], status: WatchStatus) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      window.location.href = "/login"
      return
    }

    const rows = contentIds.map((contentId) => ({
      user_id: user.id,
      content_id: contentId,
      status,
    }))

    const { error } = await supabase
      .from("watch_status")
      .upsert(rows, { onConflict: "user_id,content_id" })

    if (!error) {
      setUserStatuses((prev) => {
        const next = new Map(prev)
        contentIds.forEach((id) => next.set(id, status))
        return next
      })
    }
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
        ) : (
          <div className="space-y-6">
            <ProgressIndicator entries={entries} userStatuses={userStatuses} />
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
              <ContentGrid
                entries={entries}
                userStatuses={userStatuses}
                onToggleStatus={handleToggleStatus}
                onMarkAll={handleMarkAll}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
