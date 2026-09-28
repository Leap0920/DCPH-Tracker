"use client"

import * as React from "react"
import {
  MessageSquare,
  X,
  RotateCcw,
  Lock,
  LogIn,
  Sparkles,
  Compass,
  BookOpen,
  Wrench,
  Film,
  Maximize2,
  Minimize2,
} from "lucide-react"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { ChatInput } from "@/components/chat/ChatInput"
import { ChatMessage, type ChatMessageData } from "@/components/chat/ChatMessage"
import { createClient } from "@/utils/supabase/client"
import { openAuthModal } from "@/lib/auth-modal"
import type { User as SupabaseUser } from "@supabase/supabase-js"

const GREETING: ChatMessageData = {
  id: "greeting",
  role: "assistant",
  content:
    "Hi! I'm **DCPH Bot**, your assistant for Detective Conan episodes, movies, characters, and tracker guides! How can I help you today?",
}

interface SuggestionChip {
  label: string
  icon: React.ElementType
  prompt: string
}

const SUGGESTION_CHIPS: SuggestionChip[] = [
  {
    label: "What should I watch next?",
    icon: Compass,
    prompt: "What should I watch next based on my tracker progress?",
  },
  {
    label: "Manga Canon Guide",
    icon: BookOpen,
    prompt: "How do I watch only Manga Canon episodes and skip filler?",
  },
  {
    label: "Agasa's Gadgets",
    icon: Wrench,
    prompt: "What are the gadgets Professor Agasa invented for Conan?",
  },
  {
    label: "Movies vs Episodes",
    icon: Film,
    prompt: "Should I watch movies or episodes first, and can I watch the latest movie early?",
  },
]

const HISTORY_TURNS = 8
const STORAGE_KEY = "dcph_chat_history_v2"
const LEGACY_STORAGE_KEY = "dcph_chat_history_v1"
/** Keeps the stored conversation bounded — this lives in the reader's browser. */
const MAX_STORED_MESSAGES = 60

function isStoredMessage(value: unknown): value is ChatMessageData {
  if (!value || typeof value !== "object") return false
  const message = value as Record<string, unknown>
  return (
    typeof message.id === "string" &&
    typeof message.content === "string" &&
    (message.role === "user" || message.role === "assistant")
  )
}

