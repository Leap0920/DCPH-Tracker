import { createClient } from "@/utils/supabase/server"
import { searchAll } from "@/lib/chat/search"
import { buildSystemPrompt } from "@/lib/chat/prompt"
import { ThinkingFilter } from "@/lib/chat/answer"
import {
  REFUSAL_NO_CONTEXT,
  classifyChatIntent,
  shouldRefuseForMissingContext,
} from "@/lib/chat/intent"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

/**
 * MODEL PINNING.
 *
 * `openrouter/free` is not a model — it is a load balancer that picks a
 * *different* free model per request. Measured against this app, four identical
 * requests were served by three different models, and one of them
 * (`cohere/north-mini-code:free`) finished with `finish_reason: "length"`,
 * 0 content characters and 1,644 reasoning characters: it spent the entire
 * token budget thinking and returned nothing. That is the origin of the
 * "I could not generate a response" messages users were seeing.
 *
 * We therefore pin an explicit chain, ordered by measured reliability on
 * grounded Q&A (see docs in lib/chat/answer.ts), and only fall through to the
 * next entry when a model fails outright or produces nothing usable.
 */
interface ChatProviderTarget {
  name: string
  url: string
  key: string
  model: string
  headers?: Record<string, string>
}

/**
 * Multi-provider fallback chain.
 *
 * Ordered by intelligence, speed, and daily free quota:
 * 1. Google Gemini (AI Studio) - 1,500 req/day free, high reasoning accuracy
 * 2. Groq Cloud - 14,000+ req/day free, ultra-low latency LPU inference
 * 3. OpenRouter (Primary & Secondary Keys + 10 Free models)
 * 4. Cerebras (if active)
 */
function buildProviderTargets(): ChatProviderTarget[] {
  const targets: ChatProviderTarget[] = []

  // 1. Google Gemini (Google AI Studio)
  const geminiKey = process.env.GEMINI_API_KEY
  if (geminiKey) {
    const geminiModels = [
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "gemini-3.6-flash",
      "gemini-3-flash",
    ]
    for (const model of geminiModels) {
      targets.push({
        name: `Gemini (${model})`,
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        key: geminiKey,
        model,
      })
    }
  }

  // 2. Groq Cloud
  const groqKey = process.env.GROQ_API_KEY
  if (groqKey) {
    const groqModels = [
      "openai/gpt-oss-120b",
      "qwen/qwen3.8-27b",
      "qwen/qwen3.6-27b",
      "openai/gpt-oss-20b",
      "groq/compound",
    ]
    for (const model of groqModels) {
      targets.push({
        name: `Groq (${model})`,
        url: "https://api.groq.com/openai/v1/chat/completions",
        key: groqKey,
        model,
      })
    }
  }

  // 3. OpenRouter (Primary & Backup Keys)
  const openrouterKeys: string[] = []
  if (process.env.OPENROUTER_API_KEY) {
    openrouterKeys.push(...process.env.OPENROUTER_API_KEY.split(",").map((k) => k.trim()).filter(Boolean))
  }
  if (process.env.OPENROUTER_API_KEY_2) {
    openrouterKeys.push(...process.env.OPENROUTER_API_KEY_2.split(",").map((k) => k.trim()).filter(Boolean))
  }
  const uniqueOrKeys = [...new Set(openrouterKeys)]

  const openrouterModels = [
    "openrouter/free",
    "minimax/minimax-m3:free",
    "minimax/minimax-m2.7:free",
    "google/gemma-4-31b-it:free",
    "z-ai/glm-5.2:free",
    "liquid/lfm-2.5-2.6b:free",
    "nvidia/nemotron-3.5-lightning:free",
    "inclusionai/ling-3.0-flash-fin:free",
    "poolside/laguna-s-2.1:free",
  ]

  for (const model of openrouterModels) {
    for (let i = 0; i < uniqueOrKeys.length; i++) {
      targets.push({
        name: `OpenRouter (${model}, key ${i + 1})`,
        url: "https://openrouter.ai/api/v1/chat/completions",
        key: uniqueOrKeys[i],
        model,
        headers: {
          "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL ?? "https://dcphtracker.vercel.app",
          "X-Title": "DCPH Tracker",
        },
      })
    }
  }

  // 4. Cerebras
  const cerebrasKey = process.env.CEREBRAS_API_KEY
  if (cerebrasKey) {
    const cerebrasModels = ["gpt-oss-120b", "gemma-4-31b"]
    for (const model of cerebrasModels) {
      targets.push({
        name: `Cerebras (${model})`,
        url: "https://api.cerebras.ai/v1/chat/completions",
        key: cerebrasKey,
        model,
      })
    }
  }

  return targets
}

