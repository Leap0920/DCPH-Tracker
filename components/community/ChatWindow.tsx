"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { Send, Menu, ArrowDown, LogIn, UserPlus, MessagesSquare, Trash2 } from "lucide-react"
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
import { MAX_MESSAGE_LENGTH, CHAT_RETENTION_HOURS } from "@/lib/chat-constants"
import { redactForbiddenWords } from "@/lib/profanity"
import { mergeChatMessages } from "@/lib/chat-merge"
import type { Database } from "@/types/database.types"

type ChatRoom = Database["public"]["Tables"]["chat_rooms"]["Row"]
type Profile = { username: string; display_name: string; avatar_url: string | null }

const GROUP_GAP_MS = 5 * 60 * 1000

/**
 * Poll cadence for the messages query.
 *
 * Realtime is the primary transport; polling is the safety net for when it is
 * not working at all — table missing from the `supabase_realtime` publication,
 * websocket blocked by a school/office network, or a socket still authenticated
 * as `anon` so RLS filters every event away. Two rates:
 *
 *   LIVE     — realtime reported SUBSCRIBED. A slow poll only backfills events
 *              that realtime dropped (it has a per-second cap and no redelivery).
 *   FALLBACK — realtime is down. Fast enough that chat still feels live.
 *
 * react-query pauses interval refetches while the tab is unfocused
 * (refetchIntervalInBackground defaults to false), so a backgrounded tab costs
 * nothing and there is no thundering refetch on return.
 */
const POLL_LIVE_MS = 30_000
const POLL_FALLBACK_MS = 6_000

