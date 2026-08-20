"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { Send, Menu, ArrowDown, LogIn, UserPlus, MessagesSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { createClient } from "@/utils/supabase/client"
import { openAuthModal } from "@/lib/auth-modal"
import { avatarUrl } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { queryKeys } from "@/lib/queries/keys"
import {
  fetchChatMessages,
  fetchOlderChatMessages,
  fetchChatMessageById,
  CHAT_PAGE_SIZE,
  type ChatMessage,
} from "@/lib/queries/client/chat"
import { MAX_MESSAGE_LENGTH } from "@/lib/chat-constants"
import type { Database } from "@/types/database.types"

type ChatRoom = Database["public"]["Tables"]["chat_rooms"]["Row"]
type Profile = { username: string; display_name: string; avatar_url: string | null }

const GROUP_GAP_MS = 5 * 60 * 1000

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
  const [newMessage, setNewMessage] = useState("")
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
  const initialSyncRef = useRef(false)
  const supabase = createClient()
  const queryClient = useQueryClient()

  // Cache is newest-first (matches the fetch); rendering reverses to chronological.
  const messagesKey = queryKeys.chat.messages(room.id)

  // ── Auth + own profile (one-time, not cacheable data) ──
  useEffect(() => {
    let active = true
    supabase.auth.getUser().then(({ data: authData }) => {
      const user = authData.user
      if (!user || !active) return
      setUserId(user.id)

      supabase
        .from("profiles")
        .select("username, display_name, avatar_url")
        .eq("user_id", user.id)
        .single()
        .then(({ data: profileData }) => {
          if (profileData && active) setMe(profileData as Profile)
        })
    })
    return () => {
      active = false
    }
  }, [supabase])

  // ── Messages query (initial page, newest first) ──
  const messagesQuery = useQuery({
    queryKey: messagesKey,
    queryFn: () => fetchChatMessages(room.id),
    enabled: !!userId,
  })
  const messages = messagesQuery.data ?? []
  const loading = !!userId && messagesQuery.isLoading
  // Chronological order for rendering (cache is newest-first).
  const ordered = useMemo(() => [...messages].reverse(), [messages])

  // Sync `hasMore` from the initial page size exactly once.
  useEffect(() => {
    if (!initialSyncRef.current && messagesQuery.data) {
      initialSyncRef.current = true
      setHasMore(messagesQuery.data.length >= CHAT_PAGE_SIZE)
    }
  }, [messagesQuery.data])

  useEffect(() => {
    if (messagesQuery.isError) {
      setError("Couldn't load messages. Check your connection and refresh.")
    }
  }, [messagesQuery.isError])

  // ── Realtime (stays; appends into the react-query cache, deduped) ──
  useEffect(() => {
    if (!userId) return

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
          const incoming = await fetchChatMessageById(
            (payload.new as { id: string }).id
          )
          if (!incoming) return
          queryClient.setQueryData<ChatMessage[]>(messagesKey, (old) => {
            if (!old) return [incoming]
            return old.some((m) => m.id === incoming.id) ? old : [incoming, ...old]
          })
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
  }, [room.id, userId, supabase, queryClient, messagesKey])

  // ── Send mutation (optimistic temp message, deduped against realtime echo) ──
  const sendMutation = useMutation({
    mutationFn: async ({ content }: { content: string }): Promise<ChatMessage> => {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: room.id, content }),
      })
      const json = (await res.json().catch(() => null)) as
        | { success: true; data: { message: ChatMessage } }
        | { error?: string }
        | null
      if (!res.ok || !json || !("success" in json)) {
        const detail =
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : "Failed to send message"
        throw new Error(detail)
      }
      return json.data.message
    },
    onMutate: async ({ content }) => {
      await queryClient.cancelQueries({ queryKey: messagesKey })
      const tempId = `temp-${crypto.randomUUID()}`
      const optimistic: ChatMessage = {
        id: tempId,
        room_id: room.id,
        user_id: userId as string,
        content,
        created_at: new Date().toISOString(),
        profiles: me,
      }
      queryClient.setQueryData<ChatMessage[]>(messagesKey, (old) => [
        optimistic,
        ...(old ?? []),
      ])
      return { tempId, content }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) {
        queryClient.setQueryData<ChatMessage[]>(messagesKey, (old) =>
          old ? old.filter((m) => m.id !== ctx.tempId) : old
        )
      }
      setError("Message failed to send. Try again.")
      if (ctx) setNewMessage(ctx.content)
    },
    onSuccess: (data, _vars, ctx) => {
      if (!ctx) return
      queryClient.setQueryData<ChatMessage[]>(messagesKey, (old) => {
        if (!old) return [data]
        // Realtime echo may have delivered the real row already — drop temp only.
        if (old.some((m) => m.id === data.id)) {
          return old.filter((m) => m.id !== ctx.tempId)
        }
        return old.map((m) => (m.id === ctx.tempId ? data : m))
      })
      setError(null)
    },
  })

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
    const oldest = messages[messages.length - 1].created_at
    const el = scrollRef.current
    const prevScrollHeight = el?.scrollHeight ?? 0

    try {
      const older = await fetchOlderChatMessages(room.id, oldest)
      queryClient.setQueryData<ChatMessage[]>(messagesKey, (old) => {
        const existing = new Set((old ?? []).map((m) => m.id))
        return [...(old ?? []), ...older.filter((m) => !existing.has(m.id))]
      })
      setHasMore(older.length >= CHAT_PAGE_SIZE)
      // Preserve scroll position so the view doesn't jump.
      requestAnimationFrame(() => {
        const node = scrollRef.current
        if (node) node.scrollTop = node.scrollHeight - prevScrollHeight
      })
    } catch {
      setError("Couldn't load earlier messages. Try again.")
    }
    setLoadingMore(false)
  }, [loadingMore, messages, room.id, queryClient, messagesKey])

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

  function handleSend() {
    const content = newMessage.trim()
    if (!content || !userId || sendMutation.isPending) return

    setNewMessage("")
    requestAnimationFrame(() => {
      autoGrow()
      scrollToBottom(true)
    })
    sendMutation.mutate({ content })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-surface">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-ink-dim/20 bg-surface px-4 py-3">
        <button
          onClick={onOpenRooms}
          aria-label="Open rooms"
          className="-ml-1 rounded-md p-1.5 text-ink-dim hover:bg-surface-muted md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate font-display text-lg tracking-tight text-ink">
              {room.name}
            </h1>
            <span
              className={cn(
                "flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px]",
                connected
                  ? "bg-green-500/10 text-green-400"
                  : "bg-surface-muted text-ink-faint"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  connected ? "bg-green-500" : "bg-ink-faint"
                )}
              />
              {connected ? "Live" : "…"}
            </span>
          </div>
          {room.description && (
            <p className="truncate text-xs text-ink-faint">{room.description}</p>
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
            <MessagesSquare className="h-8 w-8 text-ink-faint" />
            <p className="mt-4 font-display text-sm text-ink-dim">
              Sign in to read the conversation
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" className="rounded-lg" onClick={() => openAuthModal("signin")}>
                Sign In
              </Button>
              <Button size="sm" variant="outline" className="rounded-lg border-ink-dim/20" onClick={() => openAuthModal("signup")}>
                Sign Up
              </Button>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <MessagesSquare className="h-8 w-8 text-ink-faint" />
            <p className="mt-4 font-display text-sm text-ink-dim">
              No messages yet
            </p>
            <p className="mt-1 text-xs text-ink-faint">
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
                  className="rounded-full border border-ink-dim/20 bg-surface px-4 py-2 font-mono text-[11px] text-ink-dim hover:text-ink hover:border-ink-dim/30 disabled:opacity-50 transition-colors"
                >
                  {loadingMore ? "Loading…" : "Load earlier messages"}
                </button>
              </div>
            )}
            {ordered.map((msg, i) => {
              const prev = ordered[i - 1]
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
              const username = msg.profiles?.username
              const avatar = (
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
                  <AvatarFallback className="bg-accent text-xs text-white">
                    {initials(msg.profiles?.display_name ?? "?")}
                  </AvatarFallback>
                </Avatar>
              )

              return (
                <div key={msg.id}>
                  {showDay && (
                    <div className="my-4 flex items-center justify-center">
                      <span className="rounded-full border border-ink-dim/20 bg-surface px-3 py-0.5 font-mono text-[11px] text-ink-faint">
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
                    {username ? (
                      <Link href={`/profile/${username}`} className="shrink-0">
                        {avatar}
                      </Link>
                    ) : (
                      avatar
                    )}

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
                          <span className="truncate text-sm font-medium text-ink">
                            {msg.profiles?.display_name ||
                              msg.profiles?.username ||
                              "Unknown"}
                          </span>
                          <span className="shrink-0 font-mono text-[11px] text-ink-faint">
                            {formatTime(msg.created_at)}
                          </span>
                        </div>
                      )}

                      <div className="relative flex items-end gap-2">
                        <div
                          className={cn(
                            "whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm",
                            isOwn
                              ? "bg-accent text-white"
                              : "bg-surface-muted text-ink",
                            pending && "opacity-60"
                          )}
                        >
                          {msg.content}
                        </div>
                        {grouped && (
                          <span
                            className={cn(
                              "mb-0.5 shrink-0 font-mono text-[10px] text-ink-faint opacity-0 transition-opacity group-hover:opacity-100",
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
            className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-lg transition-colors hover:bg-accent-bright"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            {unread} new message{unread > 1 ? "s" : ""}
          </button>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-ink-dim/20 bg-surface p-3">
        {error && (
          <p className="mb-2 px-1 text-xs text-accent">{error}</p>
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
              maxLength={MAX_MESSAGE_LENGTH}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${room.name}…`}
              className="max-h-40 min-h-[40px] flex-1 resize-none rounded-lg border border-ink-dim/20 bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            />
            <Button
              type="button"
              size="icon"
              onClick={handleSend}
              disabled={!newMessage.trim() || sendMutation.isPending}
              aria-label="Send message"
              className="h-10 w-10 shrink-0 rounded-lg"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-ink-dim/20 bg-surface-muted px-4 py-6 text-center sm:flex-row sm:justify-center">
            <p className="text-sm text-ink-dim">
              Sign in to join the conversation.
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" className="gap-1.5 rounded-lg" onClick={() => openAuthModal("signin")}>
                <LogIn className="h-4 w-4" />
                Sign In
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 rounded-lg border-ink-dim/20"
                onClick={() => openAuthModal("signup")}
              >
                <UserPlus className="h-4 w-4" />
                Sign Up
              </Button>
            </div>
          </div>
        )}

        {userId && (
          <p className="mt-1.5 px-1 text-[11px] text-ink-faint">
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
          <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-surface-muted" />
          <div
            className={cn(
              "h-10 animate-pulse rounded-lg bg-surface-muted",
              i % 2 === 0 ? "self-start" : "self-end"
            )}
            style={{ width: `${w}%` }}
          />
        </div>
      ))}
    </div>
  )
}
