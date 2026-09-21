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
  Pencil,
  RefreshCw,
  History,
  Brain,
} from "lucide-react"
import type { ChatTransport, UIMessage } from "ai"
import { cn } from "@/lib/utils"
import { ChatInput } from "@/components/chat/ChatInput"
import { ChatMessage, TypingDots } from "@/components/chat/ChatMessage"
import {
  useChatStream,
  transcriptToUIMessages,
  type ChatMessageView,
} from "@/components/chat/useChatStream"
import {
  ConversationDrawer,
  type TranscriptMessage,
} from "@/components/chat/ConversationDrawer"
import { MemoryPanel } from "@/components/chat/MemoryPanel"
import { createClient } from "@/utils/supabase/client"
import { openAuthModal } from "@/lib/auth-modal"
import { useCharacterChromeHidden } from "@/lib/character-chrome"
import type { User as SupabaseUser } from "@supabase/supabase-js"

/**
 * The floating chat widget: launcher, panel, header, gate, transcript, composer.
 *
 * The transcript belongs to `useChatStream`, not to this component. The widget
 * used to hand-roll the wire — its own `fetch`, its own `ReadableStream` reader,
 * its own `ChatMessageData[]` — and that whole path is gone: the hook owns the
 * request shape, the conversation id, the parts→view mapping and the `stopped`
 * state the SDK's own status cannot express. What is left here is presentation
 * plus the two turn controls the parts path does not carry (edit, regenerate).
 *
 * The conversation drawer is the one way a stored transcript re-enters the hook:
 * it hands its loaded rows to `loadConversation`, which replaces what is on
 * screen rather than appending to it. The drawer's `open` state lives here, next
 * to the panel's Escape handler, because Escape must reach only one of them.
 *
 * The memory panel is the second overlay and follows the same shape: it is
 * prop-driven, its `open` state is owned here, and it renders as a sibling of the
 * transcript rather than inside it. Both overlays are Radix dialogs, so Escape is
 * theirs while either is open — hence `overlayOpen` below rather than a flag per
 * overlay.
 *
 * Nothing in this file knows a provider, a key or a route: the only address in
 * the client path is the hook's `/api/ai-chat`.
 */

/**
 * The intro line, as static markup rather than a turn.
 *
 * The transcript is server-owned and addressed by `conversationId`, so anything
 * inside `messages` is history the route is told about and, once the server keeps
 * a transcript, text it writes into the conversation. A greeting is neither, so
 * it is rendered above the list and never enters the hook's state — which is also
 * why "the conversation is fresh" is now `messages.length === 0` and not "the
 * only message is the greeting".
 */
