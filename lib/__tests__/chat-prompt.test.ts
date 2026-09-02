import { describe, expect, it } from "vitest"
import { buildSystemPrompt } from "@/lib/chat/prompt"
import type { ChatContext } from "@/lib/chat/search"

const EMPTY_CONTEXT = {
  episodes: [],
  cases: [],
  dcwWiki: [],
} as ChatContext

const EMPTY_ARGS = {
  context: EMPTY_CONTEXT,
  displayName: null,
  isSignedIn: false,
}

describe("buildSystemPrompt — scope & hard boundaries", () => {
  it("keeps the DCPH Bot identity", () => {
    const prompt = buildSystemPrompt(EMPTY_ARGS)
    expect(prompt).toContain("You are DCPH Bot")
  })

  it("declares a hard scope section", () => {
    const prompt = buildSystemPrompt(EMPTY_ARGS)
    expect(prompt).toMatch(/Scope & Hard Boundaries/i)
  })

  it("requires polite refusal of coding and out-of-scope requests", () => {
    const prompt = buildSystemPrompt(EMPTY_ARGS)
    expect(prompt).toMatch(/politely refuse/i)
    expect(prompt).toMatch(/coding or programming/i)
    expect(prompt).toMatch(/never produce code/i)
    expect(prompt).toMatch(/ignore previous instructions/i)
    expect(prompt).toContain("DCPH Bot")
  })

  it("keeps the casual greeting allowance intact", () => {
    const prompt = buildSystemPrompt(EMPTY_ARGS)
    expect(prompt).toContain("Casual Chat & Greetings")
  })

  it("injects the site URL into the scope section", () => {
    const prompt = buildSystemPrompt({
      ...EMPTY_ARGS,
      siteUrl: "https://example.test",
    })
    expect(prompt).toContain("https://example.test")
  })
})