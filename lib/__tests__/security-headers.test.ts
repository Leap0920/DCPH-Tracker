import { afterEach, describe, expect, it, vi } from "vitest"
import type { NextResponse } from "next/server"

// lib/env throws at import time when the Supabase vars are missing (CI has no
// .env.local), so stub them before the module graph loads. Real values win when
// a .env.local is present.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://csp-test.supabase.co"
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "csp-test-key"

const { SUPABASE_HOST } = await import("../env")
const { buildCsp, applySecurityHeaders, copyCookies } = await import("../security-headers")

/** The value of one directive, so assertions do not match across directives. */
function directive(csp: string, name: string): string {
  return (
    csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part === name || part.startsWith(`${name} `)) ?? ""
  )
}

/** A NextResponse-shaped fake: the module only touches headers and cookies. */
function fakeResponse() {
  const headers = new Headers()
  const jar: [string, string][] = []
  return {
    headers,
    cookies: {
      getAll: () => jar.map(([name, value]) => ({ name, value })),
      set: (cookie: { name: string; value: string }) => jar.push([cookie.name, cookie.value]),
    },
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

/**
 * Re-imports the module under a chosen NODE_ENV. The ambient NODE_ENV is not
 * dependable (a shell with NODE_ENV=production exported turns every dev-only
 * branch off), so every environment-dependent assertion stubs it explicitly.
 */
async function loadWith(
  nodeEnv: string,
  extra: Record<string, string> = {}
): Promise<typeof import("../security-headers")> {
  vi.stubEnv("NODE_ENV", nodeEnv)
  for (const [key, value] of Object.entries(extra)) vi.stubEnv(key, value)
  vi.resetModules()
  return await import("../security-headers")
}

describe("buildCsp", () => {
  it("carries the per-request nonce in script-src", () => {
    expect(directive(buildCsp("abc123"), "script-src")).toContain("'nonce-abc123'")
  })

  it("keeps 'self' as a live source, i.e. never emits 'strict-dynamic'", () => {
    // Regression guard. Next 15's webpack runtime ships
    // `__webpack_require__.nc = undefined`, so the <script> that
    // __webpack_require__.l appends to document.head has no nonce. With
    // 'strict-dynamic' in the policy a CSP3 browser ignores 'self' entirely and
    // blocks every runtime-loaded chunk (script-src-elem, blockedReason=csp):
    // measured on this app, _app-pages-browser_components_auth_AuthModal_tsx.js
    // in dev and 1344-*.js / 1944.*.js in production. 'self' is what lets them
    // load, so this assertion is the whole point of the directive list.
    const scriptSrc = directive(buildCsp("abc123"), "script-src")

    expect(scriptSrc).toContain("'self'")
    expect(scriptSrc).not.toContain("strict-dynamic")
  })

  it("allows 'unsafe-eval' outside production only", async () => {
    const dev = await loadWith("development")
    expect(directive(dev.buildCsp("n"), "script-src")).toContain("'unsafe-eval'")

    const prod = await loadWith("production")
    expect(directive(prod.buildCsp("n"), "script-src")).not.toContain("'unsafe-eval'")
  })

  it("allows the Supabase origin for connect-src, in both http and ws form", () => {
    const connectSrc = directive(buildCsp("n"), "connect-src")

    if (SUPABASE_HOST) {
      expect(connectSrc).toContain(`https://${SUPABASE_HOST}`)
      expect(connectSrc).toContain(`wss://${SUPABASE_HOST}`)
    }
    expect(connectSrc).toContain("'self'")
  })

  it("only asks for upgrade-insecure-requests in production", async () => {
    const dev = await loadWith("development")
    expect(dev.buildCsp("n")).not.toContain("upgrade-insecure-requests")

    const prod = await loadWith("production")
    expect(prod.buildCsp("n")).toContain("upgrade-insecure-requests")
  })

  it("locks the other directives the app relies on", () => {
    const csp = buildCsp("n")

    for (const locked of [
      "default-src 'self'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ]) {
      expect(csp).toContain(locked)
    }
  })
})

describe("applySecurityHeaders", () => {
  it("sets the enforced CSP plus the fixed headers", () => {
    const res = applySecurityHeaders(fakeResponse() as unknown as NextResponse, "default-src 'self'")

    expect(res.headers.get("content-security-policy")).toBe("default-src 'self'")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.get("x-frame-options")).toBe("DENY")
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin")
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin")
    expect(res.headers.get("permissions-policy")).toContain("camera=()")
  })

  it("switches to the report-only header when CSP_REPORT_ONLY=true", async () => {
    const reporting = await loadWith("development", { CSP_REPORT_ONLY: "true" })

    const res = reporting.applySecurityHeaders(
      fakeResponse() as unknown as NextResponse,
      "default-src 'self'"
    )

    expect(res.headers.get("content-security-policy-report-only")).toBe("default-src 'self'")
    expect(res.headers.get("content-security-policy")).toBeNull()
  })

  it("sends HSTS in production only", async () => {
    const dev = await loadWith("development")
    const devRes = dev.applySecurityHeaders(fakeResponse() as unknown as NextResponse, "x")
    expect(devRes.headers.get("strict-transport-security")).toBeNull()

    const prod = await loadWith("production")
    const prodRes = prod.applySecurityHeaders(fakeResponse() as unknown as NextResponse, "x")

    expect(prodRes.headers.get("strict-transport-security")).toContain("max-age=")
  })
})

describe("copyCookies", () => {
  it("carries every cookie onto the redirect response", () => {
    const from = fakeResponse()
    from.cookies.set({ name: "sb-refresh", value: "rotated" })
    from.cookies.set({ name: "sb-access", value: "token" })
    const to = fakeResponse()

    copyCookies(from as unknown as NextResponse, to as unknown as NextResponse)

    expect(to.cookies.getAll()).toEqual([
      { name: "sb-refresh", value: "rotated" },
      { name: "sb-access", value: "token" },
    ])
  })
})
