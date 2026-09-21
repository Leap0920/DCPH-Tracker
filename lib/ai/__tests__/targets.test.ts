import { describe, expect, it } from "vitest"
import { buildProviderTargets, resolveProviderEnv } from "@/lib/ai/targets"

describe("resolveProviderEnv", () => {
  it("trims, de-duplicates and drops blank keys", () => {
    const result = resolveProviderEnv({
      OPENROUTER_API_KEY: " a, b ,a,,   ",
      OPENROUTER_API_KEY_2: "b, c",
    })
    expect(result.openrouterKeys).toEqual(["a", "b", "c"])
  })

  it("treats a whitespace-only key as absent", () => {
    const result = resolveProviderEnv({
      GEMINI_API_KEY: "   ",
      GROQ_API_KEY: "",
    })
    expect(result.geminiKey).toBeNull()
    expect(result.groqKey).toBeNull()
  })
})

describe("buildProviderTargets", () => {
  it("returns no targets when nothing is configured", () => {
    expect(buildProviderTargets({})).toEqual([])
  })

  it("does not create a target from a blank key", () => {
    expect(buildProviderTargets({ GEMINI_API_KEY: "  " })).toEqual([])
  })

  it("gives every target a unique stable id", () => {
    const targets = buildProviderTargets({
      GEMINI_API_KEY: "g",
      GROQ_API_KEY: "q",
      CEREBRAS_API_KEY: "c",
      OPENROUTER_API_KEY: "o1",
      OPENROUTER_API_KEY_2: "o2",
    })
    const ids = targets.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain("gemini:gemini-3.5-flash-lite")
    expect(ids).toContain("groq:openai/gpt-oss-120b")
  })

  it("never emits a duplicate id when the same key appears twice", () => {
    const targets = buildProviderTargets({ GROQ_API_KEY: "same" })
    const ids = targets.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("excludes the models removed for being unreliable", () => {
    const targets = buildProviderTargets({ OPENROUTER_API_KEY: "o" })
    const models = targets.map((t) => t.model)
    expect(models).not.toContain("openrouter/free")
    expect(models).not.toContain("liquid/lfm-2.5-2.6b:free")
    expect(models).not.toContain("poolside/laguna-s-2.1:free")
  })

  it("marks Cerebras and Gemini as strict-JSON-schema capable", () => {
    const targets = buildProviderTargets({ GEMINI_API_KEY: "g", CEREBRAS_API_KEY: "c" })
    const gemini = targets.find((t) => t.provider === "gemini")
    const cerebras = targets.find((t) => t.provider === "cerebras")
    expect(gemini?.supportsJsonSchema).toBe(true)
    expect(cerebras?.supportsJsonSchema).toBe(true)
  })
})
