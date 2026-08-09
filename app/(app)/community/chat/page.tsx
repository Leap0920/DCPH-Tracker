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
          <h1 className="font-display text-3xl tracking-tight text-ink">
            Community Chat
          </h1>
          <p className="mt-2 text-sm text-ink-faint">
            Drop into a room, talk cases, and connect with fellow detectives.
          </p>
        </div>

        {rooms.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-surface p-12 text-center shadow-card">
            <MessagesSquare className="mx-auto h-8 w-8 text-ink-faint" />
            <p className="mt-4 font-display text-sm text-ink-dim">
              No chat rooms available
            </p>
            <p className="mt-1 text-xs text-ink-faint">
              Check back later — new rooms open all the time.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {rooms.map((room) => (
              <Link
                key={room.id}
                href={`/community/chat/${room.slug}`}
                className="group flex flex-col rounded-lg border border-slate-200 bg-surface p-5 shadow-card transition-colors hover:border-slate-300 hover:bg-surface-muted"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent/10 text-accent">
                      <MessagesSquare className="h-4 w-4" />
                    </span>
                    <h2 className="font-display text-lg tracking-tight text-ink">
                      {room.name}
                    </h2>
                  </div>
                  <ArrowRight className="h-4 w-4 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink-dim" />
                </div>

                {room.description && (
                  <p className="mt-3 text-sm text-ink-dim line-clamp-2">
                    {room.description}
                  </p>
                )}

                <div className="mt-4 flex items-center gap-1.5 text-xs text-ink-faint">
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
