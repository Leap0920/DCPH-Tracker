/**
 * The feedback route: one vote on one assistant message.
 *
 * The two collaborators that would reach the network are mocked -- the session
 * client and the store -- so what is pinned here is the guard order, the status
 * each refusal maps to, and the payload the store is handed (constraint 10). The
 * real origin helper runs, because "a cross-origin POST is refused before
 * anything else" is an assertion about the route's wiring.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

const getUser = vi.fn()
vi.mock("@/utils/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}))

const createAdminClient = vi.fn()
vi.mock("@/utils/supabase/admin", () => ({
  createAdminClient: (...args: unknown[]) => createAdminClient(...args),
}))

const record = vi.fn()
const forMessages = vi.fn()
vi.mock("@/lib/ai/feedback/store", () => ({
  createFeedbackStore: () => ({ record, forMessages }),
  createSupabaseFeedbackPort: () => ({}),
}))

const USER_ID = "11111111-1111-4111-8111-111111111111"
const MESSAGE_ID = "66666666-6666-4666-8666-666666666666"
const OTHER_MESSAGE_ID = "77777777-7777-4777-8777-777777777777"

const URL = "http://localhost/api/ai-chat/feedback"

/** A real Request for the cases that read the body; the handler only reads headers. */
function post(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      host: "localhost",
      origin: "http://localhost",
      ...headers,
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

/** A declared length the platform would never send, without building the body. */
function oversized(): NextRequest {
  return {
    headers: new Headers({ host: "localhost", origin: "http://localhost", "content-length": "999999" }),
    json: async () => ({}),
  } as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })
  createAdminClient.mockReturnValue({})
  record.mockResolvedValue({ recorded: true, value: 1 })
})

describe("POST /api/ai-chat/feedback", () => {
  it("answers 403 for a cross-origin caller and never builds the store", async () => {
    const { POST } = await import("@/app/api/ai-chat/feedback/route")

    const response = await POST(post({ messageId: MESSAGE_ID, value: 1 }, { origin: "https://evil.com" }))

    expect(response.status).toBe(403)
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it("answers 413 for a body over the cap without reading it", async () => {
    const { POST } = await import("@/app/api/ai-chat/feedback/route")

    const response = await POST(oversized())

    expect(response.status).toBe(413)
    expect(record).not.toHaveBeenCalled()
  })

  it("answers 400 for a body that is not JSON", async () => {
    const { POST } = await import("@/app/api/ai-chat/feedback/route")

    const response = await POST(
      new Request(URL, {
        method: "POST",
        headers: { host: "localhost", origin: "http://localhost" },
        body: "{ not json",
      }) as unknown as NextRequest
    )

    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toBe("Invalid JSON body.")
  })

  it("answers 400 for a value that is neither 1 nor -1", async () => {
    const { POST } = await import("@/app/api/ai-chat/feedback/route")

    const response = await POST(post({ messageId: MESSAGE_ID, value: 2 }))

    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toBe("`value` must be 1 or -1.")
    expect(record).not.toHaveBeenCalled()
  })

  it("answers 400 naming the note cap when the note is too long", async () => {
    const { POST } = await import("@/app/api/ai-chat/feedback/route")

    const response = await POST(post({ messageId: MESSAGE_ID, value: 1, note: "x".repeat(501) }))

    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toBe(
      "Note too long (max 500 characters)."
    )
    expect(record).not.toHaveBeenCalled()
  })

  it("answers 401 for an anonymous caller before the store is built", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { POST } = await import("@/app/api/ai-chat/feedback/route")

    const response = await POST(post({ messageId: MESSAGE_ID, value: 1 }))

    expect(response.status).toBe(401)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("answers 500 when the service-role key is missing", async () => {
    createAdminClient.mockReturnValue(null)
    const { POST } = await import("@/app/api/ai-chat/feedback/route")

    const response = await POST(post({ messageId: MESSAGE_ID, value: 1 }))

    expect(response.status).toBe(500)
    expect(((await response.json()) as { error: string }).error).toBe(
      "Missing Supabase service role env vars"
    )
    expect(record).not.toHaveBeenCalled()
  })

  it("answers 404 for a message that is missing or not the caller's", async () => {
    record.mockResolvedValue({ recorded: false, reason: "not_found" })
    const { POST } = await import("@/app/api/ai-chat/feedback/route")

    const response = await POST(post({ messageId: OTHER_MESSAGE_ID, value: 1 }))

    // One answer for "not there" and "not yours": the response must not be
    // usable to probe another user's message ids.
    expect(response.status).toBe(404)
    expect((await response.json()) as { error?: string }).toHaveProperty("error")
  })

  it("answers 400 for a message that is the caller's but not an assistant turn", async () => {
    record.mockResolvedValue({ recorded: false, reason: "not_assistant" })
    const { POST } = await import("@/app/api/ai-chat/feedback/route")

    const response = await POST(post({ messageId: MESSAGE_ID, value: 1 }))

    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toBe(
      "Only an assistant message can be rated."
    )
  })

  it("records the vote and answers the stored value", async () => {
    record.mockResolvedValue({ recorded: true, value: -1 })
    const { POST } = await import("@/app/api/ai-chat/feedback/route")

    const response = await POST(post({ messageId: MESSAGE_ID, value: -1, note: "  Wrong episode.  " }))

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect((await response.json()) as unknown).toEqual({ recorded: true, value: -1 })
    // The ownership the route passes down is the session's, and the note is
    // trimmed so a whitespace-only one is stored as no note at all.
    expect(record).toHaveBeenCalledWith({
      messageId: MESSAGE_ID,
      userId: USER_ID,
      value: -1,
      note: "Wrong episode.",
    })
  })

  it("answers 500 with the store's message when the write fails", async () => {
    record.mockRejectedValue(new Error("[ai-feedback] upsert: permission denied"))
    const { POST } = await import("@/app/api/ai-chat/feedback/route")

    const response = await POST(post({ messageId: MESSAGE_ID, value: 1 }))

    expect(response.status).toBe(500)
    expect(((await response.json()) as { error: string }).error).toContain("permission denied")
  })
})
