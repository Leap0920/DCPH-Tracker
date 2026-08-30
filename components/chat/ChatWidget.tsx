"use client"

import * as React from "react"
import { MessageSquare, X, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import { ChatInput } from "@/components/chat/ChatInput"
import { ChatMessage, type ChatMessageData } from "@/components/chat/ChatMessage"

const GREETING: ChatMessageData = {
  id: "greeting",
  role: "assistant",
  content:
    "Hi! I'm **DCPH Bot**. Ask me things like:\n- Which episode has the ski resort murder?\n- What happens in episode 219?\n- What should I watch next?",
}

const HISTORY_TURNS = 8

export function ChatWidget() {
  const [open, setOpen] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)
  const [messages, setMessages] = React.useState<ChatMessageData[]>([GREETING])
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const scrollRef = React.useRef<HTMLDivElement>(null)
  const abortRef = React.useRef<AbortController | null>(null)

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
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
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

  return (
    <>
      {/* Floating launcher */}
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

      {/* Chat panel */}
      {open && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="DCPH Bot — episode finder"
          className={cn(
            "fixed bottom-5 right-5 z-50 flex flex-col overflow-hidden rounded-2xl",
            "border border-line bg-surface shadow-2xl shadow-black/70",
            "w-[min(26rem,calc(100vw-1.5rem))] h-[min(34rem,calc(100vh-6rem))]",
            "transition-all duration-200 ease-out",
            mounted ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
          )}
        >
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-bright">
                <MessageSquare className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">DCPH Bot</p>
                <p className="truncate text-xs text-ink-faint">Detective Conan episode finder</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={reset}
                aria-label="Start a new conversation"
                className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
              >
                <RotateCcw className="size-4" />
              </button>
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

          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
            aria-live="polite"
            aria-atomic="false"
          >
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                isStreaming={isLoading && message.id === lastMessage?.id}
              />
            ))}

            {error && (
              <p className="rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-bright">
                {error}
              </p>
            )}
          </div>

          <ChatInput onSend={send} onStop={stop} disabled={isLoading} isStreaming={isLoading} />
        </div>
      )}
    </>
  )
}
