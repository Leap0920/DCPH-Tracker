/**
 * Binds `generateStructured`'s injected `StructuredCall` to one gateway, one
 * target list and one signal.
 *
 * The adapter is deliberately thin, and it holds no retry logic of its own:
 * `generateStructured` owns the repair ladder, because the decision it makes
 * depends on the parsed result, which only it has. What lives here is the
 * translation between the two vocabularies — a structured request's `mode` and
 * a gateway's `responseFormat` — and the one piece of state the ladder cannot
 * express: the raised output budget a truncation retry needs.
 */

import type { CompleteArgs, Gateway, ResponseFormat } from "@/lib/ai/gateway"
import type { StructuredCall, StructuredRequest } from "@/lib/ai/structured"
import type { ProviderTarget } from "@/lib/ai/targets"

/**
 * The registry's output ceiling (`ProviderTarget.maxOutputTokens`). A retry
 * cannot ask for more than any target is allowed to serve.
 */
export const TRUNCATION_OUTPUT_CAP = 2048

/** How much the output budget grows when an answer was cut off mid-object. */
export const DEFAULT_TRUNCATION_FACTOR = 1.5

export interface StructuredCallOptions {
  targets: ProviderTarget[]
  signal: AbortSignal
  /** The budget a normal (non-retry) call asks for; each target's own
   * `maxOutputTokens` is the fallback when this is absent. */
  maxOutputTokens?: number
  onTruncationFactor?: number
}

/**
 * The format a request wants, as far as this adapter can know it.
 *
 * `retry_truncated` re-runs the original prompt, so it keeps the original
 * format and only the budget changes. Which target will actually serve the
 * call is the gateway's decision, so the per-target downgrade to
 * `json_object` happens there; the one thing worth doing here is not asking
 * for a schema no bound target can enforce, which keeps the recorded request
 * honest rather than aspirational.
 */
function formatFor(request: StructuredRequest, targets: ProviderTarget[]): ResponseFormat {
  if (request.mode === "json_object" || request.schema === null) return { type: "json_object" }
  if (!targets.some((target) => target.supportsJsonSchema)) return { type: "json_object" }
  return { type: "json_schema", schema: request.schema }
}

export function toStructuredCall(gateway: Gateway, options: StructuredCallOptions): StructuredCall {
  const factor = options.onTruncationFactor ?? DEFAULT_TRUNCATION_FACTOR

  return async (request) => {
    // The retry's whole purpose is more room for the same answer, so the budget
    // is the only thing it changes — and it is capped at what a target may be
    // asked to produce. An absent budget means the cap already.
    const maxOutputTokens =
      request.mode === "retry_truncated"
        ? Math.min(TRUNCATION_OUTPUT_CAP, Math.round((options.maxOutputTokens ?? TRUNCATION_OUTPUT_CAP) * factor))
        : options.maxOutputTokens

    const args: CompleteArgs = {
      messages: request.messages,
      targets: options.targets,
      signal: options.signal,
      responseFormat: formatFor(request, options.targets),
      maxOutputTokens,
    }
    const result = await gateway.complete(args)

    // A dead provider is not this adapter's to repair: an empty text routes
    // into the ladder's failure path instead of parsing whatever was left
    // behind, and a null finish reason keeps "unknown" distinct from "complete".
    if (!result.ok) return { text: "", finishReason: null }

    return { text: result.text, finishReason: result.finishReason }
  }
}
