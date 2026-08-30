/**
 * Post-processing for DCPH Bot completions.
 *
 * Pure and dependency-free so it can be unit-tested: every bug in this file
 * has previously shown up as the model's private reasoning being displayed to
 * the user as if it were an answer.
 */

/** Lines that are the model talking to itself, not answering the user. */
const REASONING_PATTERNS: RegExp[] = [
  /^user\s+(asks|is|wants|needs|said|means|looking)/i,
  // Observed in production: a free model answered "what is the incoming new
  // movie" with the entire string "User Safety: safe".
  /^user\s+safety\s*:/i,
  /^safety\s*:/i,
  /^assistant\s*:/i,
  /^key\s+elements/i,
  /^constraints\s*:/i,
  /^need\s+to\s+(find|identify|determine|check|look|search|verify|make|answer|provide|confirm)/i,
  /^identify\b/i,
  /^let'?s?\s+(think|check|look|see|find|search|review|analyze|start|break)/i,
  /^let\s+me\s+(think|check|look|see|find|search|review|analyze)/i,
  /^actually,/i,
  /^wait,/i,
  /^ok(ay)?,?\s+(so|let|i)/i,
  /^i\s+(need|should|must|have\s+to|think|believe|recall|remember|see|find|check|will|'ll|am\s+going\s+to)\b/i,
  /^the\s+user\s+(is|wants|needs|asks|said)/i,
  /^however,/i,
  /^looking\s+(at|through|for)/i,
  /^checking\b/i,
  /^that'?s\s+(exactly|it|right|correct)/i,
  /^should\s+(be|use|check|include)/i,
  /^use\s+(wiki|tracker|context)/i,
  /^check\s+(watch|context|resources|tracker)/i,
  /^review\s+(available|the)/i,
  /^from\s+the\s+(tracker|context|data)/i,
  /^my\s+(analysis|search|review)/i,
  /^step\s*\d+/i,
  /^(analyze|analysis|reasoning|thought|thinking|plan|approach)\s*:/i,
  /^here'?s?\s+(my|the)\s+(thinking|analysis|reasoning|plan)/i,
]

/**
 * A numbered or bulleted line that is really a planning step, e.g.
 * "1. **Analyze the question**" or "- First, check the tracker".
 */
const NUMBERED_REASONING =
  /^\s*(?:\d+[\.\)]|[-*])\s*\**\s*(i|the|let|need|check|use|find|look|analyze|analysis|identify|determine|review|verify|first|then|finally|step)\b/i

/** True when a single line reads like the model's private monologue. */
export function isReasoningLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (NUMBERED_REASONING.test(trimmed)) return true
  // Strip markdown bullets/formatting so "- **Analyze the question**" is caught.
  const bare = trimmed.replace(/^[-\d.*)\s]+/, "").replace(/\*\*/g, "").trim()
  if (bare && NUMBERED_REASONING.test(bare)) return true
  return REASONING_PATTERNS.some((p) => p.test(trimmed) || p.test(bare))
}

/**
 * Removes reasoning, thinking blocks and safety preambles from a completion.
 *
 * WHY IT EXISTS: `openrouter/free` routes to a different model per request, and
 * several of the free models emit their chain-of-thought as plain text. Users
 * have received answers beginning "User asks: ... — I need to find ..." and at
 * least one answer that was nothing but "User Safety: safe".
 *
 * Strategy: drop every leading line that looks like the model talking to
 * itself, then keep everything from the first line that reads like an answer.
 */
