import "server-only"
import { initialTargetState, type TargetState } from "@/lib/ai/circuit"
import { classifyFailure, type FailureDecision } from "@/lib/ai/failure"
import { createProviderHealth, type ProviderHealth } from "@/lib/ai/provider-health"
import { createQuotaTracker, type QuotaTracker } from "@/lib/ai/quota"
import { createSseParser } from "@/lib/ai/sse"
import type { ProviderTarget } from "@/lib/ai/targets"

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface AttemptOutcome {
  targetId: string
  outcome: string
  status?: number | null
  ms: number
}

export interface StreamChatResult {
  ok: boolean
  targetId: string | null
  attempts: AttemptOutcome[]
  textChars: number
  /** The model hit its output ceiling. */
  truncated: boolean
  /** The connection died after text was already emitted. */
  midStreamFailure: boolean
  /** Every attempt that reached a provider was rate limited. */
  rateLimited: boolean
  aborted: boolean
}

export interface StreamChatArgs {
  messages: ChatMessage[]
  targets: ProviderTarget[]
  signal: AbortSignal
  onDelta: (text: string) => void
  onReasoning?: (text: string) => void
  temperature?: number
  maxOutputTokens?: number
  /** Ceiling for connect + first token. A free tier that has not started
   * streaming in this long will not serve this request well. */
  firstTokenTimeoutMs?: number
  /** Ceiling for the whole streamed body. */
  streamTimeoutMs?: number
}

/**
 * The decoded output shape a caller wants back, expressed as an intent rather
 * than a wire format: the gateway decides what the selected target can honour.
 */
export type ResponseFormat =
  | { type: "json_schema"; schema: Record<string, unknown> }
  | { type: "json_object" }
  | null

export interface CompleteArgs {
  messages: ChatMessage[]
  targets: ProviderTarget[]
  signal: AbortSignal
  responseFormat?: ResponseFormat
  temperature?: number
  maxOutputTokens?: number
  /** Ceiling for the whole request and its body. A free tier that has not
   * answered in this long is worth abandoning for the next target. */
  requestTimeoutMs?: number
}

export interface CompleteResult {
  ok: boolean
  targetId: string | null
  attempts: AttemptOutcome[]
  text: string
  /** The provider's terminating signal; "length" means the answer was truncated. */
  finishReason: string | null
  rateLimited: boolean
  aborted: boolean
}

export interface GatewayDeps {
  fetchImpl?: typeof fetch
  health?: ProviderHealth
  quota?: QuotaTracker
  now?: () => number
}

export interface Gateway {
  streamChat(args: StreamChatArgs): Promise<StreamChatResult>
  complete(args: CompleteArgs): Promise<CompleteResult>
}

/** `gateway.complete` unbound, for callers that inject a model call. */
export type CompleteFn = (args: CompleteArgs) => Promise<CompleteResult>

const DEFAULT_FIRST_TOKEN_MS = 4_000
const DEFAULT_STREAM_MS = 30_000
const DEFAULT_REQUEST_MS = 15_000

function readRetryAfter(response: Response): number | null {
  const raw = response.headers.get("retry-after")
  if (!raw) return null
  const seconds = Number(raw)
  return Number.isFinite(seconds) ? seconds : null
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return (error as { name?: string } | undefined)?.name === "AbortError" || signal.aborted
}

/** Reason string used to mark a stream that never produced its first token. */
const FIRST_TOKEN_TIMEOUT = "first token timeout"

/**
 * Reads one chunk with a deadline.
 *
 * The timer is cleared on the happy path: an armed-but-unresolved timer per
 * chunk would accumulate across a long stream. The caller must cancel the
 * reader when this rejects, because the underlying read is still pending and
 * releasing a reader that has a pending read throws.
 */
async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`no token within ${ms}ms`)
          error.name = "TimeoutError"
          reject(error)
        }, ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * The credential and provider headers every request carries.
 *
 * Shared by both transports deliberately: two copies of an auth header is how
 * one transport ends up talking to a provider with the wrong key, or with the
 * OpenRouter attribution pair missing, and the failure looks like a provider
 * outage rather than a bug. `Accept` is the one part each transport chooses.
 */