const MAX_TOKENS = 1500
const TEMPERATURE = 0.1

const MAX_MESSAGE_CHARS = 1000
const MAX_HISTORY_MESSAGES = 8

const EMPTY_RESULT_MESSAGE =
  "I could not find a reliable answer for that. Try naming the episode number, movie number, or character you mean."
const PROVIDER_ERROR_MESSAGE = "The AI provider returned an error. Please try again."
const RATE_LIMITED_MESSAGE = "All free AI providers are temporarily at capacity. Please try again in a moment."

type ChatRole = "user" | "assistant"
interface ChatTurn {
  role: ChatRole
  content: string
}

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
 * A polite refusal, sent as a normal `text/plain` 200 body so the chat widget
 * renders it as a bot message (same shape the streaming response uses).
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

interface PumpResult {
  /** True when the client disconnected; the caller must stop everything. */
  aborted: boolean
  /** True when the upstream stream ended with an error payload. */
  failed: boolean
  /** True when the model stopped because it ran out of tokens. */
  truncated: boolean
}

/**
 * Drains one SSE response, forwarding only the text that survives the
 * reasoning filter.
 */
async function pumpStream(
  upstream: Response,
  emit: (text: string) => void,
  filter: ThinkingFilter,
  signal: AbortSignal
): Promise<PumpResult> {
  const reader = upstream.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const result: PumpResult = { aborted: false, failed: false, truncated: false }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue
        // OpenRouter sends `: OPENROUTER PROCESSING` keep-alive comments.
        if (line.startsWith(":")) continue
        if (!line.startsWith("data:")) continue

        const payload = line.slice(5).trim()
        if (payload === "[DONE]") continue

        let parsed: {
          choices?: Array<{
            delta?: { content?: string | null }
            finish_reason?: string | null
          }>
          error?: { message?: string }
        }
        try {
          parsed = JSON.parse(payload)
        } catch {
          continue // partial or non-JSON frame
        }

        if (parsed.error?.message) {
          console.error("OpenRouter stream error", parsed.error.message.slice(0, 300))
          result.failed = true
          continue
        }

        if (parsed.choices?.[0]?.finish_reason === "length") {
          result.truncated = true
        }

        const delta = parsed.choices?.[0]?.delta?.content
        if (typeof delta === "string" && delta) {
          emit(filter.push(delta))
        }
      }
    }

    emit(filter.finish())
    return result
  } catch (error) {
    if ((error as Error)?.name === "AbortError" || signal.aborted) {
      result.aborted = true
      return result
    }
    console.error("Chat stream failed", error)
    result.failed = true
    return result
  } finally {
    reader.releaseLock?.()
  }
}