function Greeting() {
  return (
    <div className="flex w-full flex-col items-start">
      <div className="max-w-[88%] rounded-2xl border border-line bg-surface-muted px-3.5 py-2.5 text-sm leading-relaxed break-words text-ink rounded-bl-md">
        <p className="my-1 first:mt-0 last:mb-0">
          Hi! I&apos;m <strong className="font-semibold text-ink">DCPH Bot</strong>, your assistant
          for Detective Conan episodes, movies, characters, and tracker guides! How can I help you
          today?
        </p>
      </div>
    </div>
  )
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

export interface ChatWidgetProps {
  /**
   * Test seam: replaces the hook's transport. Production callers — the root
   * layout's `ChatWidgetLoader` — pass nothing and talk to `/api/ai-chat`.
   */
  transport?: ChatTransport<UIMessage>
}

export function ChatWidget({ transport }: ChatWidgetProps = {}) {
  const [open, setOpen] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)
  const [user, setUser] = React.useState<SupabaseUser | null>(null)
  const [authLoading, setAuthLoading] = React.useState(true)
  // "Start a new conversation" has no hook API to clear a transcript, and the
  // hook owns it: remounting the session is the reset. The conversation id goes
  // with it, so the next turn opens a new server conversation rather than
  // appending to the one just abandoned.
  const [sessionKey, setSessionKey] = React.useState(0)
  // The drawer is opened by a header control and owned here, because the panel's
  // Escape handler is here and the two must not fight: while the drawer is open
  // Escape belongs to the drawer.
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  // The memory panel is the second overlay and is owned here for the same
  // reason: it is opened by a header control, and Escape must reach only one of
  // the two dialogs at a time.
  const [memoryOpen, setMemoryOpen] = React.useState(false)
  // Every overlay the widget can put over the panel, derived rather than kept as
  // its own boolean: a third overlay only has to join this expression, so it
  // cannot silently reintroduce the Escape bug by forgetting a fresh flag.
  const overlayOpen = drawerOpen || memoryOpen
  // Escape closes the panel, but not while an answer is arriving: there it is
  // the reader's stop control, and closing would take the partial answer off
  // screen at the moment it was asked to stop. The flag lives in a ref because
  // the session below is the only thing that knows it, and the panel must not
  // re-render every time the stream changes state.
  const streamingRef = React.useRef(false)
  const setStreaming = React.useCallback((streaming: boolean) => {
    streamingRef.current = streaming
  }, [])

  // Mobile /characters: while a character dossier sheet is open the global
  // chat chrome is hidden via CSS — the widget stays mounted, so open state,
  // transcript and auth survive hide/show.
  const chromeHidden = useCharacterChromeHidden()

  // The `dcph_chat_history_v1` sessionStorage cache was read and written here. It
  // is gone: `useChatStream` owns the transcript and the server now stores it, so
  // a client copy would be a second source of truth that can disagree with the
  // server after an edit, a regenerate or a stop. Reopening the widget starts a
  // new conversation (or reopens one through the drawer, a later task) instead of
  // restoring a local echo of the last one.

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
      // The drawer and the memory panel are portals over the panel: closing the
      // panel must take them with it, or they would hang over a panel that is no
      // longer there.
      setDrawerOpen(false)
      setMemoryOpen(false)
      return
    }
    const frame = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(frame)
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      // The drawer and the memory panel are Radix dialogs and handle Escape
      // themselves, but their dismiss calls `preventDefault()` and not
      // `stopPropagation()`, so this window listener would otherwise close the
      // panel underneath them. While any overlay is open, Escape is the
      // overlay's alone.
      if (event.key === "Escape" && !streamingRef.current && !overlayOpen) setOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, overlayOpen])

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
          open && "scale-90 opacity-0 pointer-events-none",
          chromeHidden && "hidden"
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
            // `dvh` is the dynamic viewport height, so the panel's height tracks
            // the visible area when the on-screen keyboard shrinks it — the same
            // job `interactiveWidget: "resizes-content"` does in app/layout.tsx,
            // but not dependent on a browser honouring the meta tag. `bottom-5`
            // keeps the composer's edge anchored to the visible bottom.
            "w-[min(26rem,calc(100vw-1.5rem))] h-[min(34rem,calc(100dvh-6rem))]",
            "transition-all duration-200 ease-out",
            mounted ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
            chromeHidden && "hidden"
          )}
        >
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-bright">
                <MessageSquare className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">DCPH Bot</p>
                <p className="truncate text-xs text-ink-faint">Detective Conan assistant & tracker</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {user && (
                <>
                  {/* The drawer's own opener: Radix restores focus only to a
                      `DialogTrigger`, and the drawer captures and restores
                      whatever opened it, so this real button is the control
                      that focus comes back to. */}
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    aria-label="Your conversations"
                    title="Your conversations"
                    className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
                  >
                    <History className="size-4" />
                  </button>
                  {/* The memory panel's own opener, for the same reason as the
                      drawer's: the panel is a Radix dialog opened by a control
                      outside it, so this real button is what focus returns to. */}
                  <button
                    type="button"
                    onClick={() => setMemoryOpen(true)}
                    aria-label="What the bot remembers"
                    title="What the bot remembers"
                    className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
                  >
                    <Brain className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSessionKey((key) => key + 1)}
                    aria-label="Start a new conversation"
                    title="New conversation"
                    className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
                  >
                    <RotateCcw className="size-4" />
                  </button>
                </>
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
            // Remounting on `sessionKey` is the only reset the hook offers: it
            // owns the transcript, so a new conversation is a new hook.
            <ChatSession
              key={sessionKey}
              transport={transport}
              onStreamingChange={setStreaming}
              drawerOpen={drawerOpen}
              onDrawerOpenChange={setDrawerOpen}
              memoryOpen={memoryOpen}
              onMemoryOpenChange={setMemoryOpen}
            />
          )}
        </div>
      )}
    </>
  )
}

/**
 * One conversation, as the hook holds it: the transcript, the composer and the
 * two turn controls (regenerate, edit) that the message parts path cannot carry.
 *
 * Split from the widget so "start a new conversation" can remount it, which is
 * what clears a transcript the hook owns.
 */
