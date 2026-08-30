import { describe, expect, it, vi } from "vitest"
import {
  ADMIN_PROFILE_FIELDS,
  PUBLIC_PROFILE_COLUMNS,
  PUBLIC_PROFILE_FIELDS,
  SELF_PROFILE_COLUMNS,
  SELF_PROFILE_FIELDS,
  fail,
  handleApiError,
  ok,
  sanitizeOwnProfile,
  sanitizeProfile,
  sanitizeProfileForAdmin,
  sanitizeProfiles,
  tooManyRequests,
} from "@/lib/api-utils"

/** A row shaped like a raw DB read: every real column plus hostile extras. */
function fullRow(): Record<string, unknown> {
  return {
    user_id: "u-1",
    username: "conan",
    display_name: "Conan Edogawa",
    avatar_url: "https://cdn.example/a.png",
    email: "conan@example.com",
    bio: "Detective.",
    birthday: "2000-05-04",
    role: "member",
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
    ban_reason: "spam",
    banned_at: "2026-03-01T00:00:00.000Z",
    suspended_until: "2026-04-01T00:00:00.000Z",
    // Must never be emitted by any sanitizer:
    secret_column: "leak-me",
    password_hash: "$2b$10$hash",
    stripe_customer_id: "cus_123",
    internal_notes: "flagged",
  }
}

const BAN_FIELDS = ["ban_reason", "banned_at", "suspended_until"] as const
const FORBIDDEN = [
  "secret_column",
  "password_hash",
  "stripe_customer_id",
  "internal_notes",
] as const

describe("sanitizeProfile — public view", () => {
  it("emits exactly the public allowlist", () => {
    expect(sanitizeProfile(fullRow())).toEqual({
      user_id: "u-1",
      username: "conan",
      display_name: "Conan Edogawa",
      avatar_url: "https://cdn.example/a.png",
    })
  })

  it("drops unknown/future columns (fail-closed)", () => {
    const keys = Object.keys(sanitizeProfile(fullRow()) ?? {})
    for (const forbidden of FORBIDDEN) {
      expect(keys).not.toContain(forbidden)
    }
    expect(keys).not.toContain("email")
    for (const banField of BAN_FIELDS) {
      expect(keys).not.toContain(banField)
    }
  })

  it("does not invent keys that are absent from the row", () => {
    expect(sanitizeProfile({ user_id: "u-1" })).toEqual({ user_id: "u-1" })
    expect(Object.keys(sanitizeProfile({ user_id: "u-1" }) ?? {})).toEqual(["user_id"])
  })

  it("preserves explicit null values for allowlisted fields", () => {
    expect(sanitizeProfile({ user_id: "u-1", avatar_url: null })).toEqual({
      user_id: "u-1",
      avatar_url: null,
    })
  })

  it("returns null for null, undefined and non-objects", () => {
    expect(sanitizeProfile(null)).toBeNull()
    expect(sanitizeProfile(undefined)).toBeNull()
    expect(sanitizeProfile("junk" as unknown as Record<string, unknown>)).toBeNull()
    expect(sanitizeProfile(42 as unknown as Record<string, unknown>)).toBeNull()
    expect(sanitizeProfile(0 as unknown as Record<string, unknown>)).toBeNull()
    expect(sanitizeProfile(false as unknown as Record<string, unknown>)).toBeNull()
  })
})

describe("sanitizeOwnProfile — self view", () => {
  it("adds the self fields on top of the public ones", () => {
    const out = sanitizeOwnProfile(fullRow()) ?? {}
    expect(out.email).toBe("conan@example.com")
    expect(out.bio).toBe("Detective.")
    expect(out.role).toBe("member")
    expect(out.status).toBe("active")
    expect(out.user_id).toBe("u-1")
  })

  it("never exposes moderation fields to the user themselves", () => {
    const keys = Object.keys(sanitizeOwnProfile(fullRow()) ?? {})
    for (const banField of BAN_FIELDS) {
      expect(keys).not.toContain(banField)
    }
  })

  it("drops unknown/future columns", () => {
    const keys = Object.keys(sanitizeOwnProfile(fullRow()) ?? {})
    for (const forbidden of FORBIDDEN) {
      expect(keys).not.toContain(forbidden)
    }
  })

  it("returns null for null, undefined and non-objects", () => {
    expect(sanitizeOwnProfile(null)).toBeNull()
    expect(sanitizeOwnProfile(undefined)).toBeNull()
    expect(sanitizeOwnProfile("junk" as unknown as Record<string, unknown>)).toBeNull()
  })
})

