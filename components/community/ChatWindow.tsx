"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Link from "next/link"
import { Send, Menu, ArrowDown, LogIn, UserPlus, MessagesSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { createClient } from "@/utils/supabase/client"
import { avatarUrl } from "@/lib/constants"
import { cn } from "@/lib/utils"
import type { Database } from "@/types/database.types"

type ChatRoom = Database["public"]["Tables"]["chat_rooms"]["Row"]
type Profile = { username: string; display_name: string; avatar_url: string | null }
type ChatMessage = Database["public"]["Tables"]["chat_messages"]["Row"] & {
  profiles: Profile | null
}

const MESSAGE_QUERY = "*, profiles:user_id(username, display_name, avatar_url)"
const GROUP_GAP_MS = 5 * 60 * 1000
const PAGE_SIZE = 100

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function formatDay(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  if (sameDay(d, today)) return "Today"
  if (sameDay(d, yesterday)) return "Yesterday"
  return d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  })
}

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || "?"
}

export function ChatWindow({
  room,
  onOpenRooms,
}: {
  room: ChatRoom
  onOpenRooms: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [newMessage, setNewMessage] = useState("")
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [me, setMe] = useState<Profile | null>(null)
  const [connected, setConnected] = useState(false)
  const [unread, setUnread] = useState(0)

  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const atBottomRef = useRef(true)
  const initialLoadRef = useRef(true)
  const supabase = createClient()

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" })
    atBottomRef.current = true
    setUnread(0)
  }, [])

  const loadEarlier = useCallback(async () => {
    if (loadingMore || messages.length === 0) return
    setLoadingMore(true)
    const oldest = messages[0].created_at
    const el = scrollRef.current
    const prevScrollHeight = el?.scrollHeight ?? 0

    const { data, error: moreError } = await supabase
      .from("chat_messages")
      .select(MESSAGE_QUERY)
      .eq("room_id", room.id)
      .lt("created_at", oldest)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE)

    if (!moreError && data) {
      const older = (data as ChatMessage[]).slice().reverse()
      setMessages((prev) => {
        const existing = new Set(prev.map((m) => m.id))
        return [...older.filter((m) => !existing.has(m.id)), ...prev]
      })
      setHasMore(data.length === PAGE_SIZE)
      // Preserve scroll position so the view doesn't jump.
      requestAnimationFrame(() => {
        const node = scrollRef.current
        if (node) node.scrollTop = node.scrollHeight - prevScrollHeight
      })
    }
    setLoadingMore(false)
  }, [loadingMore, messages, room.id, supabase])

  useEffect(() => {
    let active = true

    async function init() {
      const { data: authData } = await supabase.auth.getUser()
      const user = authData.user
      if (!user) {
        setLoading(false)
        return
      }
      if (active) setUserId(user.id)

      const { data: profileData } = await supabase
        .from("profiles")
        .select("username, display_name, avatar_url")
        .eq("user_id", user.id)
        .single()

      if (profileData && active) setMe(profileData as Profile)

      // Load the most recent page of messages (newest first), then flip to
      // chronological order for rendering.
      const { data, error: loadError } = await supabase
        .from("chat_messages")
        .select(MESSAGE_QUERY)
        .eq("room_id", room.id)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE)

      if (active) {
        if (loadError) {
          setError("Couldn't load messages. Check your connection and refresh.")
        } else if (data) {
          const ordered = (data as ChatMessage[]).slice().reverse()
          setMessages(ordered)
          setHasMore(data.length === PAGE_SIZE)
        }
        setLoading(false)
        initialLoadRef.current = true
        requestAnimationFrame(() => scrollToBottom(false))
      }

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
            const { data: full } = await supabase
              .from("chat_messages")
              .select(MESSAGE_QUERY)
              .eq("id", (payload.new as { id: string }).id)
              .single()
            if (!full) return
            setMessages((prev) =>
              prev.some((m) => m.id === (full as ChatMessage).id)
                ? prev
                : [...prev, full as ChatMessage]
            )
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") setConnected(true)
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
            setConnected(false)
        })

      return () => {
        supabase.removeChannel(channel)
      }
    }

    const cleanup = init()
    return () => {
      active = false
      cleanup.then((fn) => fn && fn())
    }
  }, [room.id, scrollToBottom, supabase])

  // New-message scroll handling: snap to bottom if user is at bottom,
  // otherwise surface a "new messages" pill with an unread count.
  useEffect(() => {
    if (initialLoadRef.current) {
      initialLoadRef.current = false
      return
    }
    if (atBottomRef.current) {
      scrollToBottom(true)
    } else {
      setUnread((u) => u + 1)
    }
  }, [messages, scrollToBottom])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80
    atBottomRef.current = atBottom
    if (atBottom) setUnread(0)
  }

  function autoGrow() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  async function handleSend() {
    const content = newMessage.trim()
    if (!content || !userId || sending) return

    setSending(true)
    setError(null)

    const tempId = `temp-${crypto.randomUUID()}`
    const optimistic: ChatMessage = {
      id: tempId,
      room_id: room.id,
      user_id: userId,
      content,
      created_at: new Date().toISOString(),
      profiles: me,
    }
    setMessages((prev) => [...prev, optimistic])
    setNewMessage("")
    requestAnimationFrame(() => {
      autoGrow()
      scrollToBottom(true)
    })

    const { data, error: insertError } = await supabase
      .from("chat_messages")
      .insert({ room_id: room.id, user_id: userId, content })
      .select(MESSAGE_QUERY)
      .single()

    if (insertError || !data) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      setNewMessage(content)
      setError("Message failed to send. Try again.")
    } else {
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? (data as ChatMessage) : m))
      )
    }
    setSending(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-white">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <button
          onClick={onOpenRooms}
          aria-label="Open rooms"
          className="-ml-1 rounded-sm p-1.5 text-gray-500 hover:bg-gray-100 md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate font-display text-lg uppercase tracking-wide text-gray-900">
              {room.name}
            </h1>
            <span
              className={cn(
                "flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide",
                connected
                  ? "bg-green-50 text-green-600"
                  : "bg-gray-100 text-gray-400"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  connected ? "bg-green-500" : "bg-gray-400"
                )}
              />
              {connected ? "Live" : "…"}
            </span>
          </div>
          {room.description && (
            <p className="truncate text-xs text-gray-400">{room.description}</p>
          )}
        </div>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-y-auto px-4 py-4"
      >
        {loading ? (
          <ChatSkeleton />
        ) : !userId ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <MessagesSquare className="h-8 w-8 text-gray-300" />
            <p className="mt-4 font-display text-sm uppercase tracking-wide text-gray-500">
              Sign in to read the conversation
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Link href="/login">
                <Button size="sm" className="rounded-lg">
                  Sign In
                </Button>
              </Link>
              <Link href="/signup">
                <Button size="sm" variant="outline" className="rounded-lg border-gray-200">
                  Sign Up
                </Button>
              </Link>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <MessagesSquare className="h-8 w-8 text-gray-300" />
            <p className="mt-4 font-display text-sm uppercase tracking-wide text-gray-500">
              No messages yet
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Be the first to break the silence.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {hasMore && (
              <div className="flex justify-center py-2">
                <button
                  onClick={loadEarlier}
                  disabled={loadingMore}
                  className="rounded-full border border-gray-200 bg-white px-4 py-1.5 font-mono text-[11px] uppercase tracking-wide text-gray-500 hover:text-gray-900 hover:border-gray-300 disabled:opacity-50 transition-colors"
                >
                  {loadingMore ? "Loading…" : "Load earlier messages"}
                </button>
              </div>
            )}
            {messages.map((msg, i) => {
              const prev = messages[i - 1]
              const isOwn = msg.user_id === userId
              const showDay =
                !prev || formatDay(prev.created_at) !== formatDay(msg.created_at)
              const grouped =
                !showDay &&
                !!prev &&
                prev.user_id === msg.user_id &&
                new Date(msg.created_at).getTime() -
                  new Date(prev.created_at).getTime() <
                  GROUP_GAP_MS
              const pending = msg.id.startsWith("temp-")

              return (
                <div key={msg.id}>
                  {showDay && (
                    <div className="my-4 flex items-center justify-center">
                      <span className="rounded-full border border-gray-200 bg-white px-3 py-0.5 font-mono text-[11px] uppercase tracking-wide text-gray-400">
                        {formatDay(msg.created_at)}
                      </span>
                    </div>
                  )}
                  <div
                    className={cn(
                      "group flex gap-3",
                      isOwn ? "flex-row-reverse" : "",
                      grouped ? "mt-0.5" : "mt-3"
                    )}
                  >
                    <Avatar
                      className={cn(
                        "h-8 w-8 shrink-0",
                        grouped && "invisible"
                      )}
                    >
                      <AvatarImage
                        src={
                          msg.profiles?.avatar_url ??
                          avatarUrl(msg.profiles?.display_name ?? "?")
                        }
                      />
                      <AvatarFallback className="bg-[#7A1620] text-xs text-white">
                        {initials(msg.profiles?.display_name ?? "?")}
                      </AvatarFallback>
                    </Avatar>

                    <div
                      className={cn(
                        "flex min-w-0 max-w-[78%] flex-col",
                        isOwn ? "items-end" : "items-start"
                      )}
                    >
                      {!grouped && (
                        <div
                          className={cn(
                            "mb-1 flex items-baseline gap-2",
                            isOwn && "flex-row-reverse"
                          )}
                        >
                          <span className="truncate text-sm font-medium text-gray-900">
                            {msg.profiles?.display_name ||
                              msg.profiles?.username ||
                              "Unknown"}
                          </span>
                          <span className="shrink-0 font-mono text-[11px] text-gray-400">
                            {formatTime(msg.created_at)}
                          </span>
                        </div>
                      )}

                      <div className="relative flex items-end gap-2">
                        <div
                          className={cn(
                            "whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm",
                            isOwn
                              ? "bg-[#7A1620] text-white"
                              : "bg-gray-100 text-gray-900",
                            pending && "opacity-60"
                          )}
                        >
                          {msg.content}
                        </div>
                        {grouped && (
                          <span
                            className={cn(
                              "mb-0.5 shrink-0 font-mono text-[10px] text-gray-400 opacity-0 transition-opacity group-hover:opacity-100",
                              isOwn ? "order-first pr-1" : "pl-1"
                            )}
                          >
                            {formatTime(msg.created_at)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={endRef} />
          </div>
        )}

        {/* Scroll-to-bottom pill */}
        {unread > 0 && (
          <button
            onClick={() => scrollToBottom(true)}
            className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[#7A1620] px-3 py-1.5 text-xs font-medium text-white shadow-lg transition-colors hover:bg-[#A5202D]"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            {unread} new message{unread > 1 ? "s" : ""}
          </button>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-gray-200 bg-white p-3">
        {error && (
          <p className="mb-2 px-1 text-xs text-[#A5202D]">{error}</p>
        )}

        {userId ? (
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              rows={1}
              value={newMessage}
              onChange={(e) => {
                setNewMessage(e.target.value)
                autoGrow()
              }}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${room.name}…`}
              className="max-h-40 min-h-[40px] flex-1 resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus-visible:border-[#7A1620] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7A1620]"
            />
            <Button
              type="button"
              size="icon"
              onClick={handleSend}
              disabled={!newMessage.trim() || sending}
              aria-label="Send message"
              className="h-10 w-10 shrink-0 rounded-lg"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center sm:flex-row sm:justify-center">
            <p className="text-sm text-gray-500">
              Sign in to join the conversation.
            </p>
            <div className="flex items-center gap-2">
              <Link href="/login">
                <Button size="sm" className="gap-1.5 rounded-lg">
                  <LogIn className="h-4 w-4" />
                  Sign In
                </Button>
              </Link>
              <Link href="/signup">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 rounded-lg border-gray-200"
                >
                  <UserPlus className="h-4 w-4" />
                  Sign Up
                </Button>
              </Link>
            </div>
          </div>
        )}

        {userId && (
          <p className="mt-1.5 px-1 text-[11px] text-gray-400">
            <kbd className="font-mono">Enter</kbd> to send ·{" "}
            <kbd className="font-mono">Shift + Enter</kbd> for a new line
          </p>
        )}
      </div>
    </div>
  )
}

function ChatSkeleton() {
  const rows = [60, 40, 75, 30, 50]
  return (
    <div className="space-y-4">
      {rows.map((w, i) => (
        <div
          key={i}
          className={cn("flex gap-3", i % 2 === 0 ? "" : "flex-row-reverse")}
        >
          <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-gray-200" />
          <div
            className={cn(
              "h-10 animate-pulse rounded-lg bg-gray-100",
              i % 2 === 0 ? "self-start" : "self-end"
            )}
            style={{ width: `${w}%` }}
          />
        </div>
      ))}
    </div>
  )
}