function ChatSession({
  transport,
  onStreamingChange,
  drawerOpen,
  onDrawerOpenChange,
  memoryOpen,
  onMemoryOpenChange,
}: {
  transport?: ChatTransport<UIMessage>
  /** Tells the panel whether Escape means "stop" or "close" right now. */
  onStreamingChange: (streaming: boolean) => void
  /** Owned by the widget, because the panel's Escape handler lives there too. */
  drawerOpen: boolean
  onDrawerOpenChange: (open: boolean) => void
  /** The second overlay, owned by the widget for the same reason as the drawer. */
  memoryOpen: boolean
  onMemoryOpenChange: (open: boolean) => void
}) {
  const {
    messages,
    status,
    error,
    conversationId,
    send,
    stop,
    regenerate,
    editAndResend,
    loadConversation,
  } = useChatStream({ transport })

  /**
   * The drawer loads a stored transcript and hands it back whole; loading it is
   * a replacement, never an append — the hook's `loadConversation` swaps the
   * messages and adopts the id the transcript belongs to, so the next turn
   * continues that conversation rather than forking a new one.
   */
  const openConversation = React.useCallback(
    (loaded: { id: string; title: string | null; messages: TranscriptMessage[] }) => {
      loadConversation(loaded.id, transcriptToUIMessages(loaded.messages))
      onDrawerOpenChange(false)
    },
    [loadConversation, onDrawerOpenChange]
  )

  const scrollRef = React.useRef<HTMLDivElement>(null)

  const isStreaming = status === "streaming"
  // The greeting is chrome now, so freshness is simply "no turns yet".
  const isFresh = messages.length === 0
  const last = messages[messages.length - 1]
  // The SDK only pushes the assistant message when the stream's first part
  // arrives, so between the request and that part the transcript holds the
  // reader's turn alone. This stand-in is what makes the answer visible as
  // pending from the moment the turn is sent rather than from the first delta.
  const awaitingFirstPart = isStreaming && last?.role !== "assistant"
  // Regenerate replaces the last assistant turn, so it is offered once that turn
  // exists and has stopped moving — which includes the stopped-after-partial
  // case, where the partial is exactly what the reader wants to redo.
  const canRegenerate = !isStreaming && last?.role === "assistant"

  React.useEffect(() => {
    onStreamingChange(isStreaming)
  }, [isStreaming, onStreamingChange])

  // The composer's own Escape handler only fires while the box has focus, which
  // it does not when the turn was sent from a suggestion chip — so the stop is
  // also armed here, on the window. `stop` is idempotent, so the two firing
  // together for a focused composer is harmless.
  React.useEffect(() => {
    if (!isStreaming) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") stop()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isStreaming, stop])

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, status])

  return (
    <>
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
        // The live-region contract: while a turn is streaming the container is
        // `polite`, so the answer is announced as it arrives; once the turn
        // settles it is a `log` with announcements off, so a screen reader does
        // not re-read the whole transcript token by token. `aria-atomic="false"`
        // keeps an announcement to the changed node rather than the whole list.
        aria-live={isStreaming ? "polite" : "off"}
        role={isStreaming ? undefined : "log"}
        aria-atomic="false"
      >
        <Greeting />

        {messages.map((message) =>
          message.role === "user" ? (
            <UserTurn key={message.id} view={message} onEdit={editAndResend} />
          ) : (
            <ChatMessage key={message.id} view={message} />
          )
        )}

        {awaitingFirstPart && (
          <div className="flex w-full flex-col items-start">
            <div className="max-w-[88%] rounded-2xl border border-line bg-surface-muted px-3.5 py-2.5 text-sm leading-relaxed break-words text-ink rounded-bl-md">
              <TypingDots />
            </div>
          </div>
        )}

        {canRegenerate && (
          <div className="flex justify-start">
            <button
              type="button"
              onClick={() => void regenerate()}
              aria-label="Regenerate answer"
              title="Regenerate answer"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
            >
              <RefreshCw className="size-3" />
              <span>Regenerate</span>
            </button>
          </div>
        )}

        {isFresh && (
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
                    onClick={() => void send(chip.prompt)}
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

      <ChatInput onSend={send} onStop={stop} disabled={isStreaming} isStreaming={isStreaming} />

      {/* A sibling of the scroll container and the composer, not a child of
          either: the drawer is a portal over the panel, and nesting it in the
          transcript would put it inside the region that scrolls. */}
      <ConversationDrawer
        open={drawerOpen}
        onOpenChange={onDrawerOpenChange}
        activeConversationId={conversationId}
        onSelect={openConversation}
      />

      {/* The memory panel is the second overlay and follows the same rule: a
          sibling of the transcript and the composer, never inside the region
          that scrolls. */}
      <MemoryPanel open={memoryOpen} onOpenChange={onMemoryOpenChange} />
    </>
  )
}

/**
 * A reader's turn, plus the one control its parts path does not carry: edit.
 *
 * Editing lives here because the hook's `editAndResend` needs this turn's id,
 * and a `ChatMessageView` is a render input with no room for an action. Saving
 * truncates the transcript at this turn and resends it (D7): the client sends
 * the edited text and the conversation id, and the server rewrites its own
 * transcript through the normal write path — no client-supplied history.
 */
function UserTurn({
  view,
  onEdit,
}: {
  view: ChatMessageView
  onEdit: (messageId: string, text: string) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(view.text)

  if (!editing) {
    return (
      <div className="group/turn flex w-full flex-col items-end">
        <ChatMessage view={view} />
        <div className="mt-1 flex items-center gap-1 pr-1 opacity-0 transition-opacity group-hover/turn:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={() => {
              setDraft(view.text)
              setEditing(true)
            }}
            aria-label="Edit message"
            title="Edit and resend"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <Pencil className="size-3" />
            <span>Edit</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <form
      className="flex w-full flex-col items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        const text = draft.trim()
        if (!text) return
        setEditing(false)
        onEdit(view.id, text)
      }}
    >
      <label htmlFor={`edit-${view.id}`} className="sr-only">
        Edit your message
      </label>
      <textarea
        id={`edit-${view.id}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={2}
        className="w-full resize-none rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-lg px-2.5 py-1 text-xs text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!draft.trim()}
          className="rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-accent-bright disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </form>
  )
}
