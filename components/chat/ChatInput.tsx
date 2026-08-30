"use client"

import * as React from "react"
import { Send, Square } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface ChatInputProps {
  onSend: (message: string) => void
  onStop?: () => void
  disabled?: boolean
  isStreaming?: boolean
}

const MAX_CHARS = 1000

export function ChatInput({ onSend, onStop, disabled = false, isStreaming = false }: ChatInputProps) {
  const [value, setValue] = React.useState("")
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  const resize = React.useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [])

  React.useEffect(() => {
    resize()
  }, [value, resize])

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue("")
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className="flex items-end gap-2 border-t border-line bg-surface p-3"
    >
      <label htmlFor="dcph-chat-input" className="sr-only">
        Ask about Detective Conan episodes
      </label>
      <textarea
        id="dcph-chat-input"
        ref={textareaRef}
        rows={1}
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value.slice(0, MAX_CHARS))}
        onKeyDown={handleKeyDown}
        placeholder="Ask about Detective Conan episodes..."
        className={cn(
          "flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink",
          "placeholder:text-ink-faint focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40",
          "disabled:cursor-not-allowed disabled:opacity-60"
        )}
      />

      {isStreaming && onStop ? (
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={onStop}
          aria-label="Stop generating"
          className="size-10 shrink-0 rounded-xl border-line text-ink-dim hover:text-ink"
        >
          <Square className="size-4" />
        </Button>
      ) : (
        <Button
          type="submit"
          size="icon"
          disabled={disabled || !value.trim()}
          aria-label="Send message"
          className="size-10 shrink-0 rounded-xl bg-accent text-white hover:bg-accent-bright disabled:opacity-40"
        >
          <Send className="size-4" />
        </Button>
      )}
    </form>
  )
}
