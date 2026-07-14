"use client"

import Link from "next/link"
import { useState } from "react"
import { MessagesSquare, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Database } from "@/types/database.types"
import { ChatWindow } from "@/components/community/ChatWindow"

type ChatRoom = Database["public"]["Tables"]["chat_rooms"]["Row"]

export function ChatLayout({
  rooms,
  room,
}: {
  rooms: ChatRoom[]
  room: ChatRoom
}) {
  const [mobileOpen, setMobileOpen] = useState(false)

  const sidebar = (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4">
        <span className="font-display text-sm uppercase tracking-wide text-gray-900">
          Rooms
        </span>
        <span className="rounded-sm bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-500">
          {rooms.length}
        </span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {rooms.map((r) => {
          const active = r.slug === room.slug
          return (
            <Link
              key={r.id}
              href={`/community/chat/${r.slug}`}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "relative flex items-start gap-3 rounded-sm px-3 py-2.5 transition-colors",
                active
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-600 hover:bg-gray-50"
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-[#7A1620]" />
              )}
              <MessagesSquare
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  active ? "text-[#7A1620]" : "text-gray-400"
                )}
              />
              <span className="min-w-0">
                <span className="block truncate font-display text-sm uppercase tracking-wide">
                  {r.name}
                </span>
                {r.description && (
                  <span className="block truncate text-xs text-gray-400">
                    {r.description}
                  </span>
                )}
              </span>
            </Link>
          )
        })}
      </nav>
    </div>
  )

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-7xl">
      {/* Desktop sidebar */}
      <aside className="hidden w-72 shrink-0 border-r border-gray-200 md:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-72 max-w-[80%] border-r border-gray-200 shadow-xl">
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close rooms"
              className="absolute right-2 top-3 z-10 rounded-sm p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              <X className="h-4 w-4" />
            </button>
            {sidebar}
          </div>
        </div>
      )}

      <ChatWindow
        room={room}
        onOpenRooms={() => setMobileOpen(true)}
      />
    </div>
  )
}