function requestHeaders(target: ProviderTarget, accept: string): Record<string, string> {
  return {
    Authorization: `Bearer ${target.apiKey}`,
    "Content-Type": "application/json",
    Accept: accept,
    ...(target.headers ?? {}),
  }
}

/**
 * What the target can actually honour. Schema-enforced decoding is a per-target
 * capability; a caller asking for `json_schema` against the rest of the fleet
 * gets syntax-only mode, which is the most those providers will do.
 */
function wireResponseFormat(
  format: ResponseFormat | undefined,
  target: ProviderTarget
): Record<string, unknown> | undefined {
  if (!format) return undefined
  if (format.type === "json_object" || !target.supportsJsonSchema) return { type: "json_object" }
  return {
    type: "json_schema",
    json_schema: { name: "response", schema: format.schema, strict: true },
  }
}

interface ChatRequestBody {
  target: ProviderTarget
  messages: ChatMessage[]
  temperature: number
  maxOutputTokens?: number
  stream: boolean
  responseFormat?: ResponseFormat
}

/**
 * The body both transports send, built in one place. `stream` is the only
 * structural difference between them, so a renamed field or a new decoding knob
 * cannot land on one transport and miss the other.
 */
function buildChatBody(input: ChatRequestBody): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.target.model,
    stream: input.stream,
    temperature: input.temperature,
    max_tokens: input.maxOutputTokens ?? input.target.maxOutputTokens,
    messages: input.messages,
  }

  const format = wireResponseFormat(input.responseFormat, input.target)
  if (format !== undefined) body.response_format = format

  return body
}

/** What one attempt starts with, or why it never started. */
type AttemptStart =
  | { kind: "circuit_open" }
  | { kind: "quota_exhausted" }
  | { kind: "ready"; state: TargetState; startedAt: number }

/**
 * The prologue every attempt shares: circuit check, then daily budget, in that
 * order. Checking the budget first would spend quota on a target that is going
 * to be skipped anyway, so both transports call this and record its outcome
 * with the same string.
 */
async function beginAttempt(input: {
  target: ProviderTarget
  states: Map<string, TargetState>
  health: ProviderHealth
  quota: QuotaTracker
  now: () => number
}): Promise<AttemptStart> {
  const { target, states, health, quota, now } = input
  const startedAt = now()
  const state = states.get(target.id) ?? initialTargetState(target.id)

  if (!health.isAvailable(state, startedAt)) return { kind: "circuit_open" }
  if (!(await quota.consume(target.id, target.dailyRequestBudget))) return { kind: "quota_exhausted" }

  return { kind: "ready", state, startedAt }
}

/**
 * The caller's signal and the request deadline, combined but not merged.
 *
 * Only the caller's signal ends the call: an abort is the user leaving, while a
 * deadline is one slow provider and costs exactly one attempt. `timedOut()`
 * distinguishes them after fetch rejects with an AbortError for either reason.
 */
function createDeadline(signal: AbortSignal, ms: number): {
  signal: AbortSignal
  timedOut: () => boolean
  stop: () => void
} {
  const controller = new AbortController()
  let timedOut = false

  const onAbort = () => controller.abort()
  signal.addEventListener("abort", onAbort, { once: true })
  // The caller may have aborted while this attempt was waiting for the quota.
  if (signal.aborted) controller.abort()

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, ms)

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    stop() {
      clearTimeout(timer)
      signal.removeEventListener("abort", onAbort)
    },
  }
}

interface CompletionChoice {
  message?: { content?: unknown } | null
  finish_reason?: unknown
}

/** The first choice, or null for a body that carries none. */
function firstChoice(payload: unknown): CompletionChoice | null {
  const choices = (payload as { choices?: unknown } | null | undefined)?.choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const choice = choices[0] as unknown
  return typeof choice === "object" && choice !== null ? (choice as CompletionChoice) : null
}