export async function POST(request: Request) {
  const targets = buildProviderTargets()
  if (targets.length === 0) {
    return jsonError("Chat is not configured on this server.", 500)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError("Invalid JSON body.", 400)
  }

  const { message, history } = (body ?? {}) as { message?: unknown; history?: unknown }
  if (typeof message !== "string" || !message.trim()) {
    return jsonError("A non-empty `message` is required.", 400)
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return jsonError(`Message too long (max ${MAX_MESSAGE_CHARS} characters).`, 400)
  }

  const userMessage = message.trim()
  const priorTurns = sanitizeHistory(history)

  // Auth is required — anonymous users must sign in.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return jsonError("Please sign in to chat with DCPH Bot.", 401)
  }

  // Lightweight out-of-domain pre-check: clearly off-topic requests (coding help,
  // other franchises, homework, recipes, ...) are refused with a polite reply
  // before any retrieval, prompt building, or provider inference runs.
  const intent = classifyChatIntent(userMessage)
  if (intent.action === "refuse") {
    return refusalResponse(intent.reply)
  }

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

  // Include the previous user turn so follow-ups ("what about the victim?") retrieve.
  const lastUserTurn = [...priorTurns].reverse().find((t) => t.role === "user")
  const searchQuery = lastUserTurn ? `${lastUserTurn.content} ${userMessage}` : userMessage

  let context
  try {
    context = await searchAll(searchQuery, userId)
  } catch {
    context = { episodes: [], cases: [], dcwWiki: [] }
  }


  // Strict domain validation: an information-seeking question that retrieval
  // could not ground in the Detective Conan universe - and that never mentioned
  // the series, now or in the recent conversation - is refused before any
  // provider call. This stops the model from answering out-of-scope questions
  // out of injected general-knowledge context (e.g. the Wikipedia fallback).
  const hasInDomainContext =
    context.episodes.length > 0 ||
    context.cases.length > 0 ||
    context.dcwWiki.some((r) => r.source === "dcw")
  if (
    shouldRefuseForMissingContext({
      searchQuery,
      priorUserMessages: priorTurns
        .filter((t) => t.role === "user")
        .map((t) => t.content),
      hasContext: hasInDomainContext,
    })
  ) {
    return refusalResponse(REFUSAL_NO_CONTEXT)
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://dcphtracker.vercel.app"

  const systemPrompt = buildSystemPrompt({
    context,
    displayName,
    isSignedIn: Boolean(userId),
    siteUrl,
  })

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...priorTurns,
    { role: "user" as const, content: userMessage },
  ]

  const encoder = new TextEncoder()
  const filter = new ThinkingFilter()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sent = 0
      let encounteredRateLimit = false

      const emit = (text: string) => {
        if (!text) return
        sent += text.length
        controller.enqueue(encoder.encode(text))
      }

      const close = () => {
        try {
          controller.close()
        } catch {
          // Already closed by a client disconnect.
        }
      }

      for (const target of targets) {
        let upstream: Response
        try {
          upstream = await fetch(target.url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${target.key}`,
              "Content-Type": "application/json",
              ...(target.headers ?? {}),
            },
            body: JSON.stringify({
              model: target.model,
              stream: true,
              temperature: TEMPERATURE,
              max_tokens: MAX_TOKENS,
              messages,
            }),
            signal: request.signal,
          })
        } catch (error) {
          if ((error as Error)?.name === "AbortError" || request.signal.aborted) {
            close()
            return
          }
          console.error(`Provider unreachable [${target.name}]:`, error)
          continue
        }

        if (!upstream.ok || !upstream.body) {
          const detail = await upstream.text().catch(() => "")
          console.error(
            `Provider error [${target.name}, status ${upstream.status}]:`,
            detail.slice(0, 300)
          )
          if (upstream.status === 429) {
            encounteredRateLimit = true
          }
          continue
        }

        const result = await pumpStream(upstream, emit, filter, request.signal)

        if (result.aborted) {
          close()
          return
        }

        if (sent > 0) {
          // Usable response streamed — we are done
          break
        }

        // Nothing survived filtering or stream was truncated. Reset filter for next target.
        filter.reset()
        console.error("Provider returned no usable output", {
          target: target.name,
          truncated: result.truncated,
        })
      }

      if (sent === 0) {
        emit(encounteredRateLimit ? RATE_LIMITED_MESSAGE : EMPTY_RESULT_MESSAGE)
      }

      close()
    },
    cancel() {
      // Nothing to cancel here: each attempt's reader is released in pumpStream.
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
