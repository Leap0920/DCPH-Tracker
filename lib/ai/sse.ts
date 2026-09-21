export interface SseFrame {
  delta?: string
  reasoning?: string
  finishReason?: string | null
  error?: string
}

export interface SseParser {
  /** Feed decoded text; returns every frame that became complete. */
  push(chunk: string): SseFrame[]
  /** Emit a final frame when the body ended without a terminating blank line. */
  flush(): SseFrame[]
}

interface RawFrame {
  choices?: Array<{
    delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null }
    finish_reason?: string | null
  }>
  error?: { message?: string }
}

/**
 * Parser for the OpenAI-compatible SSE dialect.
 *
 * Tolerates the three things real providers do that break a naive
 * `split("\n")` loop: frames split across chunk boundaries, CRLF line endings,
 * and the trailing frame arriving without its blank-line terminator. A
 * malformed frame is dropped rather than throwing, because losing one delta is
 * recoverable while aborting the stream is not.
 */
export function createSseParser(): SseParser {
  let buffer = ""

  function parseLines(terminated: boolean): SseFrame[] {
    const frames: SseFrame[] = []
    const parts = buffer.split(/\r?\n/)
    // When the caller is flushing, the final part is content rather than a
    // partial line awaiting more input.
    buffer = terminated ? "" : (parts.pop() ?? "")

    for (const rawLine of parts) {
      const line = rawLine.trim()
      if (!line) continue
      if (line.startsWith(":")) continue
      if (!line.startsWith("data:")) continue

      const payload = line.slice(5).trim()
      if (!payload || payload === "[DONE]") continue

      let parsed: RawFrame
      try {
        parsed = JSON.parse(payload)
      } catch {
        continue
      }

      if (parsed.error?.message) {
        frames.push({ error: parsed.error.message })
        continue
      }

      const choice = parsed.choices?.[0]
      if (!choice) continue

      const frame: SseFrame = {}
      if (choice.finish_reason) frame.finishReason = choice.finish_reason

      const delta = choice.delta?.content
      if (typeof delta === "string" && delta) frame.delta = delta

      const reasoning = choice.delta?.reasoning_content ?? choice.delta?.reasoning
      if (typeof reasoning === "string" && reasoning) frame.reasoning = reasoning

      if (frame.delta || frame.reasoning || frame.finishReason) frames.push(frame)
    }

    return frames
  }

  return {
    push(chunk) {
      buffer += chunk
      return parseLines(false)
    },
    flush() {
      if (!buffer.trim()) {
        buffer = ""
        return []
      }
      const pending = buffer
      buffer = pending.endsWith("\n") ? pending : `${pending}\n\n`
      return parseLines(true)
    },
  }
}
