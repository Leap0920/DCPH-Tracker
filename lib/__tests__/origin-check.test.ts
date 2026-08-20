import { describe, expect, it } from "vitest"
import type { NextRequest } from "next/server"
import { isSameOrigin } from "@/lib/origin-check"

/** isSameOrigin only reads request.headers; NextRequest is a type-only import. */
function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest
}

describe("isSameOrigin", () => {
  it("accepts a matching origin/host pair", () => {
    expect(
      isSameOrigin(
        makeRequest({ origin: "https://app.example", host: "app.example" })
      )
    ).toBe(true)
  })

  it("rejects a cross-site origin", () => {
    expect(
      isSameOrigin(makeRequest({ origin: "https://evil.com", host: "app.example" }))
    ).toBe(false)
  })

  it("rejects an origin that only looks like a suffix match", () => {
    expect(
      isSameOrigin(
        makeRequest({ origin: "https://app.example.evil.com", host: "app.example" })
      )
    ).toBe(false)
  })

  it("allows a missing Origin header (same-origin navigations may omit it)", () => {
    expect(isSameOrigin(makeRequest({ host: "app.example" }))).toBe(true)
  })

  it("rejects a malformed Origin header", () => {
    expect(
      isSameOrigin(makeRequest({ origin: "not a url", host: "app.example" }))
    ).toBe(false)
  })

  it("rejects the opaque \"null\" origin sent by sandboxed iframes", () => {
    expect(isSameOrigin(makeRequest({ origin: "null", host: "app.example" }))).toBe(
      false
    )
  })

  it("rejects a port mismatch — the port is part of URL.host", () => {
    expect(
      isSameOrigin(
        makeRequest({ origin: "https://app.example:3000", host: "app.example" })
      )
    ).toBe(false)

    expect(
      isSameOrigin(
        makeRequest({ origin: "https://app.example", host: "app.example:3000" })
      )
    ).toBe(false)
  })

  it("accepts a matching origin/host pair that both carry the same port", () => {
    expect(
      isSameOrigin(
        makeRequest({ origin: "http://localhost:3000", host: "localhost:3000" })
      )
    ).toBe(true)
  })

  it("ignores the scheme by design — host equality is the check", () => {
    // Documented, intentional: URL.host excludes the protocol, so an http
    // origin on the same host is treated as same-origin.
    expect(
      isSameOrigin(makeRequest({ origin: "http://app.example", host: "app.example" }))
    ).toBe(true)
  })

  it("rejects when the Host header is missing but an Origin is present", () => {
    expect(isSameOrigin(makeRequest({ origin: "https://app.example" }))).toBe(false)
  })
})