describe("sanitizeProfileForAdmin — admin view", () => {
  it("includes the moderation fields", () => {
    const out = sanitizeProfileForAdmin(fullRow()) ?? {}
    expect(out.ban_reason).toBe("spam")
    expect(out.banned_at).toBe("2026-03-01T00:00:00.000Z")
    expect(out.suspended_until).toBe("2026-04-01T00:00:00.000Z")
    expect(out.email).toBe("conan@example.com")
  })

  it("is still an allowlist — unknown columns are dropped", () => {
    const keys = Object.keys(sanitizeProfileForAdmin(fullRow()) ?? {})
    for (const forbidden of FORBIDDEN) {
      expect(keys).not.toContain(forbidden)
    }
    expect(keys.sort()).toEqual([...ADMIN_PROFILE_FIELDS].sort())
  })

  it("returns null for null, undefined and non-objects", () => {
    expect(sanitizeProfileForAdmin(null)).toBeNull()
    expect(sanitizeProfileForAdmin(undefined)).toBeNull()
    expect(
      sanitizeProfileForAdmin("junk" as unknown as Record<string, unknown>)
    ).toBeNull()
  })
})

describe("sanitizeProfiles", () => {
  it("returns [] for null, undefined and non-arrays", () => {
    expect(sanitizeProfiles(null)).toEqual([])
    expect(sanitizeProfiles(undefined)).toEqual([])
    expect(sanitizeProfiles({} as unknown as Record<string, unknown>[])).toEqual([])
    expect(sanitizeProfiles("junk" as unknown as Record<string, unknown>[])).toEqual([])
  })

  it("sanitizes each entry with the public allowlist and drops junk entries", () => {
    const input = [
      fullRow(),
      null,
      undefined,
      "junk",
      7,
      { user_id: "u-2", username: "ran", secret_column: "leak-me" },
    ] as unknown as Record<string, unknown>[]

    expect(sanitizeProfiles(input)).toEqual([
      {
        user_id: "u-1",
        username: "conan",
        display_name: "Conan Edogawa",
        avatar_url: "https://cdn.example/a.png",
      },
      { user_id: "u-2", username: "ran" },
    ])
  })

  it("returns [] for an empty array", () => {
    expect(sanitizeProfiles([])).toEqual([])
  })
})

describe("field allowlist constants", () => {
  it("nests public -> self -> admin", () => {
    for (const field of PUBLIC_PROFILE_FIELDS) {
      expect(SELF_PROFILE_FIELDS).toContain(field)
    }
    for (const field of SELF_PROFILE_FIELDS) {
      expect(ADMIN_PROFILE_FIELDS).toContain(field)
    }
  })

  it("keeps moderation fields out of the self allowlist", () => {
    for (const banField of BAN_FIELDS) {
      expect(SELF_PROFILE_FIELDS).not.toContain(banField)
      expect(ADMIN_PROFILE_FIELDS).toContain(banField)
    }
  })

  it("keeps email out of the public allowlist", () => {
    expect(PUBLIC_PROFILE_FIELDS).not.toContain("email")
  })

  it("has no duplicate entries", () => {
    expect(new Set(ADMIN_PROFILE_FIELDS).size).toBe(ADMIN_PROFILE_FIELDS.length)
    expect(new Set(SELF_PROFILE_FIELDS).size).toBe(SELF_PROFILE_FIELDS.length)
    expect(new Set(PUBLIC_PROFILE_FIELDS).size).toBe(PUBLIC_PROFILE_FIELDS.length)
  })

  it("renders select-column strings from the same allowlists", () => {
    expect(PUBLIC_PROFILE_COLUMNS).toBe("user_id, username, display_name, avatar_url")
    expect(PUBLIC_PROFILE_COLUMNS.split(", ")).toEqual([...PUBLIC_PROFILE_FIELDS])
    expect(SELF_PROFILE_COLUMNS.split(", ")).toEqual([...SELF_PROFILE_FIELDS])
    expect(SELF_PROFILE_COLUMNS).toContain("email")
    expect(SELF_PROFILE_COLUMNS).not.toContain("ban_reason")
  })
})

