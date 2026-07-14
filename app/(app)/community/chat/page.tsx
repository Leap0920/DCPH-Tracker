import Link from "next/link"
import { MessagesSquare, Users, ArrowRight } from "lucide-react"
import { getChatRooms } from "@/lib/queries/chat"

export const dynamic = "force-dynamic"

export default async function ChatDirectoryPage() {
  const rooms = await getChatRooms()

  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="case-number">FILE NO. 006 — LIVE COMMS</span>
          <span className="redacted-bar w-16" />
        </div>

        <div className="mb-8">
          <h1 className="font-display text-3xl uppercase tracking-wide text-gray-900">
            Community Chat
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Drop into a room, talk cases, and connect with fellow detectives.
          </p>
        </div>

        {rooms.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
            <MessagesSquare className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-4 font-display text-sm uppercase tracking-wide text-gray-500">
              No chat rooms available
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Check back later — new rooms open all the time.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {rooms.map((room) => (
              <Link
                key={room.id}
                href={`/community/chat/${room.slug}`}
                className="group flex flex-col rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-sm bg-[#7A1620]/10 text-[#7A1620]">
                      <MessagesSquare className="h-4 w-4" />
                    </span>
                    <h2 className="font-display text-lg uppercase tracking-wide text-gray-900">
                      {room.name}
                    </h2>
                  </div>
                  <ArrowRight className="h-4 w-4 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-500" />
                </div>

                {room.description && (
                  <p className="mt-3 text-sm text-gray-500 line-clamp-2">
                    {room.description}
                  </p>
                )}

                <div className="mt-4 flex items-center gap-1.5 text-xs text-gray-400">
                  <Users className="h-3.5 w-3.5" />
                  <span>Open room</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
