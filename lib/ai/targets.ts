export type TargetTier = "plan" | "answer"

/**
 * One callable provider endpoint: a (provider, model, credential) triple.
 *
 * `id` is the join key everywhere else — `ai_provider_state.target`, quota bucket
 * keys, and request-log rows — so it must be stable across deploys. Renaming a
 * model therefore resets its health history, which is the correct behaviour:
 * a new model deserves a clean circuit.
 */
export interface ProviderTarget {
  id: string
  provider: "gemini" | "groq" | "openrouter" | "cerebras"
  model: string
  url: string
  apiKey: string
  headers?: Record<string, string>
  /** Which role this target may serve. "answer" targets also serve planning. */
  tier: TargetTier
  /**
   * True when the provider enforces a JSON schema by constrained decoding.
   * Measured ~99.9% schema compliance versus 8–15% failure for plain
   * `json_object` mode, so this single flag decides the structured-output path.
   */
  supportsJsonSchema: boolean
  /** True when the provider sends reasoning on its own channel rather than inline. */
  emitsReasoningChannel: boolean
  maxOutputTokens: number
  /** Requests per rolling 24h the free tier allows for this target. */
  dailyRequestBudget: number
}

export interface ProviderEnv {
  geminiKey: string | null
  groqKey: string | null
  cerebrasKey: string | null
  openrouterKeys: string[]
  siteUrl: string
}

/** A blank or whitespace-only variable is absent, not a blank credential. */
function cleanKey(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function resolveProviderEnv(
  env: Record<string, string | undefined> = process.env
): ProviderEnv {
  const seen = new Set<string>()
  const openrouterKeys: string[] = []
  for (const raw of [env.OPENROUTER_API_KEY, env.OPENROUTER_API_KEY_2]) {
    if (!raw) continue
    for (const candidate of raw.split(",")) {
      const key = candidate.trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      openrouterKeys.push(key)
    }
  }

  return {
    geminiKey: cleanKey(env.GEMINI_API_KEY),
    groqKey: cleanKey(env.GROQ_API_KEY),
    cerebrasKey: cleanKey(env.CEREBRAS_API_KEY),
    openrouterKeys,
    siteUrl: cleanKey(env.NEXT_PUBLIC_SITE_URL) ?? "https://dcphtracker.vercel.app",
  }
}

/**
 * Models deliberately NOT offered, each with the reason it was removed.
 *
 * Keeping this as a comment rather than a filter list means the omission is
 * visible at the point where someone would be tempted to re-add them.
 *
 *   openrouter/free              - a load balancer, not a model: it serves a
 *                                  different model per request. Measured in this
 *                                  repo returning 0 content characters against
 *                                  1,644 reasoning characters on one call.
 *   liquid/lfm-2.5-2.6b:free     - too small to follow the grounding rules.
 *   poolside/laguna-s-2.1:free   - a code model, not an instruction follower.
 */
const OPENROUTER_MODELS = [
  "minimax/minimax-m3:free",
  "minimax/minimax-m2.7:free",
  "google/gemma-4-31b-it:free",
  "z-ai/glm-5.2:free",
  "nvidia/nemotron-3.5-lightning:free",
  "inclusionai/ling-3.0-flash-fin:free",
]

const GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.6-flash",
  "gemini-3-flash",
]

const GROQ_MODELS = [
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
  "qwen/qwen3.6-27b",
  "openai/gpt-oss-20b",
  "groq/compound",
]

const CEREBRAS_MODELS = ["gpt-oss-120b", "gemma-4-31b"]

export function buildProviderTargets(
  env: Record<string, string | undefined> = process.env
): ProviderTarget[] {
  const resolved = resolveProviderEnv(env)
  const targets: ProviderTarget[] = []

  if (resolved.geminiKey) {
    for (const model of GEMINI_MODELS) {
      targets.push({
        id: `gemini:${model}`,
        provider: "gemini",
        model,
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        apiKey: resolved.geminiKey,
        tier: "answer",
        supportsJsonSchema: true,
        emitsReasoningChannel: false,
        maxOutputTokens: 2048,
        dailyRequestBudget: 1400,
      })
    }
  }

  if (resolved.groqKey) {
    for (const model of GROQ_MODELS) {
      targets.push({
        id: `groq:${model}`,
        provider: "groq",
        model,
        url: "https://api.groq.com/openai/v1/chat/completions",
        apiKey: resolved.groqKey,
        tier: "answer",
        // Groq exposes `json_object` (syntax only), not schema enforcement.
        supportsJsonSchema: false,
        emitsReasoningChannel: true,
        maxOutputTokens: 2048,
        dailyRequestBudget: 14000,
      })
    }
  }

  for (const model of OPENROUTER_MODELS) {
    for (let i = 0; i < resolved.openrouterKeys.length; i++) {
      targets.push({
        id: `openrouter:${model}:key${i + 1}`,
        provider: "openrouter",
        model,
        url: "https://openrouter.ai/api/v1/chat/completions",
        apiKey: resolved.openrouterKeys[i],
        headers: {
          "HTTP-Referer": resolved.siteUrl,
          "X-Title": "DCPH Tracker",
        },
        tier: "answer",
        supportsJsonSchema: false,
        emitsReasoningChannel: true,
        maxOutputTokens: 2048,
        dailyRequestBudget: 50,
      })
    }
  }

  if (resolved.cerebrasKey) {
    for (const model of CEREBRAS_MODELS) {
      targets.push({
        id: `cerebras:${model}`,
        provider: "cerebras",
        model,
        url: "https://api.cerebras.ai/v1/chat/completions",
        apiKey: resolved.cerebrasKey,
        tier: "answer",
        supportsJsonSchema: true,
        emitsReasoningChannel: false,
        maxOutputTokens: 2048,
        dailyRequestBudget: 900,
      })
    }
  }

  return targets
}
