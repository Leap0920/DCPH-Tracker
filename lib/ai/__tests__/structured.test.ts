import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  extractJson,
  generateStructured,
  parseAgainst,
  type StructuredCall,
} from "@/lib/ai/structured"

const Schema = z.object({
  intent: z.enum(["catalog", "lore", "smalltalk"]),
  characters: z.array(z.string()),
})

/** A call that returns the given responses in order and records the requests. */
function scriptedCall(
  responses: { text: string; finishReason?: string | null }[]
): { call: StructuredCall; requests: { mode: string }[] } {
  const requests: { mode: string }[] = []
  let index = 0
  const call: StructuredCall = async ({ mode }) => {
    requests.push({ mode })
    const response = responses[Math.min(index, responses.length - 1)]
    index += 1
    return { text: response.text, finishReason: response.finishReason ?? "stop" }
  }
  return { call, requests }
}

const VALID = '{"intent":"catalog","characters":["Haibara"]}'

describe("extractJson", () => {
  it("returns bare JSON unchanged", () => {
    expect(extractJson(VALID)).toBe(VALID)
  })

  it("strips a markdown fence", () => {
    expect(extractJson("```json\n" + VALID + "\n```")).toBe(VALID)
  })

  it("slices surrounding prose", () => {
    expect(extractJson("Sure! Here you go:\n" + VALID + "\nHope that helps.")).toBe(VALID)
  })
})

describe("parseAgainst", () => {
  it("accepts a valid payload", () => {
    const result = parseAgainst(Schema, VALID)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.characters).toEqual(["Haibara"])
  })

  it("distinguishes invalid JSON from a schema violation", () => {
    expect(parseAgainst(Schema, "not json").ok).toBe(false)
    const bad = parseAgainst(Schema, '{"intent":"nope","characters":[]}')
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.kind).toBe("schema")
      expect(bad.detail).toContain("intent")
    }
  })
})

describe("generateStructured", () => {
  it("returns on the first valid response and uses strict mode when supported", async () => {
    const { call, requests } = scriptedCall([{ text: VALID }])
    const result = await generateStructured({ schema: Schema, messages: [], call, strict: true })
    expect(result.value?.intent).toBe("catalog")
    expect(result.attempts).toBe(1)
    expect(requests[0].mode).toBe("strict")
  })

  it("uses json_object mode when the provider cannot enforce a schema", async () => {
    const { call, requests } = scriptedCall([{ text: VALID }])
    await generateStructured({ schema: Schema, messages: [], call, strict: false })
    expect(requests[0].mode).toBe("json_object")
  })

  it("repairs once after a schema violation, then succeeds", async () => {
    const { call, requests } = scriptedCall([
      { text: '{"intent":"nope","characters":[]}' },
      { text: VALID },
    ])
    const result = await generateStructured({ schema: Schema, messages: [], call, strict: false })
    expect(result.value?.intent).toBe("catalog")
    expect(result.attempts).toBe(2)
    expect(requests).toHaveLength(2)
  })

  it("re-runs truncation with a larger budget rather than repairing it", async () => {
    const { call, requests } = scriptedCall([
      { text: '{"intent":"catalog","char', finishReason: "length" },
      { text: VALID },
    ])
    const result = await generateStructured({ schema: Schema, messages: [], call, strict: false })
    expect(result.value).not.toBeNull()
    // A truncated payload is not repaired: closing the brace would fabricate
    // the characters the model never produced.
    expect(requests[1].mode).toBe("retry_truncated")
  })

  it("gives up with null after the attempt ceiling, never throwing", async () => {
    const { call, requests } = scriptedCall([{ text: '{"intent":"nope"}' }])
    const result = await generateStructured({ schema: Schema, messages: [], call, strict: false })
    expect(result.value).toBeNull()
    expect(result.reason).toBeTruthy()
    expect(result.attempts).toBe(3)
    expect(requests).toHaveLength(3)
  })
})
