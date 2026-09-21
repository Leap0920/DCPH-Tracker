import { describe, expect, it } from "vitest"
import { createSseParser } from "@/lib/ai/sse"

describe("createSseParser", () => {
  it("extracts content deltas from a complete frame", () => {
    const parser = createSseParser()
    const frames = parser.push('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n')
    expect(frames).toHaveLength(1)
    expect(frames[0].delta).toBe("Hi")
  })

  it("buffers a frame split across chunks", () => {
    const parser = createSseParser()
    expect(parser.push('data: {"choices":[{"delta":')).toHaveLength(0)
    const frames = parser.push('{"content":"Hi"}}]}\n\n')
    expect(frames).toHaveLength(1)
    expect(frames[0].delta).toBe("Hi")
  })

  it("handles CRLF line endings", () => {
    const parser = createSseParser()
    const frames = parser.push('data: {"choices":[{"delta":{"content":"Hi"}}]}\r\n\r\n')
    expect(frames).toHaveLength(1)
    expect(frames[0].delta).toBe("Hi")
  })

  it("ignores keep-alive comments and the DONE sentinel", () => {
    const parser = createSseParser()
    const frames = parser.push(": OPENROUTER PROCESSING\n\ndata: [DONE]\n\n")
    expect(frames).toHaveLength(0)
  })

  it("surfaces the finish reason", () => {
    const parser = createSseParser()
    const frames = parser.push('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n')
    expect(frames[0].finishReason).toBe("length")
  })

  it("surfaces a reasoning channel separately from content", () => {
    const parser = createSseParser()
    const frames = parser.push(
      'data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}\n\n'
    )
    expect(frames[0].reasoning).toBe("thinking...")
    expect(frames[0].delta).toBeUndefined()
  })

  it("reports an error payload as an error frame", () => {
    const parser = createSseParser()
    const frames = parser.push('data: {"error":{"message":"upstream exploded"}}\n\n')
    expect(frames[0].error).toBe("upstream exploded")
  })

  it("skips a malformed frame without losing the next one", () => {
    const parser = createSseParser()
    const frames = parser.push(
      'data: {not json\n\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\n'
    )
    expect(frames).toHaveLength(1)
    expect(frames[0].delta).toBe("ok")
  })

  it("flushes a trailing frame with no terminating blank line", () => {
    const parser = createSseParser()
    parser.push('data: {"choices":[{"delta":{"content":"tail"}}]}')
    const frames = parser.flush()
    expect(frames).toHaveLength(1)
    expect(frames[0].delta).toBe("tail")
  })
})