describe("ok", () => {
  it("wraps data as { success: true, data } with a 200 status", async () => {
    const res = ok({ id: 1 })
    expect(res.status).toBe(200)
    expect((await res.json()) as unknown).toEqual({ success: true, data: { id: 1 } })
  })

  it("sets Cache-Control: private, no-store", () => {
    expect(ok({ id: 1 }).headers.get("cache-control")).toBe("private, no-store")
  })

  it("honours a caller-supplied status and merges extra headers", async () => {
    const res = ok({ id: 1 }, { status: 201, headers: { "X-Custom": "yes" } })
    expect(res.status).toBe(201)
    expect(res.headers.get("x-custom")).toBe("yes")
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect((await res.json()) as unknown).toEqual({ success: true, data: { id: 1 } })
  })

  it("lets the caller override Cache-Control explicitly", () => {
    const res = ok({ id: 1 }, { headers: { "Cache-Control": "public, max-age=60" } })
    expect(res.headers.get("cache-control")).toBe("public, max-age=60")
  })

  it("supports null data", async () => {
    expect((await ok(null).json()) as unknown).toEqual({ success: true, data: null })
  })
})

describe("fail", () => {
  it("returns the given status and a { error } body", async () => {
    const res = fail(400, "Invalid request")
    expect(res.status).toBe(400)
    expect((await res.json()) as unknown).toEqual({ error: "Invalid request" })
    expect(res.headers.get("cache-control")).toBe("private, no-store")
  })

  it("works for auth statuses", async () => {
    const res = fail(401, "Unauthorized")
    expect(res.status).toBe(401)
    expect((await res.json()) as unknown).toEqual({ error: "Unauthorized" })
  })
})

describe("tooManyRequests", () => {
  it("returns 429 with Retry-After and a generic body", async () => {
    const res = tooManyRequests(30)
    expect(res.status).toBe(429)
    expect(res.headers.get("retry-after")).toBe("30")
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect((await res.json()) as unknown).toEqual({ error: "Too many requests" })
  })

  it("stringifies the retry hint", () => {
    expect(tooManyRequests(1).headers.get("retry-after")).toBe("1")
    expect(tooManyRequests(300).headers.get("retry-after")).toBe("300")
  })
})

describe("handleApiError", () => {
  it("logs server-side and returns a generic 500 that leaks nothing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})

    const err = new Error(
      'duplicate key value violates unique constraint "profiles_email_key" — password=hunter2'
    )
    const res = handleApiError(err, "profiles.update")

    expect(res.status).toBe(500)

    const body = (await res.json()) as { error: string }
    expect(body).toEqual({ error: "Internal server error" })

    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain("hunter2")
    expect(serialized).not.toContain("profiles_email_key")
    expect(serialized).not.toContain("duplicate key")

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]?.[0]).toContain("api_error")

    spy.mockRestore()
  })

  it("handles non-Error throwables without leaking them", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = handleApiError({ secret: "service_role_key" }, "chat.post")

    expect(res.status).toBe(500)
    expect((await res.json()) as unknown).toEqual({ error: "Internal server error" })
    expect(spy).toHaveBeenCalledTimes(1)

    spy.mockRestore()
  })
})