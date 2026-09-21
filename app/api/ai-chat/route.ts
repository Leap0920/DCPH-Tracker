// app/api/ai-chat/route.ts
import { after } from "next/server"
import { createUIMessageStream, createUIMessageStreamResponse } from "ai"
import { createClient } from "@/utils/supabase/server"
import { getUserWatchHistory, searchAll } from "@/lib/chat/search"
import { buildSystemPrompt } from "@/lib/chat/prompt"
import {
  REFUSAL_NO_CONTEXT,
  classifyChatIntent,
  shouldRefuseForMissingContext,
} from "@/lib/chat/intent"
import { buildProviderTargets } from "@/lib/ai/targets"
import { createGateway, type ChatMessage, type StreamChatResult } from "@/lib/ai/gateway"
import { validateCitations } from "@/lib/ai/citations"
import { isMemoryRecallQuestion } from "@/lib/ai/memory/recall"
import { pipelineVersion, runPipeline, type PipelineResult } from "@/lib/ai/pipeline"
import {
  EMPTY_RESULT_REASON,
  PARTS,
  PARTIAL_ANSWER_REASON,
  RATE_LIMITED_REASON,
  RETRIEVAL_FAILED_REASON,
  SCREENED_REASON,
  UNCITED_REASON,
  buildActivityPart,
  buildCitationsPart,
  buildDegradedPart,
  buildEvidencePart,
} from "@/lib/ai/stream/protocol"
import type { AdminRowsClient, ResolverClient } from "@/lib/ai/pipeline/source-resolver"
import { toStructuredCall } from "@/lib/ai/structured-call"
import { logRequest } from "@/lib/ai/request-log"
import { rateLimitPersistent } from "@/lib/rate-limit-db"
import {
  createRequestPersistence,
  type PersistedTurn,
  type RequestPersistence,
} from "@/lib/chat/persistence"
import { withTimeout } from "@/lib/request-timeout"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// A ceiling for the platform, not the working limit: the route enforces its own
// shorter budget below, so a long answer is labelled as cut short by us rather
// than being killed by the platform with no explanation.
export const maxDuration = 60

const MAX_MESSAGE_CHARS = 1000
const MAX_HISTORY_MESSAGES = 8
const MAX_BODY_BYTES = 16_000

/** Whole-request deadline, deliberately below `maxDuration`. */
const TOTAL_BUDGET_MS = 45_000

/**
 * The ceiling on each transcript read the pre-stream path makes (rule 7). The
 * store owns every database detail behind the persistence seam, so a slow
 * database has one cost here: the client's own history is used instead.
 */
const PERSISTENCE_TIMEOUT_MS = 400

const RATE_LIMIT = { limit: 20, windowMs: 5 * 60 * 1000 }

const EMPTY_RESULT_MESSAGE =
  "I could not find a reliable answer for that. Try naming the episode number, movie number, or character you mean."
const RATE_LIMITED_MESSAGE =
  "All free AI providers are temporarily at capacity. Please try again in a moment."
const PARTIAL_RESULT_SUFFIX = "\n\n_(The response was cut short. Ask again to retry.)_"

/** The one text part's id: stable, so every delta lands in the same part. */
const ANSWER_PART_ID = "answer"

type ChatRole = "user" | "assistant"
interface ChatTurn {
  role: ChatRole
  content: string
}

/**
 * History is accepted from the client but treated as untrusted: it is only
 * ever replayed as conversational context, and roles are restricted so a
 * caller cannot inject a `system` turn. It is also the fallback now that a
 * server-owned transcript exists: whenever the transcript is unavailable — no
 * service-role key, a degraded read, or a caller-supplied id the user does not
 * own — this is what the model gets, exactly as before.
 */
function sanitizeHistory(input: unknown): ChatTurn[] {
  if (!Array.isArray(input)) return []
  const turns: ChatTurn[] = []

  for (const item of input) {
    if (!item || typeof item !== "object") continue
    const { role, content } = item as { role?: unknown; content?: unknown }
    if (role !== "user" && role !== "assistant") continue
    if (typeof content !== "string") continue
    const trimmed = content.trim()
    if (!trimmed) continue
    turns.push({ role, content: trimmed.slice(0, MAX_MESSAGE_CHARS) })
  }

  return turns.slice(-MAX_HISTORY_MESSAGES)
}

function jsonError(message: string, status: number, extraHeaders?: HeadersInit) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...(extraHeaders ?? {}) },
  })
}

