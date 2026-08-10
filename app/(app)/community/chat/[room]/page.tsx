import { notFound } from "next/navigation"
import { getChatRooms, getChatRoomBySlug } from "@/lib/queries/chat"
import { ChatLayout } from "@/components/community/ChatLayout"

export const dynamic = "force-dynamic"

export default async function ChatRoomPage({
  params,
}: {
  params: Promise<{ room: string }>
}) {
  const { room: roomSlug } = await params

  const [rooms, room] = await Promise.all([
    getChatRooms(),
    getChatRoomBySlug(roomSlug).catch(() => null),
  ])

  if (!room) {
    notFound()
  }

  return (
    <div className="h-[calc(100vh-4rem)] supports-[height:100dvh]:h-[calc(100dvh-4rem)]">
      <ChatLayout rooms={rooms} room={room} />
    </div>
  )
}
