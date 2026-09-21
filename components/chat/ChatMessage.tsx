"use client"

import * as React from "react"
import { Copy, Check, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import { badgeVariants } from "@/components/ui/badge"
import { SYNTHETIC_STATE_REASONS } from "@/lib/ai/stream/protocol"
import { ActivityTrace, degradeWording } from "@/components/chat/ActivityTrace"
import { CitationChips } from "@/components/chat/CitationChips"
import { FeedbackControls } from "@/components/chat/FeedbackControls"
import { SourcesPanel } from "@/components/chat/SourcesPanel"
import type { ChatMessageView } from "@/components/chat/useChatStream"

export interface ChatMessageData {
  id: string
  role: "user" | "assistant"
  content: string
}

/** The bubble's shared chrome, so the legacy and parts paths cannot drift. */
const BUBBLE_BASE =
  "max-w-[88%] rounded-2xl border px-3.5 py-2.5 text-sm leading-relaxed break-words"
const BUBBLE_USER = "border-accent/30 bg-accent/15 text-ink rounded-br-md"
const BUBBLE_ASSISTANT = "border-line bg-surface-muted text-ink rounded-bl-md"

/**
 * The synthetic tokens, as a set. `degraded` carries them (C14) and the trace
 * badges every reason it is given, so the parts path filters them out before
 * handing the trace its list — the D5 badge below says the state once (C24).
 */
const SYNTHETIC_REASONS = new Set<string>(SYNTHETIC_STATE_REASONS)

/**
 * Only http(s) is linkified. Anything else — `javascript:`, `data:` — is
 * rendered as plain text, because the bot echoes model output verbatim.
 */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" || parsed.protocol === "http:"
  } catch {
    return false
  }
}

/** Trims sentence punctuation that clings to the end of a bare URL. */
function trimUrl(url: string): { href: string; trailing: string } {
  const match = url.match(/[.,;:!?)\]}'"]+$/)
  if (!match) return { href: url, trailing: "" }
  return { href: url.slice(0, -match[0].length), trailing: match[0] }
}

function isTrackerUrl(url: string): boolean {
  return (
    url.includes("/tracker/") ||
    url.includes("/cases") ||
    url.includes("/arcs") ||
    url.includes("dcphtracker.vercel.app")
  )
}

const INLINE_PATTERN =
  /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\((?:https?:\/\/)[^)\s]+\)|https?:\/\/[^\s<>()]+)/g