/**
 * The route's plain-text 200: a refusal, and now a memory answer. Both are
 * complete answers the route already has in hand, so neither streams and both
 * carry the same no-cache headers.
 */
function refusalResponse(reply: string): Response {
  return new Response(reply, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}

/** Same-origin guard: this is the only route that spends money on inference. */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")
  // Non-browser clients (curl, native apps) send no Origin; they still face
  // auth and rate limiting, so absence is not treated as hostile.
  if (!origin) return true
  // A constructed Request carries no Host header — undici adds it at send
  // time — so the URL is the fallback. Behind a proxy the URL host is also the
  // more trustworthy of the two.
  const expectedHost = request.headers.get("host") ?? new URL(request.url).host
  try {
    return new URL(origin).host === expectedHost
  } catch {
    return false
  }
}

/**
 * Registers the post-response work with Next's `after`, and falls back to a
 * plain fire-and-forget call when `after` throws because there is no request
 * scope (unit tests, or any non-Next caller). Either way the work runs exactly
 * once — it must not be dropped because the registration mechanism was
 * unavailable — and a rejection cannot surface, because `after()` has no error
 * boundary of its own.
 */
function scheduleAfter(work: Promise<void>): void {
  const guarded = work.catch(() => {})
  try {
    after(() => guarded)
  } catch {
    void guarded
  }
}

/** The pipeline's narration, prefixed like every other line this route writes. */
function pipelineLog(line: string): void {
  console.error(`[ai-chat] ${line}`)
}

/**
 * The one degraded reason `ai_request_log` records, in precedence order.
 *
 * A failed retrieval says more than anything the request did afterwards, then
 * the pipeline's own reason (the corpus fallback, a stage budget, eviction), the
 * screening's exclusions (D4), and finally an evidence-backed answer that cited
 * nothing valid (D3). v1 keeps today's `retrieval_failed`-or-null behaviour.
 */
function degradedReasonFor(input: {
  retrievalFailed: boolean
  pipeline: PipelineResult | null
  uncited: boolean
}): string | null {
  if (input.retrievalFailed) return "retrieval_failed"
  if (input.pipeline === null) return null
  if (input.pipeline.degraded !== null) return input.pipeline.degraded
  if (input.pipeline.screening.excluded.length > 0) return "screened"
  return input.uncited ? "uncited" : null
}

/**
 * The degrade reasons the reader is told about before the model is called, in
 * `degradedReasonFor`'s order: retrieval's failure, the pipeline's own reason,
 * the screening's exclusions.
 *
 * This is the union where `degradedReasonFor` is the precedence ladder: the log
 * records the one reason that says most, while the UI shows every reason that
 * applies, so a request that both lost its corpus and dropped a document is not
 * silently reported as one of the two.
 */
function preAnswerDegradedReasons(input: {
  retrievalFailed: boolean
  pipeline: PipelineResult | null
}): string[] {
  const reasons: string[] = []
  if (input.retrievalFailed) reasons.push(RETRIEVAL_FAILED_REASON)
  if (input.pipeline !== null) {
    if (input.pipeline.degraded !== null) reasons.push(input.pipeline.degraded)
    if (input.pipeline.screening.excluded.length > 0) reasons.push(SCREENED_REASON)
  }
  return reasons
}

/**
 * The degrade reasons that only exist once the answer does: `uncited` is a
 * verdict on the finished text, and the synthetic token names why the stream
 * ended. Both are written as a `degraded` part after the text, so the client
 * must apply a late part to the message it just rendered (Task 4).
 *
 * A synthetic token displaces `uncited` rather than joining it. `uncited` means
 * "evidence was supplied and the answer cited none of it", which is a fact about
 * an answer; when the stream ended in one of our own sentences there is no model
 * answer to judge, and `validateCitations` reports `uncited` only because it was
 * handed the empty accumulator. Reporting both would badge a rate-limited turn
 * as an uncited one. The log is unaffected: its `outcome` column already names
 * the synthetic state, so nothing is lost by not repeating it here.
 */
function lateDegradedReasons(input: { uncited: boolean; synthetic: string | null }): string[] {
  if (input.synthetic !== null) return [input.synthetic]
  return input.uncited ? [UNCITED_REASON] : []
}

