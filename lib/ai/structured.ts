// lib/ai/structured.ts
import { z } from "zod"

/**
 * "strict"          - schema enforced by constrained decoding.
 * "json_object"     - provider guarantees JSON syntax only.
 * "retry_truncated" - the caller MUST raise its output budget for this one;
 *                     the previous attempt ran out of tokens mid-object.
 */
export type StructuredMode = "strict" | "json_object" | "retry_truncated"

export interface StructuredRequest {
  /** JSON Schema when the provider enforces one, null when it does not. */
  schema: Record<string, unknown> | null
  mode: StructuredMode
  messages: { role: "system" | "user" | "assistant"; content: string }[]
}

export interface StructuredResponse {
  text: string
  /** The provider's terminating signal. "length" means truncated. */
  finishReason: string | null
}

export type StructuredCall = (request: StructuredRequest) => Promise<StructuredResponse>

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "not-json" | "schema"; detail: string }

/** Strips a markdown fence or surrounding prose, leaving the JSON object. */
export function extractJson(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1].trim() : trimmed
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start === -1 || end === -1 || end < start) return body
  return body.slice(start, end + 1)
}

export function parseAgainst<T>(schema: z.ZodType<T>, raw: string): ParseResult<T> {
  let json: unknown
  try {
    json = JSON.parse(extractJson(raw))
  } catch (err) {
    return { ok: false, kind: "not-json", detail: (err as Error).message }
  }

  const result = schema.safeParse(json)
  if (result.success) return { ok: true, value: result.data }

  // One line per problem, in the form the repair turn sends back verbatim.
  const detail = result.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n")
  return { ok: false, kind: "schema", detail }
}

export interface GenerateStructuredArgs<T> {
  schema: z.ZodType<T>
  messages: { role: "system" | "user" | "assistant"; content: string }[]
  call: StructuredCall
  /** True when the provider does constrained decoding against a JSON schema. */
  strict: boolean
  /** Hard ceiling on model calls. Three is the researched maximum. */
  maxAttempts?: number
}

export interface GenerateStructuredResult<T> {
  value: T | null
  attempts: number
  reason?: string
}

const REPAIR_SYSTEM =
  "You fix malformed JSON. Return only the corrected JSON object. No prose, no code fence, no explanation."

/**
 * Structured output with a bounded repair ladder.
 *
 * The order matters and follows the researched playbook: check WHY the response
 * ended before trying to parse it. A truncated payload is re-run, never
 * repaired — closing an open brace invents values the model never produced and
 * launders a truncation into confident, wrong data. Only genuine syntax and
 * schema failures get the repair turn, which re-sends just the broken output
 * and the validator error rather than the original context.
 *
 * Returns null rather than throwing, so the caller makes a real decision
 * (degrade to the deterministic path) instead of catching a generic error.
 */
export async function generateStructured<T>({
  schema,
  messages,
  call,
  strict,
  maxAttempts = 3,
}: GenerateStructuredArgs<T>): Promise<GenerateStructuredResult<T>> {
  const jsonSchema = strict
    ? (z.toJSONSchema(schema, { io: "output" }) as Record<string, unknown>)
    : null

  let attempts = 0
  let lastRaw = ""
  let lastDetail = ""
  let retryAfterTruncation = false

  while (attempts < maxAttempts) {
    // A truncated response is re-run against the ORIGINAL prompt — the caller
    // raises its output budget when it sees mode "retry_truncated". Everything
    // else that failed gets one repair turn built from the validator's own
    // complaint. Deriving this from a flag rather than from the attempt index
    // keeps the two paths from colliding when a truncation happens twice.
    const isTruncationRetry = retryAfterTruncation
    const isRepair = !isTruncationRetry && lastDetail !== ""
    retryAfterTruncation = false

    const request: StructuredRequest = isRepair
      ? {
          schema: jsonSchema,
          mode: strict ? "strict" : "json_object",
          messages: [
            { role: "system", content: REPAIR_SYSTEM },
            { role: "user", content: `This output was rejected:\n\n${lastRaw}` },
            { role: "user", content: `The validator reported:\n\n${lastDetail}` },
          ],
        }
      : {
          schema: jsonSchema,
          mode: isTruncationRetry ? "retry_truncated" : strict ? "strict" : "json_object",
          messages,
        }

    attempts += 1
    const response = await call(request)
    lastRaw = response.text

    if (response.finishReason === "length") {
      // Signal the next iteration to re-run rather than repair: closing an
      // open brace would fabricate the values the model never produced.
      retryAfterTruncation = true
      lastDetail = ""
      continue
    }

    const parsed = parseAgainst(schema, response.text)
    if (parsed.ok) return { value: parsed.value, attempts }

    if (parsed.kind === "schema") {
      lastDetail = parsed.detail
    } else {
      lastDetail = `Output was not valid JSON: ${parsed.detail}`
    }
  }

  return { value: null, attempts, reason: lastDetail || "no valid structured response" }
}