/** Renders `**bold**`, `` `code` `` and links without dangerouslySetInnerHTML. */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(INLINE_PATTERN)

  return parts.filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`

    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={key} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      )
    }

    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={key}
          className="rounded border border-line bg-surface px-1 py-0.5 font-mono text-[0.8em] text-ink-dim"
        >
          {part.slice(1, -1)}
        </code>
      )
    }

    // Markdown link: [label](url)
    const mdLink = part.match(/^\[([^\]\n]+)\]\(((?:https?:\/\/)[^)\s]+)\)$/)
    if (mdLink) {
      const label = mdLink[1]!
      const href = mdLink[2]!
      if (!isSafeUrl(href)) return <React.Fragment key={key}>{part}</React.Fragment>
      const isInternal = isTrackerUrl(href)
      return (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "inline-flex items-center gap-1 break-all font-medium transition-colors",
            isInternal
              ? "rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-xs text-accent-bright hover:bg-accent/20 hover:text-white"
              : "text-accent-bright underline underline-offset-2 hover:text-accent"
          )}
        >
          <span>{label}</span>
          <ExternalLink className="inline size-3 shrink-0 opacity-70" />
        </a>
      )
    }

    // Bare URL.
    if (/^https?:\/\//i.test(part)) {
      const { href, trailing } = trimUrl(part)
      if (!isSafeUrl(href)) return <React.Fragment key={key}>{part}</React.Fragment>
      const isInternal = isTrackerUrl(href)
      return (
        <React.Fragment key={key}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex items-center gap-1 break-all font-medium transition-colors",
              isInternal
                ? "rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-xs text-accent-bright hover:bg-accent/20 hover:text-white"
                : "text-accent-bright underline underline-offset-2 hover:text-accent"
            )}
          >
            <span>{href}</span>
            <ExternalLink className="inline size-3 shrink-0 opacity-70" />
          </a>
          {trailing}
        </React.Fragment>
      )
    }

    return <React.Fragment key={key}>{part}</React.Fragment>
  })
}

function renderContent(content: string): React.ReactNode {
  const lines = content.split("\n")
  const blocks: React.ReactNode[] = []
  let bullets: string[] = []

  const flushBullets = () => {
    if (bullets.length === 0) return
    const items = bullets
    bullets = []
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="my-1.5 space-y-1 pl-1">
        {items.map((item, index) => (
          <li key={index} className="flex gap-2">
            <span aria-hidden className="mt-[0.45em] size-1 shrink-0 rounded-full bg-accent-bright" />
            <span className="min-w-0">{renderInline(item, `li-${blocks.length}-${index}`)}</span>
          </li>
        ))}
      </ul>
    )
  }

  lines.forEach((rawLine, lineIndex) => {
    const line = rawLine.trimEnd()
    const bulletMatch = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/)

    if (bulletMatch) {
      bullets.push(bulletMatch[1] ?? "")
      return
    }

    flushBullets()

    if (!line.trim()) return

    blocks.push(
      <p key={`p-${lineIndex}`} className="my-1 first:mt-0 last:mb-0">
        {renderInline(line, `p-${lineIndex}`)}
      </p>
    )
  })

  flushBullets()
  return blocks
}

export function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-1" aria-label="DCPH Bot is typing">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1.5 animate-bounce rounded-full bg-ink-faint"
          style={{ animationDelay: `${delay}ms`, animationDuration: "1s" }}
        />
      ))}
    </span>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard write failed
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy response"}
      title={copied ? "Copied to clipboard!" : "Copy message"}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-faint transition-colors hover:bg-surface hover:text-ink"
    >
      {copied ? (
        <>
          <Check className="size-3 text-green-400" />
          <span className="text-green-400">Copied</span>
        </>
      ) : (
        <>
          <Copy className="size-3" />
          <span>Copy</span>
        </>
      )}
    </button>
  )
}

/**
 * The v1 caller's shape: a plain `{ id, role, content }` message. `ChatWidget`
 * passes this today, and it must keep rendering exactly as it did.
 */
export interface ChatMessageLegacyProps {
  message: ChatMessageData
  isStreaming?: boolean
  view?: undefined
}

/**
 * The remastered shape: the hook's view model, rendered as parts. Passing a
 * `view` is the only way to reach the chips, the trace, the sources panel and
 * the feedback controls; the legacy shape stays text-and-copy alone.
 */
export interface ChatMessagePartsProps {
  view: ChatMessageView
  /** Legacy-only. The parts path reads `view.state` for streaming instead. */
  isStreaming?: boolean
  message?: undefined
}

export type ChatMessageProps = ChatMessageLegacyProps | ChatMessagePartsProps

export function ChatMessage(props: ChatMessageProps) {
  if (props.view) return <PartsMessage view={props.view} />
  return <LegacyMessage message={props.message} isStreaming={props.isStreaming ?? false} />
}

/** The pre-remaster rendering, unchanged: text, markdown treatment, copy. */
function LegacyMessage({
  message,
  isStreaming,
}: {
  message: ChatMessageData
  isStreaming: boolean
}) {
  const isUser = message.role === "user"
  const showDots = !isUser && isStreaming && message.content.length === 0

  return (
    <div className={cn("group flex flex-col w-full", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          BUBBLE_BASE,
          isUser ? BUBBLE_USER : BUBBLE_ASSISTANT
        )}
      >
        {showDots ? <TypingDots /> : renderContent(message.content)}
      </div>

      {!isUser && !isStreaming && message.content.length > 0 && (
        <div className="mt-1 flex items-center gap-1 pl-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <CopyButton text={message.content} />
        </div>
      )}
    </div>
  )
}

/** The view-model rendering: the answer plus every part the server sent. */
function PartsMessage({ view }: { view: ChatMessageView }) {
  const isUser = view.role === "user"
  const streaming = view.state.kind === "streaming"
  const showDots = !isUser && streaming && view.text.length === 0

  const [sourcesOpen, setSourcesOpen] = React.useState(false)
  const [highlight, setHighlight] = React.useState<number | null>(null)

  // C24: the trace badges every reason it is handed, so a synthetic token would
  // be said twice — once by the trace and once by the D5 badge below.
  const traceReasons = view.degraded.filter((reason) => !SYNTHETIC_REASONS.has(reason))

  // Feedback is offered once the turn has ended with an answer. A stopped turn is
  // a partial the reader did not finish reading, and a streaming one has not
  // produced an answer yet, so neither is rated.
  const endedWithAnswer =
    view.state.kind === "complete" ||
    view.state.kind === "degraded" ||
    view.state.kind === "synthetic"

  // Nothing below the bubble renders for a text-only turn (v1, or a hand-built
  // stream), so that shape looks finished rather than like a stack of empty boxes.
  const hasParts =
    !isUser &&
    (view.state.kind === "stopped" ||
      view.state.kind === "synthetic" ||
      view.citations !== null ||
      view.activity !== null)

  return (
    <div className={cn("group flex flex-col w-full", isUser ? "items-end" : "items-start")}>
      <div className={cn(BUBBLE_BASE, isUser ? BUBBLE_USER : BUBBLE_ASSISTANT)}>
        {showDots ? <TypingDots /> : renderContent(view.text)}
      </div>

      {hasParts && (
        <div className="mt-2 flex w-full max-w-[88%] flex-col gap-2">
          {view.state.kind === "stopped" && (
            <p className="pl-1 text-[11px] text-ink-faint">
              Stopped — this answer may be incomplete.
            </p>
          )}
          {view.state.kind === "synthetic" && (
            <div className="pl-1">
              <span
                className={cn(
                  badgeVariants({ variant: "outline" }),
                  "px-1.5 py-0 text-[10px] leading-4"
                )}
              >
                {degradeWording(view.state.reason)}
              </span>
            </div>
          )}
          <CitationChips
            refs={view.refs}
            citations={view.citations}
            onSelect={(n) => {
              setHighlight(n)
              setSourcesOpen(true)
            }}
          />
          <ActivityTrace activity={view.activity} degraded={traceReasons} />
          <SourcesPanel
            refs={view.refs}
            citations={view.citations}
            open={sourcesOpen}
            onOpenChange={setSourcesOpen}
            highlight={highlight}
          />
        </div>
      )}

      {!isUser && !streaming && view.text.length > 0 && (
        <div className="mt-1 flex items-center gap-1 pl-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <CopyButton text={view.text} />
          {endedWithAnswer && <FeedbackControls messageId={view.id} />}
        </div>
      )}
    </div>
  )
}