/** Reason string used to mark an attempt that outlived its deadline. */
const REQUEST_TIMEOUT = "request timeout"

/** A deadline classifies the same way whatever the transport threw for it. */
const TIMEOUT_DECISION: FailureDecision = classifyFailure({ error: { name: "TimeoutError" } })

function abortResult(attempts: AttemptOutcome[]): CompleteResult {
  return {
    ok: false,
    targetId: null,
    attempts,
    text: "",
    finishReason: null,
    rateLimited: false,
    aborted: true,
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Streaming failover across provider targets.
 *
 * Ordering respects circuit state and daily budgets before spending a request.
 * The behaviour that matters most is what happens after text has started
 * flowing: failover is abandoned, because switching provider mid-sentence
 * would stitch two different answers together. The partial answer is kept and
 * flagged, and the UI offers regenerate.
 */
export function createGateway(deps: GatewayDeps = {}): Gateway {
  const fetchImpl = deps.fetchImpl ?? fetch
  const health = deps.health ?? createProviderHealth()
  const quota = deps.quota ?? createQuotaTracker()
  const now = deps.now ?? Date.now

  return {
    async streamChat({
      messages,
      targets,
      signal,
      onDelta,
      onReasoning,
      temperature = 0.1,
      maxOutputTokens,
      firstTokenTimeoutMs = DEFAULT_FIRST_TOKEN_MS,
      streamTimeoutMs = DEFAULT_STREAM_MS,
    }) {
      const attempts: AttemptOutcome[] = []
      let rateLimited = false

      const states = await health.load(targets.map((t) => t.id))

      for (const target of targets) {
        if (signal.aborted) {
          return {
            ok: false,
            targetId: null,
            attempts,
            textChars: 0,
            truncated: false,
            midStreamFailure: false,
            rateLimited: false,
            aborted: true,
          }
        }

        const start = await beginAttempt({ target, states, health, quota, now })
        if (start.kind !== "ready") {
          attempts.push({ targetId: target.id, outcome: start.kind, ms: 0 })
          continue
        }
        const { state, startedAt } = start

        let response: Response
        try {
          response = await fetchImpl(target.url, {
            method: "POST",
            headers: requestHeaders(target, "text/event-stream"),
            body: JSON.stringify(buildChatBody({ target, messages, temperature, maxOutputTokens, stream: true })),
            signal,
          })
        } catch (error) {
          if (isAbort(error, signal)) {
            return {
              ok: false,
              targetId: null,
              attempts,
              textChars: 0,
              truncated: false,
              midStreamFailure: false,
              rateLimited: false,
              aborted: true,
            }
          }
          const decision = classifyFailure({ error })
          await health.recordFailure(state, decision)
          attempts.push({
            targetId: target.id,
            outcome: decision.kind,
            status: null,
            ms: now() - startedAt,
          })
          continue
        }

        if (!response.ok || !response.body) {
          const decision = classifyFailure({
            status: response.status,
            retryAfterSeconds: readRetryAfter(response),
          })
          if (decision.kind === "rate_limited") {
            rateLimited = true
          }
          await health.recordFailure(state, decision, response.status)
          attempts.push({
            targetId: target.id,
            outcome: decision.kind,
            status: response.status,
            ms: now() - startedAt,
          })
          // Drain the body so the connection can be reused rather than
          // left half-read.
          await response.text().catch(() => "")
          continue
        }

        const parser = createSseParser()
        const decoder = new TextDecoder()
        const reader = response.body.getReader()
        const deadline = startedAt + streamTimeoutMs
        let textChars = 0
        let truncated = false
        let midStreamFailure = false
        let streamError: string | null = null
        let firstTokenSeen = false

        try {
          for (;;) {
            if (now() > deadline) {
              truncated = true
              streamError = "stream timeout"
              break
            }

            const budgetMs = firstTokenSeen
              ? deadline - now()
              : Math.min(firstTokenTimeoutMs, deadline - now())
            const read = await readWithTimeout(reader, Math.max(1, budgetMs))

            if (read.done) break
            if (!read.value) continue

            for (const frame of parser.push(decoder.decode(read.value, { stream: true }))) {
              if (frame.error) {
                streamError = frame.error
                continue
              }
              if (frame.finishReason === "length") truncated = true
              if (frame.reasoning) onReasoning?.(frame.reasoning)
              if (frame.delta) {
                firstTokenSeen = true
                textChars += frame.delta.length
                onDelta(frame.delta)
              }
            }
          }

          for (const frame of parser.flush()) {
            if (frame.finishReason === "length") truncated = true
            if (frame.reasoning) onReasoning?.(frame.reasoning)
            if (frame.delta) {
              textChars += frame.delta.length
              onDelta(frame.delta)
            }
          }
        } catch (error) {
          if (isAbort(error, signal)) {
            return {
              ok: false,
              targetId: null,
              attempts,
              textChars,
              truncated,
              midStreamFailure: false,
              rateLimited: false,
              aborted: true,
            }
          }
          if ((error as { name?: string }).name === "TimeoutError") {
            truncated = true
            streamError = FIRST_TOKEN_TIMEOUT
            // The deadline fired while a read was still pending. Releasing a
            // reader in that state throws, so cancel the stream first — the
            // provider is going to be dropped anyway.
            await reader.cancel().catch(() => {})
          } else {
            midStreamFailure = true
            streamError = (error as Error).message
          }
        } finally {
          try {
            reader.releaseLock()
          } catch {
            // Already released, or cancelled above by the timeout path.
          }
        }

        // A provider that produced usable text has succeeded, even if it was
        // cut short: the partial answer is preserved and flagged instead of
        // being replaced by a different provider's attempt.
        if (textChars > 0) {
          await health.recordSuccess(state)
          attempts.push({
            targetId: target.id,
            outcome: midStreamFailure || truncated ? "partial" : "ok",
            status: 200,
            ms: now() - startedAt,
          })
          return {
            ok: true,
            targetId: target.id,
            attempts,
            textChars,
            truncated: truncated || midStreamFailure,
            midStreamFailure,
            rateLimited: false,
            aborted: false,
          }
        }

        // Distinguishing the two zero-text outcomes matters: a first-token
        // timeout is a latency fault the next target may not share, while an
        // empty `length` finish is the "spent the whole budget thinking"
        // failure that took the bot down before.
        const decision: FailureDecision =
          streamError === FIRST_TOKEN_TIMEOUT
            ? classifyFailure({ error: { name: "TimeoutError" } })
            : classifyFailure({
                status: 200,
                finishReason: truncated ? "length" : "stop",
                textChars: 0,
              })
        await health.recordFailure(
          { ...state, lastError: streamError },
          decision,
          200
        )
        attempts.push({
          targetId: target.id,
          outcome: decision.kind,
          status: 200,
          ms: now() - startedAt,
        })
      }

      return {
        ok: false,
        targetId: null,
        attempts,
        textChars: 0,
        truncated: false,
        midStreamFailure: false,
        rateLimited,
        aborted: false,
      }
    },

    /**
     * One non-streaming completion, with the same failover policy as the
     * streaming path: the same ordering, the same failure classes, the same
     * circuit and the same budget.
     *
     * It is a separate loop because everything after target selection differs —
     * a stream has partial text and a reader to cancel, a completion has a JSON
     * body and a `finish_reason` to report. Folding them into one loop would
     * mean rewriting the streaming path, whose behaviour is frozen.
     *
     * Unlike the streaming path this never returns partial text: without
     * deltas, a failure before the body is parsed has produced nothing, and an
     * answer that took the whole budget thinking is `empty_output`, not a
     * partial success.
     */
    async complete({
      messages,
      targets,
      signal,
      responseFormat,
      temperature = 0.1,
      maxOutputTokens,
      requestTimeoutMs = DEFAULT_REQUEST_MS,
    }) {
      const attempts: AttemptOutcome[] = []
      let rateLimited = false

      // Checked before the target list is even read: a cancelled caller must
      // not spend a request, and must get the same shape of answer whether the
      // list was empty or not.
      if (signal.aborted) return abortResult(attempts)

      const states = await health.load(targets.map((t) => t.id))

      for (const target of targets) {
        if (signal.aborted) return abortResult(attempts)

        const start = await beginAttempt({ target, states, health, quota, now })
        if (start.kind !== "ready") {
          attempts.push({ targetId: target.id, outcome: start.kind, ms: 0 })
          continue
        }
        const { state, startedAt } = start

        const deadline = createDeadline(signal, requestTimeoutMs)

        try {
          let response: Response
          try {
            response = await fetchImpl(target.url, {
              method: "POST",
              headers: requestHeaders(target, "application/json"),
              body: JSON.stringify(
                buildChatBody({ target, messages, temperature, maxOutputTokens, stream: false, responseFormat })
              ),
              signal: deadline.signal,
            })
          } catch (error) {
            if (signal.aborted) return abortResult(attempts)
            const timedOut = deadline.timedOut()
            const decision = timedOut ? TIMEOUT_DECISION : classifyFailure({ error })
            await health.recordFailure(
              { ...state, lastError: timedOut ? REQUEST_TIMEOUT : messageOf(error) },
              decision
            )
            attempts.push({
              targetId: target.id,
              outcome: decision.kind,
              status: null,
              ms: now() - startedAt,
            })
            continue
          }

          // The abort can land between the response arriving and this line.
          // The caller asked us to stop, so the body is not read at all.
          if (signal.aborted) return abortResult(attempts)

          if (!response.ok) {
            const decision = classifyFailure({
              status: response.status,
              retryAfterSeconds: readRetryAfter(response),
            })
            if (decision.kind === "rate_limited") rateLimited = true
            await health.recordFailure(state, decision, response.status)
            attempts.push({
              targetId: target.id,
              outcome: decision.kind,
              status: response.status,
              ms: now() - startedAt,
            })
            // Drain the body so the connection can be reused rather than
            // left half-read.
            await response.text().catch(() => "")
            continue
          }

          let payload: unknown
          try {
            payload = await response.json()
          } catch (error) {
            if (signal.aborted) return abortResult(attempts)
            const timedOut = deadline.timedOut()
            const decision = timedOut ? TIMEOUT_DECISION : classifyFailure({ error })
            await health.recordFailure(
              { ...state, lastError: timedOut ? REQUEST_TIMEOUT : messageOf(error) },
              decision,
              response.status
            )
            attempts.push({
              targetId: target.id,
              outcome: decision.kind,
              status: response.status,
              ms: now() - startedAt,
            })
            continue
          }

          const choice = firstChoice(payload)
          const text = typeof choice?.message?.content === "string" ? choice.message.content : ""
          // Absent means the provider did not say. Defaulting it to "stop"
          // would tell the repair ladder a truncated answer was complete.
          const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : null

          if (text === "") {
            // A 200 with nothing in it is the empty_output failure, exactly as
            // in the streaming path. Recording it as a success would keep a
            // model that never answers in rotation.
            const decision = classifyFailure({ status: 200, finishReason, textChars: 0 })
            await health.recordFailure(state, decision, response.status)
            attempts.push({
              targetId: target.id,
              outcome: decision.kind,
              status: response.status,
              ms: now() - startedAt,
            })
            continue
          }

          await health.recordSuccess(state)
          attempts.push({
            targetId: target.id,
            outcome: "ok",
            status: response.status,
            ms: now() - startedAt,
          })
          return {
            ok: true,
            targetId: target.id,
            attempts,
            text,
            finishReason,
            rateLimited: false,
            aborted: false,
          }
        } finally {
          deadline.stop()
        }
      }

      return {
        ok: false,
        targetId: null,
        attempts,
        text: "",
        finishReason: null,
        rateLimited,
        aborted: false,
      }
    },
  }
}
