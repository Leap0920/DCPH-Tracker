"use client"

import { useState, useEffect } from "react"
import { ChatWindow } from "@/components/community/ChatWindow"
import { createClient } from "@/utils/supabase/client"
import type { Database } from "@/types/database.types"
import { useParams } from "next/navigation"

type ChatRoom = Database["public"]["Tables"]["chat_rooms"]["Row"]

export default function ChatRoomPage() {
  const params = useParams()
  const roomSlug = params.room as string
  const [room, setRoom] = useState<ChatRoom | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function loadRoom() {
      const { data } = await supabase
        .from("chat_rooms")
        .select("*")
        .eq("slug", roomSlug)
        .single()

      setRoom(data)
      setLoading(false)
    }

    loadRoom()
  }, [roomSlug])

  if (loading) {
    return (
      <div className="px-6 py-10">
        <div className="mx-auto max-w-3xl text-center py-16">
          <p className="font-display text-lg uppercase text-silver-steel animate-pulse">
            Loading chat room...
          </p>
        </div>
      </div>
    )
  }

  if (!room) {
    return (
      <div className="px-6 py-10">
        <div className="mx-auto max-w-3xl text-center py-16">
          <p className="font-display text-lg uppercase text-silver-steel">
            Chat room not found
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="case-number">FILE NO. 006 — LIVE COMMS</span>
          <span className="redacted-bar w-16" />
        </div>

        <ChatWindow room={room} />
      </div>
    </div>
  )
}