/** Channel resubscribe backoff: 1s, 2s, 4s … capped at 30s. */
const RESUBSCRIBE_BASE_MS = 1_000
const RESUBSCRIBE_MAX_MS = 30_000

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
  // Bumped to force a fresh realtime channel after a CHANNEL_ERROR/TIMED_OUT.
  const [realtimeEpoch, setRealtimeEpoch] = useState(0)
  const [unread, setUnread] = useState(0)
  // Two-tap confirm for unsend: which message is currently armed.
  const [confirmUnsendId, setConfirmUnsendId] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const atBottomRef = useRef(true)
  const initialLoadRef = useRef(true)
  const initialSyncRef = useRef(false)
  // Arrival detection for the scroll/unread effect. `messages` also changes on
  // unsend and on "load earlier", and neither is an arrival.
  const prevCountRef = useRef(0)
  const prevTopIdRef = useRef<string | null>(null)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resubscribeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resubscribeAttemptsRef = useRef(0)
  /**
   * Ids this client has deleted, or seen deleted over realtime. Tombstones, so
   * a poll that races the DELETE request cannot resurrect the bubble.
   */
  const removedIdsRef = useRef<Set<string>>(new Set())
  /** `me` mirrored into a ref — see the sync effect below. */
  const meRef = useRef<Profile | null>(null)

  /**
   * BOTH of these must be referentially stable: they are dependencies of the
   * realtime effect, and `createClient()` / `queryKeys.chat.messages()` each
   * hand back a FRESH object on every call. Without the memos, that effect tore
   * the channel down and resubscribed on every render — every keystroke in the
   * composer included — and a channel removed ~100ms after .subscribe() never
   * reaches SUBSCRIBED. That is why other people's messages only showed up
   * after a reload.
   */
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()

  // Cache is newest-first (matches the fetch); rendering reverses to chronological.
  const messagesKey = useMemo(() => queryKeys.chat.messages(room.id), [room.id])

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

  // Mirror `me` into a ref so the realtime effect can read the current profile
  // without listing it as a dependency — a dep would tear the channel down the
  // moment the profile finishes loading.
  useEffect(() => {
    meRef.current = me
  }, [me])

  // ── Messages query (latest page, newest first; merged, never clobbering) ──
  const loadLatest = useCallback(async (): Promise<ChatMessage[]> => {
    const latest = await fetchChatMessages(room.id)
    const previous = queryClient.getQueryData<ChatMessage[]>(messagesKey) ?? []
    // Merge rather than replace: keeps in-flight optimistic sends and
    // "Load earlier" pages, and honours unsend tombstones. See lib/chat-merge.
    return mergeChatMessages(previous, latest, removedIdsRef.current)
  }, [room.id, queryClient, messagesKey])

  const messagesQuery = useQuery({
    queryKey: messagesKey,
    queryFn: loadLatest,
    enabled: !!userId,
    // Fallback transport when realtime is down, safety net when it is up.
    refetchInterval: connected ? POLL_LIVE_MS : POLL_FALLBACK_MS,
    refetchIntervalInBackground: false,
  })
  const messages = messagesQuery.data ?? []
  const loading = !!userId && messagesQuery.isLoading
  // Chronological order for rendering (cache is newest-first), with forbidden
  // words masked. The server already redacts on insert, so this is for rows
  // written before the filter existed — and it is idempotent, so re-masking an
  // already-clean row is a no-op. Unchanged rows keep their object identity.
  const ordered = useMemo(
    () =>
      [...messages].reverse().map((m) => {
        const clean = redactForbiddenWords(m.content)
        return clean === m.content ? m : { ...m, content: clean }
      }),
    [messages]
  )

  // Sync `hasMore` from the initial page size exactly once.
  useEffect(() => {
    if (!initialSyncRef.current && messagesQuery.data) {
      initialSyncRef.current = true
      setHasMore(messagesQuery.data.length >= CHAT_PAGE_SIZE)
    }
  }, [messagesQuery.data])

  // Only surface a load error when there is nothing on screen. Once messages
  // are rendered, a failed poll is transient — the next tick retries — and a
  // sticky "refresh" banner would be pure noise.
  useEffect(() => {
    if (messagesQuery.isError && messages.length === 0) {
      setError("Couldn't load messages. Check your connection and refresh.")
    }
  }, [messagesQuery.isError, messages.length])

  // ── Realtime (primary transport; the poll above is the fallback) ──
  useEffect(() => {
    if (!userId) return

    let disposed = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    const scheduleResubscribe = () => {
      if (disposed || resubscribeTimerRef.current) return
      const attempt = resubscribeAttemptsRef.current
      resubscribeAttemptsRef.current = attempt + 1
      const delay = Math.min(
        RESUBSCRIBE_BASE_MS * 2 ** attempt,
        RESUBSCRIBE_MAX_MS
      )
      // supabase-js reconnects the SOCKET on its own, but a channel rejected at
      // the postgres_changes/RLS level stays dead forever. Rebuild it.
      resubscribeTimerRef.current = setTimeout(() => {
        resubscribeTimerRef.current = null
        setRealtimeEpoch((e) => e + 1)
      }, delay)
    }

    const applyIncoming = (incoming: ChatMessage) => {
      if (removedIdsRef.current.has(incoming.id)) return
      queryClient.setQueryData<ChatMessage[]>(messagesKey, (old) =>
        old
          ? mergeChatMessages(old, [incoming], removedIdsRef.current)
          : [incoming]
      )
    }

    void (async () => {
      // Point the socket at the CURRENT access token before subscribing.
      // postgres_changes are filtered by RLS using the socket's JWT: a socket
      // still holding the anon key evaluates as `auth.role() = 'anon'`, fails
      // the "Authenticated users can read chat messages" policy, and receives
      // nothing whatsoever — indistinguishable from a broken subscription.
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (token) {
          // setAuth returns void in older supabase-js, a Promise in newer.
          const result: unknown = supabase.realtime.setAuth(token)
          if (result instanceof Promise) await result
        }
      } catch {
        // Non-fatal: let the subscribe attempt report the real problem.
      }
      if (disposed) return

      channel = supabase
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
            const row = payload.new as Partial<ChatMessage> | null
            if (!row?.id) return
            // Refetch to pick up the author profile the payload cannot carry.
            const hydrated = await fetchChatMessageById(row.id)
            if (disposed) return
            if (hydrated) {
              applyIncoming(hydrated)
              return
            }
            // Hydration can legitimately return null: replica lag, a transient
            // network blip, or RLS. Render the payload row itself rather than
            // dropping the message on the floor; the next poll fills in the
            // profile, and mergeChatMessages replaces this row when it does.
            if (!row.room_id || !row.user_id || !row.created_at) return
            applyIncoming({
              id: row.id,
              room_id: row.room_id,
              user_id: row.user_id,
              content: row.content ?? "",
              created_at: row.created_at,
              profiles: row.user_id === userId ? meRef.current : null,
            })
          }
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "chat_messages" },
          (payload) => {
            // No `filter` here, deliberately: under the default REPLICA IDENTITY
            // a DELETE payload's `old` record carries ONLY the primary key, so a
            // room_id filter can never match and the event would be dropped. We
            // match ids against our own cache instead. This also absorbs the
            // scheduled 12-hour purge, which deletes rows in batches.
            const deletedId = (payload.old as { id?: string } | null)?.id
            if (!deletedId) return
            removedIdsRef.current.add(deletedId)
            queryClient.setQueryData<ChatMessage[]>(messagesKey, (old) =>
              old ? old.filter((m) => m.id !== deletedId) : old
            )
          }
        )
        .subscribe((status) => {
          if (disposed) return
          if (status === "SUBSCRIBED") {
            resubscribeAttemptsRef.current = 0
            setConnected(true)
            // Close the gap between the last poll and the socket coming up.
            void queryClient.invalidateQueries({ queryKey: messagesKey })
            return
          }
          if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            setConnected(false)
            scheduleResubscribe()
          }
        })
    })()

    return () => {
      disposed = true
      if (resubscribeTimerRef.current) {
        clearTimeout(resubscribeTimerRef.current)
        resubscribeTimerRef.current = null
      }
      if (channel) supabase.removeChannel(channel)
    }
  }, [room.id, userId, supabase, queryClient, messagesKey, realtimeEpoch])

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

  // ── Unsend mutation (delete for everyone; optimistic removal) ──
  const unsendMutation = useMutation({
    mutationFn: async ({ messageId }: { messageId: string }) => {
      const res = await fetch(
        `/api/chat?messageId=${encodeURIComponent(messageId)}`,
        { method: "DELETE" }
      )
      const json = (await res.json().catch(() => null)) as
        | { success: true; data: { id: string } }
        | { error?: string }
        | null
      if (!res.ok || !json || !("success" in json)) {
        const detail =
          json && "error" in json && typeof json.error === "string"
            ? json.error
            : "Failed to unsend message"
        throw new Error(detail)
      }
      return json.data
    },
    onMutate: async ({ messageId }) => {
      await queryClient.cancelQueries({ queryKey: messagesKey })
      const current = queryClient.getQueryData<ChatMessage[]>(messagesKey) ?? []
      const removed = current.find((m) => m.id === messageId) ?? null
      // Tombstone FIRST: a poll or refetch that lands before the DELETE
      // completes would otherwise merge the row straight back in.
      removedIdsRef.current.add(messageId)
      queryClient.setQueryData<ChatMessage[]>(messagesKey, (old) =>
        old ? old.filter((m) => m.id !== messageId) : old
      )
      return { removed }
    },
    onError: (_err, { messageId }, ctx) => {
      // Lift the tombstone before restoring, or the merge would drop it again.
      removedIdsRef.current.delete(messageId)
      const removed = ctx?.removed
      if (removed) {
        // Re-insert by timestamp rather than restoring a whole snapshot: other
        // messages may have arrived over realtime while the request was in
        // flight, and a snapshot restore would wipe them. Cache is newest-first.
        queryClient.setQueryData<ChatMessage[]>(messagesKey, (old) => {
          if (!old) return [removed]
          if (old.some((m) => m.id === removed.id)) return old
          const next = [...old]
          const at = next.findIndex((m) => m.created_at <= removed.created_at)
          if (at === -1) next.push(removed)
          else next.splice(at, 0, removed)
          return next
        })
      }
      setError("Couldn't unsend that message. Try again.")
    },
    onSuccess: () => {
      // The realtime DELETE echo is a no-op: the row is already gone from cache.
      setError(null)
    },
  })

  const unsendingId = unsendMutation.isPending
    ? unsendMutation.variables?.messageId ?? null
    : null

  const armUnsend = useCallback((messageId: string) => {
    setConfirmUnsendId(messageId)
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    // Auto-disarm: an armed destructive control should not linger.
    confirmTimerRef.current = setTimeout(() => setConfirmUnsendId(null), 4000)
  }, [])

  const handleUnsend = useCallback(
    (messageId: string) => {
      // Optimistic messages have no row to delete and no real id yet.
      if (messageId.startsWith("temp-") || unsendMutation.isPending) return
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
      setConfirmUnsendId(null)
      unsendMutation.mutate({ messageId })
    },
    [unsendMutation]
  )

  useEffect(
    () => () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    },
    []
  )

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
  //
  // Only ARRIVALS count. `messages` also changes when a message is unsent
  // (count drops) and when older pages are prepended to the tail (newest id
  // unchanged); treating either as an arrival would falsely bump the pill.
  useEffect(() => {
    const count = messages.length
    const topId = messages[0]?.id ?? null
    const prevCount = prevCountRef.current
    const prevTopId = prevTopIdRef.current
    prevCountRef.current = count
    prevTopIdRef.current = topId

    if (initialLoadRef.current) {
      initialLoadRef.current = false
      return
    }
    if (count <= prevCount || topId === prevTopId) return

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
    // Redact client-side too: the optimistic message must match the row the
    // server will store, otherwise the sender sees their own uncensored text
    // for one round-trip. The server pass remains authoritative.
    const content = redactForbiddenWords(newMessage.trim())
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
              {/* "Sync" is honest: when the socket is down, the poll fallback
                  is still delivering messages, just a few seconds slower. */}
              {connected ? "Live" : "Sync"}
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
            {/* Retention notice — pinned to the top of the history so it is
                seen before any message, unlike the composer footnote. */}
            <p className="pb-2 pt-1 text-center font-mono text-[11px] text-ink-faint">
              Messages automatically disappear after{" "}
              {CHAT_RETENTION_HOURS} hours
            </p>
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
                        {isOwn && !pending && (
                          <button
                            type="button"
                            onClick={() =>
                              confirmUnsendId === msg.id
                                ? handleUnsend(msg.id)
                                : armUnsend(msg.id)
                            }
                            disabled={unsendingId === msg.id}
                            aria-label={
                              confirmUnsendId === msg.id
                                ? "Confirm unsend for everyone"
                                : "Unsend message"
                            }
                            title="Unsend for everyone"
                            className={cn(
                              "order-first mb-0.5 shrink-0 rounded-md transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60",
                              confirmUnsendId === msg.id
                                ? // Armed: stays visible, no hover games.
                                  "px-1.5 py-0.5 font-mono text-[10px] text-accent hover:text-accent-bright"
                                : // Idle: hover affordance on pointer devices,
                                  // always visible below md where there is no hover.
                                  "p-1 text-ink-faint opacity-100 hover:text-accent focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                            )}
                          >
                            {confirmUnsendId === msg.id ? (
                              unsendingId === msg.id ? (
                                "…"
                              ) : (
                                "Unsend?"
                              )
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                        <div
                          className={cn(
                            "whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm",
                            isOwn
                              ? "bg-accent text-white"
                              : "bg-surface-muted text-ink",
                            (pending || unsendingId === msg.id) && "opacity-60"
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
            <kbd className="font-mono">Shift + Enter</kbd> for a new line ·
            messages clear after {CHAT_RETENTION_HOURS}h
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
