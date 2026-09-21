"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { AtSign, Bell, CheckCheck, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface NotificationItem {
  id: string
  type: "comment_reply" | "chat_mention"
  message: string
  is_read: boolean
  created_at: string
  slug: string | null
}

interface NotificationsPayload {
  items: NotificationItem[]
  unreadCount: number
}

const POLL_INTERVAL_MS = 45_000
/**
 * Backoff state for 429 / server errors. The endpoint rate-limits per user;
 * hammering it from a setInterval only burns battery and deepens the throttle.
 * After a non-OK response we wait pollInterval * attempts (capped at 4),
 * and while the tab is hidden polling stops entirely (visibility refetch
 * catches up on return).
 */
const MAX_BACKOFF_ATTEMPTS = 4

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const diffMs = Math.max(0, Date.now() - then)
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" })
}

/**
 * In-app notification bell: unread badge + dropdown panel, fed by the
 * RLS-safe GET /api/notifications route. Polls every 45s and refetches when
 * the tab becomes visible again.
 *
 * Degrades gracefully: any poll/API error (including a 401 for a logged-out
 * visitor, or the pre-migration 500) silently keeps the previous state —
 * badge stays ≥ 0, never a crash. Renders inside the Navbar only.
 */
export function NotificationBell({
  mobile = false,
  className,
}: {
  mobile?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const failureCountRef = useRef(0)
  const backoffUntilRef = useRef(0)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" })
      if (!res.ok) {
        // 401 logged-out → keep state, reset backoff (cheap, expected).
        if (res.status === 401) {
          failureCountRef.current = 0
          return
        }
        // 429 / 5xx → back off. Honor Retry-After when the server sends it.
        failureCountRef.current = Math.min(
          failureCountRef.current + 1,
          MAX_BACKOFF_ATTEMPTS
        )
        const retryAfter = Number(res.headers.get("Retry-After"))
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, POLL_INTERVAL_MS * MAX_BACKOFF_ATTEMPTS)
            : POLL_INTERVAL_MS * failureCountRef.current
        const until = Date.now() + waitMs
        backoffUntilRef.current = Math.max(backoffUntilRef.current, until)
        return
      }
      failureCountRef.current = 0
      const json = (await res.json()) as { data?: NotificationsPayload } | null
      const data = json?.data
      if (!data) return
      setItems(data.items)
      setUnreadCount(data.unreadCount)
    } catch {
      // Network failure → back off like a server error.
      failureCountRef.current = Math.min(
        failureCountRef.current + 1,
        MAX_BACKOFF_ATTEMPTS
      )
      backoffUntilRef.current =
        Date.now() + POLL_INTERVAL_MS * failureCountRef.current
    }
  }, [])

  // Initial fetch + 45s polling + refetch on tab visibility. The interval
  // skips ticks while backing off or while the tab is hidden.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return
      if (Date.now() < backoffUntilRef.current) return
      fetchData()
    }
    tick()
    const id = setInterval(tick, POLL_INTERVAL_MS)
    const onVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() >= backoffUntilRef.current
      ) {
        fetchData()
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [fetchData])

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  const handleMarkAllRead = async () => {
    try {
      const res = await fetch("/api/notifications", { method: "POST" })
      if (!res.ok) return
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })))
      setUnreadCount(0)
    } catch {
      // Silently keep the previous state.
    }
  }

  const itemHref = (item: NotificationItem): string | null => {
    if (item.type === "comment_reply" && item.slug) return `/tracker/${item.slug}`
    if (item.type === "chat_mention") return "/community/chat"
    return null
  }

  return (
    <div ref={containerRef} className={cn("relative", mobile && "w-full", className)}>
      <Button
        type="button"
        variant="ghost"
        size={mobile ? undefined : "icon"}
        onClick={() => setOpen((o) => !o)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="true"
        className={cn("relative text-ink-faint hover:text-ink", mobile && "w-full justify-start gap-2 font-display")}
      >
        <Bell className="h-4 w-4" />
        {mobile && <span>Notifications</span>}
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className={cn(
              "inline-flex items-center justify-center rounded-full bg-accent font-mono text-[10px] font-bold text-white",
              mobile
                ? "ml-auto h-5 min-w-5 px-1"
                : "absolute -right-0.5 -top-0.5 h-4 min-w-4 px-0.5"
            )}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-ink-dim/20 bg-surface shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-ink-dim/20 px-4 py-2.5">
            <span className="font-display text-xs text-ink-dim">Notifications</span>
            {unreadCount > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={handleMarkAllRead}>
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </Button>
            )}
          </div>

          <ul className="max-h-80 divide-y divide-ink-dim/10 overflow-y-auto">
            {items.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-ink-faint">
                No notifications yet.
              </li>
            ) : (
              items.map((item) => {
                const href = itemHref(item)
                const Icon = item.type === "comment_reply" ? MessageSquare : AtSign
                const body = (
                  <>
                    <Icon
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0",
                        item.type === "comment_reply" ? "text-ink-dim" : "text-accent"
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm leading-snug", item.is_read ? "text-ink-dim" : "font-medium text-ink")}>
                        {item.message}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-ink-faint">
                        {formatRelative(item.created_at)}
                      </p>
                    </div>
                    {!item.is_read && (
                      <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                    )}
                  </>
                )
                return (
                  <li key={item.id}>
                    {href ? (
                      <Link
                        href={href}
                        role="menuitem"
                        onClick={() => setOpen(false)}
                        className="flex items-start gap-2.5 px-4 py-3 transition-colors hover:bg-surface-muted"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="flex items-start gap-2.5 px-4 py-3">{body}</div>
                    )}
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
