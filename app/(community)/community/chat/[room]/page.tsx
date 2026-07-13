"use client"

import { useState, useEffect, useRef } from "react"
import { Navbar } from "@/components/layout/Navbar"
import { Footer } from "@/components/layout/Footer"
import { ChatWindow } from "@/components/community/ChatWindow"
import { createClient } from "@/utils/supabase/client"
import type { Database } from "@/types/database.types"

type ChatRoom = Database["public"]["Tables"]["chat_rooms"]["Row"]

export default function ChatRoomPage({
  params,
}: {
  params: Promise<{ room: string }>
}) {
  const [room, setRoom] = useState<ChatRoom | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    async function loadRoom() {
      const { room: slug } = await params
      const { data, error } = await supabase
        .from("chat_rooms")
        .select("*")
        .eq("slug", slug)
        .single()

      if (error || !data) {
        setNotFound(true)
      } else {
        setRoom(data)
      }
      setLoading(false)
    }

    loadRoom()
  }, [params])

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1 px-6 py-10">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8 flex items-center gap-3">
            <span className="case-number">FILE NO. 006 — SECURE CHANNEL</span>
            <span className="redacted-bar w-16" />
          </div>

          {loading ? (
            <div className="text-center py-16">
              <p className="font-display text-lg uppercase text-silver-steel animate-pulse">
                Connecting to secure channel...
              </p>
            </div>
          ) : notFound || !room ? (
            <div className="text-center py-16">
              <p className="font-display text-lg uppercase text-silver-steel">
                Channel not found
              </p>
              <p className="text-sm text-dossier-cream-dim mt-2">
                This secure channel does not exist or has been decommissioned.
              </p>
            </div>
          ) : (
            <ChatWindow room={room} />
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}
