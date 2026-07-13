"use client"

import { useState, useEffect } from "react"
import { Navbar } from "@/components/layout/Navbar"
import { Footer } from "@/components/layout/Footer"
import { ContentGrid } from "@/components/tracker/ContentGrid"
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
      // Fetch content
      const { data: contentData } = await supabase
        .from("content_entries")
        .select("*")
        .order("air_date", { ascending: true })

      if (contentData) setEntries(contentData)

      // Fetch user watch statuses
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

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1 px-6 py-10">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 flex items-center gap-3">
            <span className="case-number">FILE NO. 003 — CASE FILES</span>
            <span className="redacted-bar w-16" />
          </div>

          <h1 className="font-display text-3xl sm:text-4xl uppercase tracking-wide text-dossier-cream mb-2">
            Case Files
          </h1>
          <p className="text-dossier-cream-dim mb-8 max-w-xl">
            Every episode, movie, special, and OVA — tracked and catalogued.
          </p>

          {loading ? (
            <div className="text-center py-16">
              <p className="font-display text-lg uppercase text-silver-steel animate-pulse">
                Loading case files...
              </p>
            </div>
          ) : (
            <ContentGrid
              entries={entries}
              userStatuses={userStatuses}
              onToggleStatus={handleToggleStatus}
            />
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}