export async function POST(request: Request) {
  const targets = buildProviderTargets()
  if (targets.length === 0) {
    return jsonError("Chat is not configured on this server.", 500)
  }

  if (!isSameOrigin(request)) {
    return jsonError("Cross-origin requests are not allowed.", 403)
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return jsonError("Request body too large.", 413)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError("Invalid JSON body.", 400)
  }

  const { message, history, conversationId } = (body ?? {}) as {
    message?: unknown
    history?: unknown
    conversationId?: unknown
  }
  if (typeof message !== "string" || !message.trim()) {
    return jsonError("A non-empty `message` is required.", 400)
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return jsonError(`Message too long (max ${MAX_MESSAGE_CHARS} characters).`, 400)
  }

  const userMessage = message.trim()
  const clientHistory = sanitizeHistory(history)
  // An empty string is a client that sent the field with nothing in it; it
  // means "no id", exactly as the store reads it.
  const requestedConversationId =
    typeof conversationId === "string" && conversationId ? conversationId : undefined

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return jsonError("Please sign in to chat with DCPH Bot.", 401)
  }

  const limited = await rateLimitPersistent(`ai-chat:user:${user.id}`, RATE_LIMIT)
  if (!limited.allowed) {
    return jsonError(
      `You are sending messages too quickly. Try again in ${limited.retryAfterSeconds}s.`,
      429,
      { "Retry-After": String(limited.retryAfterSeconds) }
    )
  }

  const intent = classifyChatIntent(userMessage)
  if (intent.action === "refuse") {
    return refusalResponse(intent.reply)
  }

  // Read once, before any retrieval work: the rollback is a decision about
  // this request, and `runPipeline` reads the same variable to make the same
  // one. `v1` is the only value that selects the old path (constraint 11).
  const version = pipelineVersion(process.env)

  const userId = user.id
  let displayName: string | null = null
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, username")
      .eq("user_id", user.id)
      .maybeSingle()
    displayName = profile?.display_name ?? profile?.username ?? null
  } catch {
    // Non-fatal profile lookup error
  }

  // The transcript, when there is one. Every call is bounded and every failure
  // degrades to the client's own history: a conversation problem must never
  // cost an answer (constraint 14).
  let persistence: RequestPersistence | null = null
  try {
    persistence = await withTimeout(
      createRequestPersistence({ userId, conversationId: requestedConversationId }),
      PERSISTENCE_TIMEOUT_MS
    )
  } catch (error) {
    console.error("[ai-chat] transcript unavailable, using the client's history", error)
  }
  const activePersistence = persistence

  // Rule 6: a question about what the bot remembers OF THE USER is answered
  // from the memory table rather than by the model, because a listing is data,
  // not generation. The matcher is narrow by construction -- it rejects any
  // question naming a tracker noun -- so "what do you remember about episode 5"
  // still reaches retrieval, and the read is bounded like every other pre-stream
  // read: a slow database means the normal pipeline, never a stalled response.
  if (activePersistence !== null && isMemoryRecallQuestion(userMessage)) {
    try {
      const answer = await withTimeout(activePersistence.recallAnswer(), PERSISTENCE_TIMEOUT_MS)
      // "" is the seam's "memory is off". An empty body would read as a broken
      // answer, so the turn goes to the model instead.
      if (answer !== "") return refusalResponse(answer)
    } catch (error) {
      console.error("[ai-chat] memory recall unavailable, using the normal pipeline", error)
    }
  }

  let windowTurns: PersistedTurn[] | null = null
  let conversationSummary: string | undefined
  let memoryBlock = ""

  if (activePersistence !== null) {
    try {
      const loaded = await withTimeout(activePersistence.window(), PERSISTENCE_TIMEOUT_MS)
      // An empty window is a brand-new thread, not a transcript: the client's
      // own history is still the better prompt until the server has one.
      if (loaded !== null && loaded.turns.length > 0) {
        windowTurns = loaded.turns
        conversationSummary = loaded.summary ?? undefined
      }
    } catch (error) {
      console.error("[ai-chat] transcript window unavailable, using the client's history", error)
    }

    try {
      memoryBlock = await withTimeout(activePersistence.memories(userMessage), PERSISTENCE_TIMEOUT_MS)
    } catch (error) {
      // Memory is personalisation, never ground truth (constraint 15), so a
      // failed read injects nothing rather than costing the answer.
      console.error("[ai-chat] memory read unavailable", error)
    }
  }

  const priorTurns = windowTurns ?? clientHistory
  const priorUserMessages = priorTurns.filter((t) => t.role === "user").map((t) => t.content)

  const lastUserTurn = [...priorTurns].reverse().find((t) => t.role === "user")
  const searchQuery = lastUserTurn ? `${lastUserTurn.content} ${userMessage}` : userMessage

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://dcphtracker.vercel.app"

  // One budget for the whole request, not one per stage: the planner and the
  // answer stream share a single clock, so a request that plans for a second
  // cannot also stream for the full budget, and a client that disconnects
  // while the planner is thinking aborts it (constraint 10).
  const budget = new AbortController()
  const budgetTimer = setTimeout(() => budget.abort(), TOTAL_BUDGET_MS)
  const abortOnDisconnect = () => budget.abort()
  if (request.signal.aborted) {
    budget.abort()
  } else {
    request.signal.addEventListener("abort", abortOnDisconnect)
  }
  const releaseBudget = () => {
    clearTimeout(budgetTimer)
    request.signal.removeEventListener("abort", abortOnDisconnect)
  }

  const gateway = createGateway()

  const retrieveStartedAt = Date.now()
  let context: Awaited<ReturnType<typeof searchAll>> = { episodes: [], cases: [], dcwWiki: [] }
  let hasInDomainContext = false
  let retrievalFailed = false
  let pipelineResult: PipelineResult | null = null
  let pipelineThrew = false
  let systemPrompt = ""

  if (version === "v2") {
    // v2's retrieval context is empty: the evidence blocks carry the facts and
    // every context section is content-gated. The one exception is the watch
    // history, which v1 got for free inside `searchAll` and the pipeline does
    // not fetch — it stays a real read, bounded like every other pre-stream one.
    let watchHistory: Awaited<ReturnType<typeof getUserWatchHistory>>
    try {
      watchHistory = await withTimeout(getUserWatchHistory(userId), PERSISTENCE_TIMEOUT_MS)
    } catch (error) {
      console.error("[ai-chat] watch history unavailable", error)
    }

    // The memory block and the rolling summary are NOT passed here: the
    // assembler owns both sections, and passing them twice would put two
    // copies of each in the prompt. They reach the model through `runPipeline`.
    systemPrompt = buildSystemPrompt({
      context: { episodes: [], cases: [], dcwWiki: [], watchHistory },
      displayName,
      isSignedIn: Boolean(userId),
      siteUrl,
    })

    // `ai_documents` and `ai_wiki_cache` are service-role only (the corpus
    // migration revokes them from anon and authenticated and enables RLS with
    // no policies), so the indexed corpus is reachable only through the admin
    // client — a user-scoped one would probe "reachable" and then read nothing.
    // Dynamic on purpose: the v1 route, and the tests that pin it, must not
    // load the env-dependent admin module at all.
    const { createAdminClient } = await import("@/utils/supabase/admin")
    // The resolver declares its clients structurally, so the generated Supabase
    // type is narrowed once here rather than leaking PostgREST inward — the
    // same seam `createRequestPersistence` uses.
    const admin = createAdminClient() as unknown as (ResolverClient & AdminRowsClient) | null

    const plannerCall = toStructuredCall(gateway, {
      targets,
      signal: budget.signal,
    })

    try {
      pipelineResult = await runPipeline({
        message: searchQuery,
        priorTurns,
        priorUserMessages,
        systemPrompt,
        memories: memoryBlock,
        summary: conversationSummary ?? null,
        userId,
        client: admin,
        admin,
        plannerCall,
        plannerStrict: targets.some((target) => target.supportsJsonSchema),
        now: Date.now,
        log: pipelineLog,
      })
    } catch (error) {
      // `runPipeline` contains its own stages; this is the belt to that
      // braces. The request continues without evidence and the refusal gate
      // decides whether an unevidenced answer is honest — never a 500.
      pipelineThrew = true
      retrievalFailed = true
      console.error("[ai-chat] pipeline unavailable, answering without evidence", error)
    }
  }

  if (pipelineResult === null && !pipelineThrew) {
    // v1: today's retrieval, refusal gate input and prompt, byte-for-byte in
    // behaviour (constraint 11). Also the defensive branch when the pipeline
    // itself reports the rollback.
    try {
      context = await searchAll(searchQuery, userId)
    } catch {
      retrievalFailed = true
    }

    hasInDomainContext =
      context.episodes.length > 0 ||
      context.cases.length > 0 ||
      context.dcwWiki.some((r) => r.source === "dcw")

    systemPrompt = buildSystemPrompt({
      context,
      displayName,
      isSignedIn: Boolean(userId),
      siteUrl,
      memories: memoryBlock,
      conversationSummary,
    })
  }

  // The pipeline measures its own retrieval; v1's is the wall clock around
  // `searchAll`, which is also the honest number when the pipeline threw.
  const retrieveMs =
    pipelineResult !== null ? pipelineResult.timings.retrieveMs : Date.now() - retrieveStartedAt

  // D8: the gate keeps its signature, and only its `hasContext` source changes
  // between the paths — the assembly's evidence on v2, v1's own in-domain hit.
  const hasContext = pipelineResult !== null ? pipelineResult.evidence.length > 0 : hasInDomainContext
  if (
    shouldRefuseForMissingContext({
      searchQuery,
      priorUserMessages,
      hasContext,
    })
  ) {
    releaseBudget()
    return refusalResponse(REFUSAL_NO_CONTEXT)
  }

  // The assembler leaves the current user turn to the route (it is the only
  // place that has the user's own words), so it is appended here on both paths.
  const messages: ChatMessage[] =
    pipelineResult !== null
      ? [...pipelineResult.messages, { role: "user", content: userMessage }]
      : [
          { role: "system", content: systemPrompt },
          ...priorTurns,
          { role: "user", content: userMessage },
        ]

  // Before the stream starts, so a client that disconnects immediately still
  // has its question stored.
  if (activePersistence !== null) {
    try {
      await withTimeout(activePersistence.record("user", userMessage), PERSISTENCE_TIMEOUT_MS)
    } catch (error) {
      console.error("[ai-chat] user turn not stored", error)
    }
  }

  const requestStartedAt = Date.now()

  // The answer the gateway actually emitted, accumulated as it arrives. This is
  // what the transcript stores: the synthetic messages below are ours, not the
  // model's, and a rate-limited or empty turn has no answer to store at all.
  let answerText = ""
  let settleTurn: (answer: string | null) => void = () => {}
  // Resolved by the stream, consumed by the post-response work: `after` runs
  // once the response is handed over, so the two cannot be joined any earlier.
  const turnSettled = new Promise<string | null>((resolve) => {
    settleTurn = resolve
  })

  let answerSettled = false
  // Exactly once, from the stream's end or from the client disconnecting: the
  // post-response work runs a single time, and a client that walks away
  // mid-answer still has the text that arrived stored.
  const settleAnswer = () => {
    if (answerSettled) return
    answerSettled = true
    settleTurn(answerText.trim() === "" ? null : answerText)
  }

  // The SDK's stream has no cancel hook, so a disconnect is read off the
  // request signal — the same one the budget's abort listener watches. The
  // gateway's own `aborted` result settles the turn too; `settleAnswer`'s guard
  // makes the two one settle rather than two.
  const settleOnDisconnect = () => settleAnswer()
  request.signal.addEventListener("abort", settleOnDisconnect)

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      let firstTokenMs: number | null = null
      let textStarted = false

      // One text part for the whole answer: `text-start` opens it on the first
      // write, and each delta is the gateway's own string. The SDK frames the
      // stream; it never re-encodes or trims the answer.
      const writeText = (delta: string) => {
        if (!textStarted) {
          textStarted = true
          writer.write({ type: "text-start", id: ANSWER_PART_ID })
        }
        writer.write({ type: "text-delta", id: ANSWER_PART_ID, delta })
      }

      const writeDegraded = (reasons: string[]) => {
        const part = buildDegradedPart(reasons)
        if (part !== null) writer.write({ type: PARTS.degraded, data: part })
      }

      try {
        // What the pipeline did, then what it found: both are known before the
        // model is called, so the trace and the sources render while the answer
        // streams. v1 sends no evidence part at all — a part the server does
        // not send is a part the UI does not show.
        writer.write({
          type: PARTS.activity,
          data: buildActivityPart({ pipeline: pipelineResult, retrieveMs }),
        })
        if (pipelineResult !== null) {
          writer.write({ type: PARTS.evidence, data: buildEvidencePart(pipelineResult) })
        }
        writeDegraded(preAnswerDegradedReasons({ retrievalFailed, pipeline: pipelineResult }))

        // The budget was hoisted before retrieval: the planner and the stream
        // share one clock, and the disconnect listener that aborts both was
        // registered there too. This is where that clock stops.
        let result: StreamChatResult
        try {
          result = await gateway.streamChat({
            messages,
            targets,
            signal: budget.signal,
            onDelta: (text) => {
              if (firstTokenMs === null) firstTokenMs = Date.now() - requestStartedAt
              answerText += text
              writeText(text)
            },
          })
        } finally {
          releaseBudget()
        }

        // The synthetic strings are ours, not the model's: they reach the
        // reader but never `answerText`, so the transcript and the citation
        // validator see the model's own words only. `syntheticReason` names the
        // state, and its `degraded` part is written below — after the text it
        // describes, because it is only known once the stream has ended.
        let syntheticReason: string | null = null
        if (result.aborted) {
          // Our own budget expiring is not the same as the user closing the
          // tab: in the first case they are still listening and the answer must
          // be labelled, in the second there is nobody left to tell.
          if (result.textChars > 0 && !request.signal.aborted) {
            syntheticReason = PARTIAL_ANSWER_REASON
            writeText(PARTIAL_RESULT_SUFFIX)
          }
        } else if (!result.ok) {
          syntheticReason = result.rateLimited ? RATE_LIMITED_REASON : EMPTY_RESULT_REASON
          writeText(result.rateLimited ? RATE_LIMITED_MESSAGE : EMPTY_RESULT_MESSAGE)
        } else if (result.midStreamFailure || result.truncated) {
          syntheticReason = PARTIAL_ANSWER_REASON
          writeText(PARTIAL_RESULT_SUFFIX)
        }

        if (textStarted) writer.write({ type: "text-end", id: ANSWER_PART_ID })

        // The citation contract is checked on the answer the model actually
        // emitted. `answerText` never contains the synthetic messages above, so
        // the suffix is never parsed as a citation (D3). A turn that produced no
        // answer at all still reports `uncited` when evidence was supplied; the
        // late part below pairs it with the synthetic reason that explains it.
        const citations = validateCitations({
          text: answerText,
          evidence: pipelineResult?.evidence ?? [],
          requireCitation: (pipelineResult?.evidence.length ?? 0) > 0,
        })

        // The late part: `uncited` and the synthetic token are only known now,
        // so a client must apply a `degraded` part that arrives after the text
        // rather than assume the part always precedes it (Task 4).
        writeDegraded(
          lateDegradedReasons({ uncited: citations.uncited, synthetic: syntheticReason })
        )

        // v1 sends no citation part: it has no evidence to resolve against.
        if (pipelineResult !== null) {
          writer.write({ type: PARTS.citations, data: buildCitationsPart(citations) })
        }

        // Fire-and-forget: observability must not delay or fail the response.
        void logRequest({
          userId,
          targetId: result.targetId,
          outcome: result.aborted
            ? "aborted"
            : result.ok
              ? result.truncated
                ? "partial"
                : "ok"
              : result.rateLimited
                ? "rate_limited"
                : "empty",
          retrieveMs,
          ttftMs: firstTokenMs,
          totalMs: Date.now() - requestStartedAt,
          attempts: result.attempts,
          // v2's documents are the numbered evidence refs; v1 has no refs, so
          // its count stays the rows retrieval returned.
          docCount:
            pipelineResult !== null
              ? pipelineResult.evidence.length
              : context.episodes.length + context.cases.length + context.dcwWiki.length,
          degradedReason: degradedReasonFor({
            retrievalFailed,
            pipeline: pipelineResult,
            uncited: citations.uncited,
          }),
          ...(pipelineResult !== null
            ? {
                planSource: pipelineResult.planSource,
                tools: pipelineResult.toolNames,
                planMs: pipelineResult.timings.planMs,
                citationsValid: citations.valid,
              }
            : {}),
        })
      } finally {
        // However the stream ended, the turn ended with it.
        settleAnswer()
        request.signal.removeEventListener("abort", settleOnDisconnect)
      }
    },
  })

  if (activePersistence !== null) {
    const handle = activePersistence
    scheduleAfter(
      turnSettled.then(async (answer) => {
        if (answer === null) return
        try {
          await handle.afterTurn({ answer })
        } catch (error) {
          // The seam contains its own failures; this is the last line of
          // defence for work that runs after there is anyone to tell.
          console.error("[ai-chat] post-response transcript write failed", error)
        }
      })
    )
  }

  // The SDK frames the parts as SSE and sets `text/event-stream`; the headers
  // below are the ones the plain-text response carried, minus its content type.
  return createUIMessageStreamResponse({
    stream,
    headers: {
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      // The client echoes this back on its next turn. Absent when there is no
      // server-owned transcript, which is exactly today's response.
      ...(activePersistence !== null
        ? { "X-Conversation-Id": activePersistence.conversationId }
        : {}),
    },
  })
}