export function ChatWidget() {
  const [open, setOpen] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)
  const [messages, setMessages] = React.useState<ChatMessageData[]>([GREETING])
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [user, setUser] = React.useState<SupabaseUser | null>(null)
  const [authLoading, setAuthLoading] = React.useState(true)

  // The graph owns the whole viewport there and the launcher sat on top of the
  // dossier sheet, so /characters gets no launcher. The widget stays mounted
  // (see ChatWidgetLoader), which is what keeps a conversation alive across a
  // trip through the graph and back.
  const pathname = usePathname()
  const hideLauncher = pathname?.startsWith("/characters") ?? false

  const scrollRef = React.useRef<HTMLDivElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const expandButtonRef = React.useRef<HTMLButtonElement>(null)
  const abortRef = React.useRef<AbortController | null>(null)

  // Restore the saved conversation on mount. localStorage, not sessionStorage:
  // following a source link or reloading the page must not throw away a
  // conversation the reader was in the middle of.
  React.useEffect(() => {
    try {
      const saved =
        localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(LEGACY_STORAGE_KEY)
      if (!saved) return
      const parsed: unknown = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isStoredMessage)) {
        setMessages(parsed)
      }
    } catch {
      // storage unavailable or holds something we did not write
    }
  }, [])

  // Persist when the conversation settles. Debounced because a streaming answer
  // re-renders on every chunk, and this write is synchronous.
  React.useEffect(() => {
    if (!messages.some((message) => message.role === "user")) return
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(messages.slice(-MAX_STORED_MESSAGES))
        )
      } catch {
        // storage quota or disabled
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [messages])

  React.useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      setAuthLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // Drive the enter/exit transition without needing custom Tailwind keyframes.
  React.useEffect(() => {
    if (!open) {
      setMounted(false)
      return
    }
    const frame = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(frame)
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      // Escape leaves full screen first; pressing it again closes the chat, so a
      // reader who only wanted their panel size back is not thrown out.
      if (expanded) setExpanded(false)
      else setOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, expanded])

  // The large view sits over a long page; let it own the scrollbar while it is
  // up. Restoring the previous value matters — the widget can unmount under a
  // page that had its own overflow set.
  React.useEffect(() => {
    if (!open || !expanded) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [open, expanded])

  // Moving between sizes keeps the same DOM node (the panel is never remounted),
  // so the conversation, the draft text and the scroll position all survive.
  // Focus follows the move instead: the draft field when growing, the toggle
  // when shrinking back, so a keyboard user is never dropped on the page.
  const toggleExpanded = React.useCallback(() => {
    setExpanded((prev) => {
      const next = !prev
      requestAnimationFrame(() => {
        if (next) panelRef.current?.querySelector("textarea")?.focus()
        else expandButtonRef.current?.focus()
      })
      return next
    })
  }, [])

  React.useEffect(() => {
    if (!open) setExpanded(false)
  }, [open])

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, isLoading])

  React.useEffect(() => () => abortRef.current?.abort(), [])

  const stop = React.useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsLoading(false)
  }, [])

  const reset = React.useCallback(() => {
    stop()
    setMessages([GREETING])
    setError(null)
    try {
      localStorage.removeItem(STORAGE_KEY)
      sessionStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      // ignore
    }
  }, [stop])

  const send = React.useCallback(
    async (text: string) => {
      setError(null)

      const userMessage: ChatMessageData = {
        id: `u-${Date.now()}`,
        role: "user",
        content: text,
      }
      const assistantId = `a-${Date.now()}`

      // Snapshot history before this turn, skipping the static greeting.
      const priorHistory = messages
        .filter((m) => m.id !== "greeting" && m.content.trim())
        .slice(-HISTORY_TURNS)
        .map((m) => ({ role: m.role, content: m.content }))

      setMessages((prev) => [
        ...prev,
        userMessage,
        { id: assistantId, role: "assistant", content: "" },
      ])
      setIsLoading(true)

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const response = await fetch("/api/ai-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, history: priorHistory }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null
          throw new Error(data?.error ?? `Request failed (${response.status})`)
        }
        if (!response.body) throw new Error("No response stream received.")

        const reader = response.body.getReader()
        const decoder = new TextDecoder()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          if (!chunk) continue
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m))
          )
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          setMessages((prev) => prev.filter((m) => !(m.id === assistantId && !m.content)))
        } else {
          setError((err as Error)?.message ?? "Something went wrong.")
          setMessages((prev) => prev.filter((m) => m.id !== assistantId))
        }
      } finally {
        abortRef.current = null
        setIsLoading(false)
      }
    },
    [messages]
  )

  const lastMessage = messages[messages.length - 1]
  const isConversationFresh = messages.length <= 1

  return (
    <>
      {/* Floating launcher */}
      {!hideLauncher && (
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-label={open ? "Close DCPH Bot" : "Open DCPH Bot"}
          aria-expanded={open}
          className={cn(
            "fixed bottom-5 right-5 z-40 flex items-center justify-center rounded-full",
            "bg-accent text-white shadow-lg shadow-black/50 ring-1 ring-white/10",
            "transition-transform duration-200 hover:scale-105 hover:bg-accent-bright",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-bright focus-visible:ring-offset-2 focus-visible:ring-offset-black",
            open && "scale-90 opacity-0 pointer-events-none"
          )}
          style={{ height: "3.25rem", width: "3.25rem" }}
        >
          <MessageSquare className="size-5" />
        </button>
      )}

      {/* Full-screen backdrop. Rendered as a sibling so the panel below keeps its
          DOM identity across the size change — a wrapper would remount it and
          lose the conversation's scroll position and the draft text. */}
      {open && expanded && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Exit full screen chat"
          onClick={() => setExpanded(false)}
          className="fixed inset-0 z-40 cursor-default bg-black/70 backdrop-blur-sm"
        />
      )}

      {/* Chat panel */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal={expanded}
          aria-label="DCPH Bot — episode finder"
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden border border-line bg-surface shadow-2xl shadow-black/70",
            "transition-all duration-200 ease-out",
            expanded
              ? cn(
                  "inset-x-2 bottom-2 top-2 mx-auto rounded-2xl",
                  "w-auto max-w-5xl",
                  "sm:inset-x-4 sm:bottom-4 sm:top-4"
                )
              : cn(
                  "bottom-5 right-5 rounded-2xl",
                  "w-[min(26rem,calc(100vw-1.5rem))] h-[min(34rem,calc(100vh-6rem))]"
                ),
            mounted ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
          )}
        >
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <Image
                src="/tab-icon.png"
                alt=""
                width={32}
                height={32}
                className="size-8 shrink-0 rounded-full object-contain"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">DCPH Bot</p>
                <p className="truncate text-xs text-ink-faint">
                  {expanded
                    ? "Full screen — Esc to shrink back"
                    : "Detective Conan assistant & tracker"}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                ref={expandButtonRef}
                type="button"
                onClick={toggleExpanded}
                aria-label={expanded ? "Exit full screen chat" : "Expand chat to full screen"}
                title={expanded ? "Exit full screen (Esc)" : "Expand chat (full screen)"}
                className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
              >
                {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </button>
              {user && (
                <button
                  type="button"
                  onClick={reset}
                  aria-label="Start a new conversation"
                  title="New conversation"
                  className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
                >
                  <RotateCcw className="size-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>
          </header>

          {!authLoading && !user ? (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent/15 text-accent-bright ring-1 ring-accent/30 shadow-lg shadow-accent/10">
                <Lock className="size-7" />
              </div>
              <h3 className="font-display text-lg font-bold text-ink">Member Access Only</h3>
              <p className="mt-2 max-w-xs text-xs leading-relaxed text-ink-dim">
                DCPH Bot is exclusively available to signed-in community members. Sign in or create a free account to find episodes, explore cases, and get personalized recommendations!
              </p>
              <button
                type="button"
                onClick={() => openAuthModal("signin")}
                className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/25 transition-all hover:bg-accent-bright"
              >
                <LogIn className="size-4" />
                Sign In to Chat
              </button>
            </div>
          ) : (
            <>
              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-4 py-4"
                aria-live="polite"
                aria-atomic="false"
              >
                {/* The wrapper is always present (even when it adds nothing) so
                    that growing the panel cannot remount the messages. Full
                    screen keeps the reading column narrow instead of stretching
                    every answer across the whole viewport. */}
                <div className={cn("space-y-3", expanded && "mx-auto w-full max-w-3xl")}>
                  {messages.map((message) => (
                    <ChatMessage
                      key={message.id}
                      message={message}
                      isStreaming={isLoading && message.id === lastMessage?.id}
                    />
                  ))}

                  {isConversationFresh && !isLoading && (
                    <div className="mt-4 pt-1">
                      <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-medium text-ink-faint">
                        <Sparkles className="size-3 text-accent-bright" />
                        <span>Suggested questions:</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {SUGGESTION_CHIPS.map((chip, idx) => {
                          const Icon = chip.icon
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => send(chip.prompt)}
                              className="group inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-muted px-3 py-1.5 text-xs text-ink transition-all hover:border-accent/50 hover:bg-accent/10 hover:text-accent-bright text-left"
                            >
                              <Icon className="size-3.5 text-accent-bright shrink-0 transition-transform group-hover:scale-110" />
                              <span>{chip.label}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {error && (
                    <p className="rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
                      {error}
                    </p>
                  )}
                </div>
              </div>

              <div className={cn(expanded && "mx-auto w-full max-w-3xl")}>
                <ChatInput onSend={send} onStop={stop} disabled={isLoading} isStreaming={isLoading} />
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
