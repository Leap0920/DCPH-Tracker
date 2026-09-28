"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowRight, Copy, Check, ExternalLink } from "lucide-react"
import { cn, safeExternalUrl } from "@/lib/utils"

export interface ChatMessageData {
  id: string
  role: "user" | "assistant"
  content: string
}

/**
 * Only http(s) is linkified. Anything else — `javascript:`, `data:` — is
 * rendered as plain text, because the bot echoes model output verbatim.
 * Shared with the wiki source link in components/tracker/EpisodeWikiDetails.
 */

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

/**
 * Tracker links stay in this tab and navigate in place: the widget lives in the
 * root layout, so the route change is client-side and the conversation stays
 * open behind the page. They also resolve to a path on whatever origin the
 * reader is already on — the answers carry the canonical site URL, which is a
 * different origin while running locally and a different host under a custom
 * domain, and a cross-origin jump would reload the page and drop the chat.
 *
 * Outbound sources (DCW, Wikipedia) open in a new tab instead: they are
 * somewhere to read alongside the tracker, and spending the chat tab on them
 * would cost the conversation.
 */
function appPath(url: string): string | null {
  try {
    const { pathname, search, hash } = new URL(url)
    return /^\/(?:tracker|cases|arcs)(?:\/|$)/.test(pathname) ? `${pathname}${search}${hash}` : null
  } catch {
    return null
  }
}

function ChatLink({ href, label, isInternal }: { href: string; label: string; isInternal: boolean }) {
  const inApp = isInternal ? appPath(href) : null
  const Anchor: React.ElementType = inApp ? Link : "a"
  return (
    <Anchor
      href={inApp ?? href}
      {...(inApp ? {} : { target: "_blank", rel: "noopener noreferrer" })}
      className={cn(
        "inline-flex items-center gap-1 break-words font-medium transition-colors",
        isInternal
          ? "rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-xs text-accent-bright hover:bg-accent/20 hover:text-white"
          : "text-accent-bright underline underline-offset-2 hover:text-accent"
      )}
    >
      <span>{label}</span>
      {inApp ? (
        <ArrowRight className="inline size-3 shrink-0 opacity-70" />
      ) : (
        <ExternalLink className="inline size-3 shrink-0 opacity-70" />
      )}
    </Anchor>
  )
}

/**
 * One row of the sources list.
 *
 * The footer used to render as prose: bordered chips flowing in a paragraph,
 * where a long label ("Specials, OVAs and long episodes (40+ minutes) case
 * files (103)") broke mid-word across two lines and the "·" separators were
 * left stranded at the line ends. A source is a list item, so it renders like
 * one — one per line, no box, wrapping at word boundaries.
 */
function SourceRow({ label, href }: { label: string; href: string }) {
  const inApp = href && isTrackerUrl(href) ? appPath(href) : null
  const Anchor: React.ElementType = inApp ? Link : "a"

  if (!href) return <span className="break-words text-ink-faint">{label}</span>

  return (
    <Anchor
      href={inApp ?? href}
      {...(inApp ? {} : { target: "_blank", rel: "noopener noreferrer" })}
      className={cn(
        "inline-flex min-w-0 items-start gap-1.5 break-words transition-colors",
        inApp ? "text-accent-bright hover:text-accent" : "text-ink-dim hover:text-ink"
      )}
    >
      <span className="min-w-0 break-words">{label}</span>
      {inApp ? (
        <ArrowRight className="mt-0.5 size-3 shrink-0 opacity-70" />
      ) : (
        <ExternalLink className="mt-0.5 size-3 shrink-0 opacity-70" />
      )}
    </Anchor>
  )
}

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
      if (!safeExternalUrl(href)) return <React.Fragment key={key}>{part}</React.Fragment>
      return <ChatLink key={key} href={href} label={label} isInternal={isTrackerUrl(href)} />
    }

    // Bare URL.
    if (/^https?:\/\//i.test(part)) {
      const { href, trailing } = trimUrl(part)
      if (!safeExternalUrl(href)) return <React.Fragment key={key}>{part}</React.Fragment>
      return (
        <React.Fragment key={key}>
          <ChatLink href={href} label={href} isInternal={isTrackerUrl(href)} />
          {trailing}
        </React.Fragment>
      )
    }

    return <React.Fragment key={key}>{part}</React.Fragment>
  })
}

/**
 * Splits the app-appended source list off the answer.
 *
 * The route appends "**Sources**" plus its lines after the model finishes. They
 * are real citations, but reading them as part of the prose is what made an
 * answer look like a wall of links, so they render smaller and set apart.
 */
function splitSources(content: string): { body: string; sources: string[] } {
  const lines = content.split("\n")
  const index = lines.findIndex((line) => line.trim().startsWith("**Sources**"))
  if (index === -1) return { body: content, sources: [] }

  const sources = lines
    .slice(index)
    .map((line) =>
      line
        .replace(/^\s*\*\*Sources\*\*\s*/, "")
        .replace(/^\s*(?:[-*•]|\d+\.)\s+/, "")
        .trim()
    )
    .filter(Boolean)

  return { body: lines.slice(0, index).join("\n").trimEnd(), sources }
}

/** One `[label](url)` as the footer joins them. */
const SOURCE_LINK = /^\[([^\]\n]+)\]\(((?:https?:\/\/)[^)\s]+)\)$/

/**
 * Splits the joined sources line back into rows.
 *
 * The route joins its links with " · ", which reads as a sentence and wraps as
 * one. Anything that is not a link is kept as plain text so a stored
 * conversation from an older format still renders.
 */
function parseSources(sources: string[]): { label: string; href: string }[] {
  return sources
    .flatMap((line) => line.split("·"))
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(SOURCE_LINK)
      return match ? { label: match[1]!, href: match[2]! } : { label: part, href: "" }
    })
}

function renderContent(content: string): React.ReactNode {
  const { body, sources } = splitSources(content)
  const lines = body.split("\n")
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

  const items = parseSources(sources)

  if (items.length > 0) {
    blocks.push(
      <div key="sources" className="mt-2.5 border-t border-line/60 pt-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          Sources
        </p>
        <ul className="mt-1 space-y-0.5 text-[11px] leading-snug">
          {items.map((item, index) => (
            <li key={index} className="min-w-0">
              <SourceRow label={item.label} href={item.href} />
            </li>
          ))}
        </ul>
      </div>
    )
  }

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

interface ChatMessageProps {
  message: ChatMessageData
  isStreaming?: boolean
}

export function ChatMessage({ message, isStreaming = false }: ChatMessageProps) {
  const isUser = message.role === "user"
  const showDots = !isUser && isStreaming && message.content.length === 0

  return (
    <div className={cn("group flex flex-col w-full", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[88%] rounded-2xl border px-3.5 py-2.5 text-sm leading-relaxed break-words",
          isUser
            ? "border-accent/30 bg-accent/15 text-ink rounded-br-md"
            : "border-line bg-surface-muted text-ink rounded-bl-md"
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