export function stripThinking(text: string): string {
  if (!text) return ""

  let cleaned = text

  // 1. Explicit <think>...</think> blocks, including unterminated ones.
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, " ")
  cleaned = cleaned.replace(/<think>[\s\S]*$/gi, " ")

  // 2. Inline reasoning prefixes that can appear mid-sentence.
  cleaned = cleaned.replace(/here'?s?\s+(a|my|the)\s+(thinking|analysis|reasoning)\s+process\s*:/gi, "")
  cleaned = cleaned.replace(/(analyze|analysis)\s+user\s+input\s*:/gi, "")

  // 3. Line-by-line: skip the model's monologue, keep the answer.
  let foundAnswer = false
  const answerLines: string[] = []

  for (const line of cleaned.split("\n")) {
    if (!foundAnswer) {
      if (line.trim() === "") continue
      if (isReasoningLine(line)) continue
      foundAnswer = true
    }
    answerLines.push(line)
  }

  return answerLines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

/** True when the text still looks like leaked reasoning after stripping. */
export function looksLikeReasoning(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return isReasoningLine(trimmed)
}

/**
 * Index at which the real answer starts, or `null` when that cannot yet be
 * decided from a partial completion.
 *
 * Returns `null` while the last line is still incomplete: we cannot know
 * whether "Wait, I should ch..." is reasoning or an answer until the newline
 * arrives, so the caller holds the text back instead of guessing.
 */
function findAnswerStart(text: string): number | null {
  const lines = text.split("\n")
  let cursor = 0

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    const lineStart = cursor
    cursor += line.length + 1 // the line plus the newline that ends it

    const isLast = i === lines.length - 1
    if (isLast) return null // incomplete line — wait for more input

    if (line.trim() === "") continue
    if (isReasoningLine(line)) continue
    return lineStart
  }

  return null
}

/** Never hold back more than this before giving up and releasing the text. */
const MAX_HOLD_CHARS = 4_000
/** Enough characters to catch a `<think>` tag split across two chunks. */
const CARRY_SIZE = 8

/**
 * Incremental reasoning filter for streaming responses.
 *
 * The old implementation ran per-chunk regexes against each SSE delta. That
 * cannot work: reasoning leaks span many chunks and whole lines, so by the time
 * a chunk arrives there is no way to tell "I need to find the movie" (drop) from
 * "Movie 24 is The Scarlet Bullet" (keep).
 *
 * This filter instead holds the stream back until it can prove where the answer
 * begins, then passes everything through untouched. Latency cost is one line of
 * output; correctness gain is that reasoning never reaches the user.
 */
export class ThinkingFilter {
  private held = ""
  private released = false
  private inThink = false
  private carry = ""

  /** True once the filter has decided the answer has started. */
  get didRelease(): boolean {
    return this.released
  }

  /**
   * Feed the next chunk. Returns the text that is safe to show the user right
   * now — an empty string while the model is still talking to itself.
   */
  push(delta: string): string {
    if (!delta) return ""

    if (this.released) return this.stripThinkBlocks(delta)

    // Drop <think> blocks before line analysis so their contents are not
    // mistaken for the answer.
    const visible = this.stripThinkBlocks(delta)
    if (!visible) return ""

    this.held += visible

    let start = findAnswerStart(this.held)
    if (start === null) {
      // A single-line answer with no newline yet would stall here until the
      // stream ends, so cap how long we are willing to wait.
      if (this.held.length < MAX_HOLD_CHARS) return ""
      start = 0
    }

    this.released = true
    const out = this.held.slice(start)
    this.held = ""
    return out
  }

  /** Flush whatever survived. Call once, after the final chunk. */
  finish(): string {
    if (this.released) {
      const tail = this.inThink ? "" : this.carry
      this.carry = ""
      return tail
    }

    const rest = this.inThink ? "" : this.carry + this.held
    this.held = ""
    this.carry = ""
    return stripThinking(rest)
  }

  /** Discard state so the instance can be reused for a retry attempt. */
  reset(): void {
    this.held = ""
    this.released = false
    this.inThink = false
    this.carry = ""
  }

  /**
   * Removes `<think>...</think>` regions, tolerating tags that OpenRouter
   * splits across chunk boundaries.
   */
  private stripThinkBlocks(text: string): string {
    let combined = this.carry + text
    this.carry = ""
    let out = ""

    for (;;) {
      if (this.inThink) {
        const end = combined.indexOf("</think>")
        if (end === -1) {
          // Keep a tail in case the closing tag is split across chunks.
          this.carry = combined.slice(-CARRY_SIZE)
          return out
        }
        this.inThink = false
        combined = combined.slice(end + "</think>".length)
        continue
      }

      const start = combined.indexOf("<think>")
      if (start === -1) {
        // A partial "<thi" may be waiting at the very end of this chunk.
        const lt = combined.lastIndexOf("<")
        if (lt !== -1 && combined.length - lt < CARRY_SIZE) {
          this.carry = combined.slice(lt)
          return out + combined.slice(0, lt)
        }
        return out + combined
      }

      out += combined.slice(0, start)
      this.inThink = true
      combined = combined.slice(start + "<think>".length)
    }
  }
}
