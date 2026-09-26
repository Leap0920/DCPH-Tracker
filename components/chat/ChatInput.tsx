"use client"

import * as React from "react"
import { Send, Square, Mic, MicOff } from "lucide-react"
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
  const [isListening, setIsListening] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const recognitionRef = React.useRef<any>(null)

  const isSpeechSupported =
    typeof window !== "undefined" &&
    Boolean(
      (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }).SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: any }).webkitSpeechRecognition
    )

  const toggleListening = () => {
    if (disabled || isStreaming) return

    if (isListening) {
      recognitionRef.current?.stop()
      setIsListening(false)
      return
    }

    try {
      const SpeechRecognition =
        (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }).SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: any }).webkitSpeechRecognition

      if (!SpeechRecognition) return

      const recognition = new SpeechRecognition()
      recognition.lang = "fil-PH, en-US"
      recognition.continuous = false
      recognition.interimResults = true

      recognition.onstart = () => {
        setIsListening(true)
      }

      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join("")
        setValue((prev) => {
          const space = prev && !prev.endsWith(" ") ? " " : ""
          return (prev + space + transcript).slice(0, MAX_CHARS)
        })
      }

      recognition.onerror = () => {
        setIsListening(false)
      }

      recognition.onend = () => {
        setIsListening(false)
      }

      recognitionRef.current = recognition
      recognition.start()
    } catch {
      setIsListening(false)
    }
  }

  const resize = React.useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [])

  React.useEffect(() => {
    resize()
  }, [value, resize])

  React.useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
    }
  }, [])

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    if (isListening) {
      recognitionRef.current?.stop()
      setIsListening(false)
    }
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
        placeholder={isListening ? "Listening... speak now" : "Ask about Detective Conan episodes..."}
        className={cn(
          "flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink transition-colors",
          isListening
            ? "border-accent ring-1 ring-accent/40 placeholder:text-accent-bright"
            : "placeholder:text-ink-faint focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40",
          "disabled:cursor-not-allowed disabled:opacity-60"
        )}
      />

      {isSpeechSupported && (
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={toggleListening}
          disabled={disabled || isStreaming}
          aria-label={isListening ? "Stop listening" : "Voice input"}
          title={isListening ? "Click to stop listening" : "Voice input (speech-to-text)"}
          className={cn(
            "size-10 shrink-0 rounded-xl border-line transition-all",
            isListening
              ? "border-red-500 bg-red-500/15 text-red-400 animate-pulse"
              : "text-ink-dim hover:text-ink hover:bg-surface-muted"
          )}
        >
          {isListening ? <MicOff className="size-4 text-red-400" /> : <Mic className="size-4" />}
        </Button>
      )}

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
