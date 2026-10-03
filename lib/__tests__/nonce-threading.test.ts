import { describe, expect, it, vi } from "vitest"
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"

// react-wrap-balancer injects its balancing runtime as an inline <script> per
// instance. The app's CSP is nonce-based (lib/security-headers.ts), so every
// one of those scripts must carry the per-request nonce or the browser blocks
// it (script-src-elem). This file pins the chain that gets the nonce there:
// middleware -> app/page.tsx -> BlockScreeningSection -> Hero04 -> Balancer.
//
// Two observables, both real: the server-rendered markup of the section (a
// script tag either carries nonce="..." or it does not, which is what the
// browser enforces) and the element tree the homepage returns (what the
// request header resolves to, before any component renders).

const NONCE = "test-nonce-9f3c41"

// vi.hoisted so the mocked module below can read the mutable value: the nonce
// is per-request state, and the tests need to change it between requests.
const request = vi.hoisted(() => ({ nonce: null as string | null }))

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(request.nonce === null ? {} : { "x-nonce": request.nonce }),
}))

// The homepage is a server component that reads the database; mock the reads
// so the test exercises the nonce path, not Supabase.
vi.mock("@/lib/homepage-content", () => ({
  getLatestEpisodeNumber: async () => 1100,
  getLatestContent: async () => [],
}))

const { BlockScreeningSection } = await import("@/components/marketing/BlockScreeningSection")
const HomePage = (await import("@/app/page")).default

function scriptTags(html: string): string[] {
  return html.match(/<script[^>]*>/g) ?? []
}

function noncedScripts(html: string, nonce: string): string[] {
  return scriptTags(html).filter((tag) => tag.includes(`nonce="${nonce}"`))
}

/** Depth-first search of a rendered element tree for the first element of a type. */
function findByType<T>(node: ReactNode, type: unknown): ReactElement<T> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByType<T>(child, type)
      if (found) return found
    }
    return null
  }
  if (!isValidElement(node)) return null
  if (node.type === type) return node as ReactElement<T>
  return findByType<T>((node.props as { children?: ReactNode }).children, type)
}

describe("nonce threading to react-wrap-balancer", () => {
  it("gives every inline script of the block-screening hero the request nonce", () => {
    const html = renderToStaticMarkup(createElement(BlockScreeningSection, { nonce: NONCE }))
    const tags = scriptTags(html)

    // Three <Balancer> instances render three scripts; if the prop stops being
    // forwarded the count collapses and the assertions below fail.
    expect(tags.length).toBeGreaterThanOrEqual(3)
    expect(noncedScripts(html, NONCE)).toHaveLength(tags.length)
  })

  it("leaves the scripts un-nonced when no nonce is supplied (the blocked case)", () => {
    const html = renderToStaticMarkup(createElement(BlockScreeningSection, {}))
    const tags = scriptTags(html)

    expect(tags.length).toBeGreaterThanOrEqual(3)
    // No nonce at all: documents the failure mode the CSP fix exists to avoid.
    expect(tags.filter((tag) => tag.includes("nonce="))).toHaveLength(0)
  })

  it("hands the homepage's request nonce to the section, per request", async () => {
    request.nonce = "first-request-nonce"
    const first = findByType<{ nonce?: string }>(await HomePage(), BlockScreeningSection)
    request.nonce = "second-request-nonce"
    const second = findByType<{ nonce?: string }>(await HomePage(), BlockScreeningSection)

    expect(first?.props.nonce).toBe("first-request-nonce")
    // A nonce baked into the module (or captured once at import) satisfies the
    // first assertion and fails this one.
    expect(second?.props.nonce).toBe("second-request-nonce")
  })

  it("passes undefined when the request carries no x-nonce header", async () => {
    request.nonce = null
    const section = findByType<{ nonce?: string }>(await HomePage(), BlockScreeningSection)

    expect(section).not.toBeNull()
    expect(section?.props.nonce).toBeUndefined()
  })
})
