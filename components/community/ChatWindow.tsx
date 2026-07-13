"use client"

import { useState, useEffect, useRef } from "react"
import { Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { createClient } from "@/utils/supabase/client"
import { avatarUrl } from "@/lib/constants"
import type { Database } from "@/types/database.types"

type ChatRoom = Database["public"]["Tables"]["chat_rooms"]["Row"]
type ChatMessage = Database["public"]["Tables"]["chat_messages"]["Row"] & {
  profiles: { username: string; display_name: string; avatar_url: string | null } | null
}

export function ChatWindow({ room }: { room: ChatRoom }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [newMessage, setNewMessage] = useState("")
  const [sending, setSending] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  useEffect(() => {
    async function init() {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser()
      if (user) setUserId(user.id)

      // Load messages
      const { data } = await supabase
        .from("chat_messages")
        .select("*, profiles:user_id(username, display_name, avatar_url)")
        .eq("room_id", room.id)
        .order("created_at", { ascending: true })
        .limit(100)

      if (data) setMessages(data as ChatMessage[])

      // Subscribe to new messages
      const channel = supabase
        .channel(`chat:${room.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "chat_messages",
            filter: `room_id=eq.${room.id}`,
          },
          async (payload) => {
            // Fetch the full message with profile
            const { data: fullMessage } = await supabase
              .from("chat_messages")
              .select("*, profiles:user_id(username, display_name, avatar_url)")
              .eq("id", payload.new.id)
              .single()

            if (fullMessage) {
              setMessages((prev) => [...prev, fullMessage as ChatMessage])
            }
          }
        )
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    }

    init()
  }, [room.id])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!newMessage.trim() || !userId || sending) return

    setSending(true)
    const content = newMessage.trim()
    setNewMessage("")

    const { error } = await supabase.from("chat_messages").insert({
      room_id: room.id,
      user_id: userId,
      content,
    })

    if (error) {
      setNewMessage(content) // Restore on error
    }

    setSending(false)
  }

  return (
    <div>
      <h1 className="font-display text-2xl uppercase tracking-wide text-dossier-cream mb-1">
        {room.name}
      </h1>
      {room.description && (
        <p className="text-sm text-dossier-cream-dim mb-6">{room.description}</p>
      )}

      <div className="dossier-card flex flex-col h-[60vh]">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-16">
              <p className="font-display text-sm uppercase text-silver-steel">
                No messages yet
              </p>
              <p className="text-xs text-dossier-cream-dim mt-1">
                Be the first to break the silence.
              </p>
            </div>
          )}

          {messages.map((msg) => {
            const isOwn = msg.user_id === userId
            const profile = msg.profiles

            return (
              <div
                key={msg.id}
                className={`flex gap-3 ${isOwn ? "flex-row-reverse" : ""}`}
              >
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage
                    src={profile?.avatar_url ?? avatarUrl(profile?.display_name ?? "?")}
                  />
                  <AvatarFallback className="bg-poison-red text-dossier-cream text-xs">
                    {profile?.display_name?.slice(0, 2).toUpperCase() ?? "??"}
                  </AvatarFallback>
                </Avatar>

                <div className={`max-w-[70%] ${isOwn ? "text-right" : ""}`}>
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="case-number">
                      {profile?.username ?? "unknown"}
                    </span>
                    <span className="text-[10px] text-dossier-cream-dim">
                      {new Date(msg.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div
                    className={`inline-block rounded-sm px-3 py-2 text-sm ${
                      isOwn
                        ? "bg-poison-red/30 text-dossier-cream"
                        : "bg-case-file-raised text-dossier-cream"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSend} className="border-t border-white/5 p-4 flex gap-2">
          <Input
            placeholder={userId ? "Send a message..." : "Sign in to chat"}
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            disabled={!userId}
            className="flex-1"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!userId || !newMessage.trim() || sending}
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  )
}
