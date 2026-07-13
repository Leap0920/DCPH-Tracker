"use client"

import { useState, useEffect } from "react"
import { RankingsTable } from "@/components/community/RankingsTable"
import { createClient } from "@/utils/supabase/client"
import type { Database } from "@/types/database.types"

type LeaderboardRow = Database["public"]["Views"]["leaderboard"]["Row"]

export default function RankingsPage() {
  const [rankings, setRankings] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function loadRankings() {
      const { data } = await supabase
        .from("leaderboard")
        .select("*")
        .limit(50)

      if (data) setRankings(data as LeaderboardRow[])
      setLoading(false)
    }

    loadRankings()
  }, [])

  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-center gap-3">
          <span className="case-number">FILE NO. 005 — RANKINGS</span>
          <span className="redacted-bar w-16" />
        </div>

        <h1 className="font-display text-3xl sm:text-4xl uppercase tracking-wide text-dossier-cream mb-2">
          Agent Rankings
        </h1>
        <p className="text-dossier-cream-dim mb-8 max-w-xl">
          The leaderboard. Climb the ranks by watching episodes and earning badges.
        </p>

        {loading ? (
          <div className="text-center py-16">
            <p className="font-display text-lg uppercase text-silver-steel animate-pulse">
              Loading rankings...
            </p>
          </div>
        ) : (
          <RankingsTable rankings={rankings} />
        )}
      </div>
    </div>
  )
}
