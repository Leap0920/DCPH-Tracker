# DCPH Bot — Provider Safety Net & Model Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI chat provider layer safe, observable and quota-aware by replacing the
sequential 20-target retry loop with a capability-aware gateway that classifies failures,
trips circuits, respects free-tier daily budgets, and can be trusted to return valid
structured JSON.

**Architecture:** Three layers of pure logic with no I/O — a target registry, a failure
classifier, and a circuit/backoff state machine — wrapped by thin I/O adapters (a
Postgres-backed health store, a quota counter over the existing `rate_limit_hit` RPC, and a
streaming gateway). Every piece of decision logic is a pure function injected into its
adapter, so the whole layer is testable offline against fakes with no network and no database.

**Tech Stack:** TypeScript 5.9, Next.js 15 route handlers, Vitest 3 (`environment: "node"`,
`globals: false`), Supabase Postgres 15 (service-role admin client), Zod 4.

**Spec:** `docs/superpowers/specs/2026-09-19-dcph-bot-agentic-remaster-design.md`
(sections 2.2 defects 6–10, 16–19; sections 9, 11, 12 Phase 0 and Phase 1)

## Global Constraints

- **$0 model budget.** Free-tier providers only: Gemini AI Studio, Groq, OpenRouter `:free`,
  Cerebras. No paid-tier model may be added by any task.
- **No embeddings, no pgvector.** Lexical retrieval only. Do not add an embedding dependency.
- **No agent framework.** No LangGraph, Mastra, LangChain, or `ai` SDK in this plan. Raw
  OpenAI-compatible `fetch` stays.
- **Migrations are additive only.** New tables, new indexes, new functions. No `drop`,
  no destructive `alter`, no changes to existing tables. New timestamped files in
  `supabase/migrations/`.
- **RLS on for every new table.** Internal tables get RLS enabled and *no* policies, so only
  `service_role` can reach them — mirroring `supabase/migration-rate-limits.sql`.
- **Code style:** no semicolons, double quotes, 2-space indent, `@/` path alias. Match
  `lib/rate-limit-db.ts` exactly.
- **New internal tables are structurally typed, not added to `types/database.types.ts`.**
  Generated types omit new tables until `supabase gen types` is re-run; follow the
  `RateLimitRpcClient` pattern in `lib/rate-limit-db.ts`.
- **Vitest:** `globals: false`, so every test file imports explicitly:
  `import { describe, expect, it, vi } from "vitest"`. Test files are `**/*.test.ts`.
  `server-only` is stubbed by `vitest.server-only-stub.ts`.
- **Verification before every commit:** `npm test`, then `npx tsc --noEmit`, then
  `npm run lint`. CI runs all three plus `npm run build`
  (`.github/workflows/ci.yml`), so all four must pass.
- **Never log a full API key.** Log a target id only.
- **Rollback safety:** nothing in this plan changes user-visible behaviour except bug fixes.
  The route keeps its `text/plain` streaming response shape so `ChatWidget` keeps working
  unmodified.

## Review Focus

The five failure modes most likely to bite a real user, all implied by the spec and none
covered by a happy-path test. Each is pinned by a test in the task that owns the code.

1. **A provider returns HTTP 200 and then dies mid-stream.** The user must be left with the
   partial answer clearly marked incomplete plus a way to regenerate — never a half-sentence
   presented as complete, and never raw provider error text in the chat bubble.
2. **A provider returns HTTP 200, `finish_reason: "length"`, and zero content characters**
   (the incident documented at `app/api/ai-chat/route.ts:16-30`). This must not count as a
   successful attempt, and must not exhaust the whole target list.
3. **An env var is present but empty or whitespace-only** (`GEMINI_API_KEY=""`,
   `OPENROUTER_API_KEY="  "`). This must produce zero targets, not a target with a blank
   bearer token that 401s on every request.
4. **A key list contains duplicates or blank entries** (`OPENROUTER_API_KEY="a,b,a,"`, or the
   same key in both `OPENROUTER_API_KEY` and `OPENROUTER_API_KEY_2`). Keys must be trimmed,
   de-duplicated, and blanks dropped, and a single key must not produce duplicate target ids.
5. **`SUPABASE_SERVICE_ROLE_KEY` is unset.** The gateway must still serve chat using in-memory
   circuit state rather than throwing — availability beats observability here.

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260919090000_ai_gateway_infra.sql` | `ai_provider_state` + `ai_request_log` tables |
| `lib/ai/targets.ts` | Provider target registry: capability data + env parsing |
| `lib/ai/failure.ts` | Pure failure classification (status/error → decision) |
| `lib/ai/circuit.ts` | Pure circuit + backoff state machine |
| `lib/ai/provider-health.ts` | Persists circuit state; in-memory fallback |
| `lib/ai/quota.ts` | Per-target daily request budget via `rate_limit_hit` |
| `lib/ai/request-log.ts` | Writes one `ai_request_log` row per request |
| `lib/ai/structured.ts` | Zod → JSON Schema → validate → bounded repair |
| `lib/ai/sse.ts` | Pure OpenAI-compatible SSE frame parser |
| `lib/ai/gateway.ts` | Streaming failover across healthy targets |
| `lib/ai/__tests__/*.test.ts` | Unit tests per module |
| `app/api/ai-chat/route.integration.test.ts` | Route-level test with a mocked `fetch` |

**Modified**

| File | Change |
| --- | --- |
| `app/api/ai-chat/route.ts` | Use the gateway; add rate limit, origin check, caps, `maxDuration` |
| `package.json` | Add `zod` |
| `.env.example` | Document the AI provider keys |
| `SYSTEM_DOCS.md` | Correct the provider chain description |

**Deleted content (not files)**

| Location | Change |
| --- | --- |
| `route.ts:14` | Remove the dead `OPENROUTER_URL` constant |
| `route.ts:48-142` | Remove `buildProviderTargets` (moved to `lib/ai/targets.ts`) |
| `route.ts:210-287` | Remove `pumpStream` (moved to `lib/ai/sse.ts` + `lib/ai/gateway.ts`) |
| `route.ts:101,106,109` | Remove `openrouter/free`, `liquid/lfm-2.5-2.6b:free`, `poolside/laguna-s-2.1:free` |

**Untouched (deliberately)** — `lib/chat/*`, `components/chat/*`, `ThinkingFilter`. Phase 0–1
is invisible to users apart from bug fixes; the pipeline rewrite is a later plan.

---

## Task 1: Add Zod and the provider target registry

**Files:**
- Modify: `package.json`
- Create: `lib/ai/targets.ts`
- Test: `lib/ai/__tests__/targets.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `ProviderTarget`, `TargetTier`, `buildProviderTargets(env?)`,
  `resolveProviderEnv(env)`

- [ ] **Step 1: Install Zod**

```bash
npm install zod@^4
```

Zod 4 is required specifically for `z.toJSONSchema()`, used in Task 8. Do not install
`zod-to-json-schema` as well.

- [ ] **Step 2: Write the failing test**

```ts
// lib/ai/__tests__/targets.test.ts
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run lib/ai/__tests__/targets.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/ai/targets"`.

- [ ] **Step 4: Write the implementation**

```ts
// lib/ai/targets.ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/ai/__tests__/targets.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 6: Verify nothing else regressed**

```bash
npm test && npx tsc --noEmit && npm run lint
```
Expected: existing suites pass (the old `buildProviderTargets` in `route.ts` is still in use
and untouched at this point), typecheck clean, lint clean.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/ai/targets.ts lib/ai/__tests__/targets.test.ts
git commit -m "feat(ai): add provider target registry with capability metadata

Replaces the inline target list in the AI chat route with a registry that
records per-target capabilities (strict JSON schema support, reasoning
channel, daily budget) rather than just a URL and a key. Blank env vars no
longer produce targets with empty credentials, and three models whose
reliability problems are documented in the route comment are removed."
```

---

## Task 2: Failure classification

**Files:**
- Create: `lib/ai/failure.ts`
- Test: `lib/ai/__tests__/failure.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `FailureKind`, `FailureDecision`, `classifyFailure(input)`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ai/__tests__/failure.test.ts
import { describe, expect, it } from "vitest"
import { classifyFailure } from "@/lib/ai/failure"

describe("classifyFailure", () => {
  it("treats auth and not-found errors as misconfiguration, not transient", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const decision = classifyFailure({ status })
      expect(decision.kind).toBe("misconfigured")
      // A long cooldown is the whole point: a bad model name must not be
      // retried on every subsequent request forever.
      expect(decision.cooldownMs).toBe(24 * 60 * 60 * 1000)
      expect(decision.retryNext).toBe(true)
    }
  })

  it("honours Retry-After on a 429", () => {
    const decision = classifyFailure({ status: 429, retryAfterSeconds: 90 })
    expect(decision.kind).toBe("rate_limited")
    expect(decision.cooldownMs).toBe(90_000)
  })

  it("falls back to 60s on a 429 with no Retry-After", () => {
    expect(classifyFailure({ status: 429 }).cooldownMs).toBe(60_000)
  })

  it("ignores an absurd Retry-After and clamps it", () => {
    expect(classifyFailure({ status: 429, retryAfterSeconds: 999_999 }).cooldownMs).toBe(
      60 * 60 * 1000
    )
  })

  it("classifies server errors and timeouts as transient", () => {
    expect(classifyFailure({ status: 500 }).kind).toBe("server_error")
    expect(classifyFailure({ status: 503 }).kind).toBe("server_error")
    expect(classifyFailure({ status: 504 }).kind).toBe("timeout")
  })

  it("classifies an aborted request as a timeout", () => {
    const error = new Error("aborted")
    error.name = "AbortError"
    expect(classifyFailure({ error }).kind).toBe("timeout")
  })

  it("classifies an unknown thrown value as a network error", () => {
    expect(classifyFailure({ error: new TypeError("fetch failed") }).kind).toBe("network")
    expect(classifyFailure({}).kind).toBe("network")
  })

  it("flags an empty-output finish reason as its own kind", () => {
    const decision = classifyFailure({ status: 200, finishReason: "length", textChars: 0 })
    expect(decision.kind).toBe("empty_output")
    expect(decision.cooldownMs).toBe(0)
  })

  it("does not flag a truncated but non-empty response as empty output", () => {
    expect(classifyFailure({ status: 200, finishReason: "length", textChars: 120 }).kind).toBe(
      "server_error"
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/ai/__tests__/failure.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/failure`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ai/failure.ts
export type FailureKind =
  /** Bad credential or model name. Not transient — stop trying it for a long time. */
  | "misconfigured"
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "network"
  /** HTTP 200, but the model produced nothing usable. */
  | "empty_output"

export interface FailureDecision {
  kind: FailureKind
  /** How long to keep this target out of rotation. 0 means do not cool it down. */
  cooldownMs: number
  /** Whether trying the next target immediately is worthwhile. */
  retryNext: boolean
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** A Retry-After longer than this is treated as a misreported value. */
const MAX_RETRY_AFTER_MS = HOUR_MS
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000

export interface FailureInput {
  /** HTTP status, when a response was received at all. */
  status?: number
  retryAfterSeconds?: number | null
  /** The thrown value, for cases where no response arrived. */
  error?: unknown
  /** From the SSE stream, when the request otherwise succeeded. */
  finishReason?: string | null
  /** Characters of usable content the attempt produced. */
  textChars?: number
}

function parseRetryAfter(seconds: number | null | undefined): number {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_RATE_LIMIT_COOLDOWN_MS
  }
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
}

export function classifyFailure(input: FailureInput): FailureDecision {
  const { status, error, finishReason, textChars } = input

  // Checked before the status branches: the transport succeeded, so the status
  // is 200 and would otherwise be read as a success.
  if (status === 200 && finishReason === "length" && (textChars ?? 0) === 0) {
    return { kind: "empty_output", cooldownMs: 0, retryNext: true }
  }

  if (typeof status === "number") {
    if (status === 429) {
      return {
        kind: "rate_limited",
        cooldownMs: parseRetryAfter(input.retryAfterSeconds),
        retryNext: true,
      }
    }
    if (status === 408 || status === 504) {
      return { kind: "timeout", cooldownMs: 30_000, retryNext: true }
    }
    if (status >= 500) {
      return { kind: "server_error", cooldownMs: 30_000, retryNext: true }
    }
    if (status >= 400) {
      return { kind: "misconfigured", cooldownMs: DAY_MS, retryNext: true }
    }
    return { kind: "server_error", cooldownMs: 30_000, retryNext: true }
  }

  const name = (error as { name?: string } | undefined)?.name
  if (name === "AbortError" || name === "TimeoutError") {
    return { kind: "timeout", cooldownMs: 30_000, retryNext: true }
  }

  return { kind: "network", cooldownMs: 30_000, retryNext: true }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/ai/__tests__/failure.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/failure.ts lib/ai/__tests__/failure.test.ts
git commit -m "feat(ai): classify provider failures into actionable kinds

Separates deterministic misconfiguration (bad key or model name) from
transient faults, so a 404 can be cooled down for a day instead of being
retried on every request forever. Honours Retry-After on 429 and treats a
200 response with no usable content as its own failure kind."
```

---

## Task 3: Circuit breaker and backoff state machine

**Files:**
- Create: `lib/ai/circuit.ts`
- Test: `lib/ai/__tests__/circuit.test.ts`

**Interfaces:**
- Consumes: `FailureDecision` from `@/lib/ai/failure`
- Produces: `TargetState`, `initialTargetState(id)`, `isAvailable(state, now)`,
  `recordFailure(state, decision, now, random?)`, `recordSuccess(state, now)`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ai/__tests__/circuit.test.ts
import { describe, expect, it } from "vitest"
import {
  initialTargetState,
  isAvailable,
  recordFailure,
  recordSuccess,
} from "@/lib/ai/circuit"

const NOW = Date.parse("2026-09-19T10:00:00.000Z")

describe("isAvailable", () => {
  it("is available with no prior state", () => {
    expect(isAvailable(initialTargetState("groq:x"), NOW)).toBe(true)
  })

  it("is unavailable while the circuit is open, available once it closes", () => {
    const state = { ...initialTargetState("groq:x"), openUntil: NOW + 30_000 }
    expect(isAvailable(state, NOW)).toBe(false)
    expect(isAvailable(state, NOW + 30_001)).toBe(true)
  })
})

describe("recordFailure", () => {
  it("counts consecutive failures and opens the circuit", () => {
    const state = recordFailure(
      initialTargetState("groq:x"),
      { kind: "server_error", cooldownMs: 1_000, retryNext: true },
      NOW,
      () => 0
    )
    expect(state.consecutiveFailures).toBe(1)
    expect(state.openUntil).toBe(NOW + 1_000)
    expect(state.lastFailureKind).toBe("server_error")
  })

  it("grows the cooldown exponentially as failures accumulate", () => {
    let state = initialTargetState("groq:x")
    const delays: number[] = []
    for (let i = 0; i < 4; i++) {
      state = recordFailure(
        state,
        { kind: "server_error", cooldownMs: 1_000, retryNext: true },
        NOW,
        () => 0
      )
      delays.push((state.openUntil ?? NOW) - NOW)
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000])
  })

  it("caps the exponential growth", () => {
    let state = initialTargetState("groq:x")
    for (let i = 0; i < 20; i++) {
      state = recordFailure(
        state,
        { kind: "server_error", cooldownMs: 1_000, retryNext: true },
        NOW,
        () => 0
      )
    }
    expect((state.openUntil ?? NOW) - NOW).toBe(15 * 60 * 1000)
  })

  it("does not grow the cooldown for a misconfiguration", () => {
    const state = recordFailure(
      initialTargetState("groq:x"),
      { kind: "misconfigured", cooldownMs: 86_400_000, retryNext: true },
      NOW,
      () => 0
    )
    expect((state.openUntil ?? NOW) - NOW).toBe(86_400_000)
  })

  it("applies jitter deterministically from the injected random source", () => {
    const noJitter = recordFailure(
      initialTargetState("groq:x"),
      { kind: "server_error", cooldownMs: 1_000, retryNext: true },
      NOW,
      () => 0
    )
    const fullJitter = recordFailure(
      initialTargetState("groq:x"),
      { kind: "server_error", cooldownMs: 1_000, retryNext: true },
      NOW,
      () => 0.99
    )
    expect((noJitter.openUntil ?? NOW) - NOW).toBe(1_000)
    expect((fullJitter.openUntil ?? NOW) - NOW).toBeGreaterThan(1_000)
    expect((fullJitter.openUntil ?? NOW) - NOW).toBeLessThanOrEqual(1_500)
  })

  it("leaves the circuit closed when the cooldown is zero", () => {
    const state = recordFailure(
      initialTargetState("groq:x"),
      { kind: "empty_output", cooldownMs: 0, retryNext: true },
      NOW,
      () => 0
    )
    expect(state.openUntil).toBeNull()
    expect(isAvailable(state, NOW)).toBe(true)
  })
})

describe("recordSuccess", () => {
  it("clears failures and closes the circuit", () => {
    const failed = recordFailure(
      initialTargetState("groq:x"),
      { kind: "server_error", cooldownMs: 60_000, retryNext: true },
      NOW,
      () => 0
    )
    const state = recordSuccess(failed, NOW)
    expect(state.consecutiveFailures).toBe(0)
    expect(state.openUntil).toBeNull()
    expect(state.successCount).toBe(1)
    expect(state.lastUsedAt).toBe(NOW)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/ai/__tests__/circuit.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/circuit`.

Note the injected-random convention: `recordFailure`'s fourth argument is a
`() => number`, not a number. Every test passes a thunk (`() => 0` for no jitter), because a
bare literal would override the `Math.random` default and only appear to work — it is a
function call the implementation makes, not a value it reads.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ai/circuit.ts
import type { FailureDecision, FailureKind } from "@/lib/ai/failure"

export interface TargetState {
  targetId: string
  consecutiveFailures: number
  /** Epoch ms until which this target must be skipped. Null = closed. */
  openUntil: number | null
  lastFailureKind: FailureKind | null
  lastStatus: number | null
  lastError: string | null
  lastUsedAt: number | null
  successCount: number
  failureCount: number
}

const MAX_COOLDOWN_MS = 15 * 60 * 1000
const JITTER_RATIO = 0.5

/** Repeated transient failures back off exponentially; a misconfiguration
 * keeps its own (much longer, fixed) cooldown rather than doubling. */
const NON_GROWING_KINDS: ReadonlySet<FailureKind> = new Set(["misconfigured", "empty_output"])

export function initialTargetState(targetId: string): TargetState {
  return {
    targetId,
    consecutiveFailures: 0,
    openUntil: null,
    lastFailureKind: null,
    lastStatus: null,
    lastError: null,
    lastUsedAt: null,
    successCount: 0,
    failureCount: 0,
  }
}

export function isAvailable(state: TargetState, now: number): boolean {
  return state.openUntil === null || state.openUntil <= now
}

/**
 * Backoff with jitter.
 *
 * `random` is injected so tests can pin the value — an exponential backoff that
 * cannot be asserted deterministically tends to go untested, and an untested
 * backoff is how a provider fleet ends up hammering an API in lockstep.
 */
export function backoffMs(
  baseMs: number,
  consecutiveFailures: number,
  random: () => number = Math.random
): number {
  const exponent = Math.max(0, consecutiveFailures - 1)
  const raw = Math.min(baseMs * 2 ** exponent, MAX_COOLDOWN_MS)
  return Math.min(Math.round(raw * (1 + JITTER_RATIO * random())), MAX_COOLDOWN_MS)
}

export interface FailureRecordInput {
  kind: FailureKind
  status?: number | null
  error?: string | null
}

export function recordFailure(
  state: TargetState,
  decision: FailureDecision,
  now: number,
  random: () => number = Math.random,
  detail: FailureRecordInput = { kind: decision.kind }
): TargetState {
  const consecutiveFailures = state.consecutiveFailures + 1

  const cooldown = NON_GROWING_KINDS.has(decision.kind)
    ? decision.cooldownMs
    : backoffMs(decision.cooldownMs, consecutiveFailures, random)

  return {
    ...state,
    consecutiveFailures,
    openUntil: cooldown > 0 ? now + cooldown : null,
    lastFailureKind: decision.kind,
    lastStatus: detail.status ?? null,
    lastError: detail.error?.slice(0, 300) ?? null,
    lastUsedAt: now,
    failureCount: state.failureCount + 1,
  }
}

export function recordSuccess(state: TargetState, now: number): TargetState {
  return {
    ...state,
    consecutiveFailures: 0,
    openUntil: null,
    lastUsedAt: now,
    successCount: state.successCount + 1,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/ai/__tests__/circuit.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/circuit.ts lib/ai/__tests__/circuit.test.ts
git commit -m "feat(ai): add circuit breaker and jittered backoff state machine

Pure state transitions with the random source injected so backoff is
deterministically testable. Misconfiguration and empty-output failures keep
a fixed cooldown instead of growing, since doubling the wait on a bad model
name is never the right response."
```

---

## Task 4: Migration for gateway infrastructure tables

**Files:**
- Create: `supabase/migrations/20260919090000_ai_gateway_infra.sql`

**Interfaces:**
- Consumes: nothing
- Produces: tables `public.ai_provider_state`, `public.ai_request_log`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260919090000_ai_gateway_infra.sql
--
-- Infrastructure for the AI chat model gateway. Two internal tables:
--   ai_provider_state - cross-instance circuit breaker state per target
--   ai_request_log    - one row per chat request, for latency/quality debugging
--
-- Both are operationally sensitive and reachable only with the service-role
-- key: RLS is enabled with NO policies, mirroring public.rate_limits.

create table if not exists public.ai_provider_state (
  target               text        primary key,
  consecutive_failures integer     not null default 0,
  open_until           timestamptz,
  last_failure_kind    text,
  last_status          integer,
  last_error           text,
  last_used_at         timestamptz,
  success_count        bigint      not null default 0,
  failure_count        bigint      not null default 0,
  updated_at           timestamptz not null default now()
);

-- The gateway's hot query is "which targets are currently open?".
create index if not exists ai_provider_state_open_until_idx
  on public.ai_provider_state (open_until)
  where open_until is not null;

alter table public.ai_provider_state enable row level security;
revoke all on table public.ai_provider_state from anon, authenticated;

create table if not exists public.ai_request_log (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        references auth.users (id) on delete set null,
  conversation_id   uuid,
  target_id         text,
  outcome           text        not null,
  -- Latency breakdown, in ms, so a slow stage is identifiable without a trace tool.
  plan_ms           integer,
  retrieve_ms       integer,
  ttft_ms           integer,
  total_ms          integer,
  attempts          jsonb       not null default '[]'::jsonb,
  doc_count         integer,
  cache_hit         boolean     not null default false,
  degraded_reason   text,
  prompt_tokens     integer,
  completion_tokens integer,
  created_at        timestamptz not null default now()
);

create index if not exists ai_request_log_created_at_idx
  on public.ai_request_log (created_at desc);

create index if not exists ai_request_log_user_idx
  on public.ai_request_log (user_id, created_at desc);

alter table public.ai_request_log enable row level security;
revoke all on table public.ai_request_log from anon, authenticated;
```

- [ ] **Step 2: Verify the SQL parses**

SQL is not typechecked, so the only real verification is applying it. Use a local instance
if one is available (Step 2b). If none is, the fallback is a closer read than a syntax
count: confirm every table has both `enable row level security` and a `revoke all`, and
that no statement is `drop` or a destructive `alter`.

```bash
grep -c "create table" supabase/migrations/20260919090000_ai_gateway_infra.sql
grep -c "enable row level security" supabase/migrations/20260919090000_ai_gateway_infra.sql
grep -c "revoke all" supabase/migrations/20260919090000_ai_gateway_infra.sql
grep -niE "^alter" supabase/migrations/20260919090000_ai_gateway_infra.sql | grep -v "enable row level security"
grep -niE "\bdrop\b|\btruncate\b|^\s*delete\s+from\b" supabase/migrations/20260919090000_ai_gateway_infra.sql
npx tsc --noEmit
```

Expected: the three counts are all EQUAL — one `enable row level security` and one
`revoke all` per `create table`, so only `service_role` can reach the new tables. The two
`grep` filters print nothing: the only `alter` permitted is enabling RLS, and nothing in
the file drops, truncates or deletes. `tsc` is clean (SQL is not typechecked; this only
confirms the migration did not disturb anything incidental).

The `delete` filter is anchored to `delete from` on purpose: a bare `\bdelete\b` also
matches the referential action in `references auth.users (id) on delete set null`, which is
the opposite of destructive.

- [ ] **Step 2b: Apply to a local instance (when available)**

If a local Supabase is available, apply and confirm:

```bash
supabase db reset --local
```
Expected: migration applies with no error. **Do not run `supabase db push` against the linked
remote project from this task** — remote application is a deliberate deploy step.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260919090000_ai_gateway_infra.sql
git commit -m "feat(ai): add gateway infrastructure tables

ai_provider_state holds cross-instance circuit breaker state so a cooled-down
target stays cooled down across lambda instances. ai_request_log records one
row per request with a latency breakdown, which is what makes retrieval and
grounding quality measurable rather than anecdotal."
```

---

## Task 5: Provider health store

**Files:**
- Create: `lib/ai/provider-health.ts`
- Test: `lib/ai/__tests__/provider-health.test.ts`

**Interfaces:**
- Consumes: `TargetState`, `initialTargetState`, `isAvailable`, `recordFailure`,
  `recordSuccess` from `@/lib/ai/circuit`; `FailureDecision` from `@/lib/ai/failure`
- Produces: `HealthClient` (structural), `ProviderHealth`, `createProviderHealth(deps?)`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ai/__tests__/provider-health.test.ts
import { describe, expect, it } from "vitest"
import { createProviderHealth, type HealthClient } from "@/lib/ai/provider-health"
import { initialTargetState } from "@/lib/ai/circuit"

const NOW = Date.parse("2026-09-19T10:00:00.000Z")

/** Minimal fake of the admin Supabase client, covering only what the store calls. */
function fakeClient(rows: Record<string, unknown>[] = []): {
  client: HealthClient
  upserts: Record<string, unknown>[]
} {
  const upserts: Record<string, unknown>[] = []
  const client: HealthClient = {
    from() {
      return {
        select() {
          return {
            in: async () => ({ data: rows, error: null }),
          }
        },
        upsert: async (values: Record<string, unknown>) => {
          upserts.push(values)
          return { error: null }
        },
      }
    },
  }
  return { client, upserts }
}

describe("createProviderHealth", () => {
  it("reports every target available when the store has no rows", async () => {
    const { client } = fakeClient()
    const health = createProviderHealth({ client, now: () => NOW })
    const states = await health.load(["groq:a", "gemini:b"])
    expect(health.isAvailable(states.get("groq:a")!, NOW)).toBe(true)
  })

  it("restores a cooled-down target from stored state", async () => {
    const { client } = fakeClient([
      { target: "groq:a", consecutive_failures: 3, open_until: new Date(NOW + 60_000).toISOString() },
    ])
    const health = createProviderHealth({ client, now: () => NOW })
    const states = await health.load(["groq:a"])
    expect(health.isAvailable(states.get("groq:a")!, NOW)).toBe(false)
    expect(states.get("groq:a")!.consecutiveFailures).toBe(3)
  })

  it("persists a failure as an upsert keyed on the target", async () => {
    const { client, upserts } = fakeClient()
    const health = createProviderHealth({ client, now: () => NOW })
    const state = initialTargetState("groq:a")
    await health.recordFailure(state, { kind: "server_error", cooldownMs: 1_000, retryNext: true })
    expect(upserts).toHaveLength(1)
    expect(upserts[0].target).toBe("groq:a")
    expect(upserts[0].consecutive_failures).toBe(1)
  })

  it("keeps working in memory when no client is configured", async () => {
    const health = createProviderHealth({ client: null, now: () => NOW })
    const state = initialTargetState("groq:a")
    await health.recordFailure(state, { kind: "misconfigured", cooldownMs: 86_400_000, retryNext: true })
    const states = await health.load(["groq:a"])
    // Availability beats observability: with no service-role key the gateway
    // must still serve chat, so state lives in the process instead.
    expect(health.isAvailable(states.get("groq:a")!, NOW)).toBe(false)
  })

  it("does not throw when the store errors", async () => {
    const failing: HealthClient = {
      from() {
        return {
          select() {
            return {
              in: async () => ({ data: null, error: { message: "boom" } }),
            }
          },
          upsert: async () => ({ error: { message: "boom" } }),
        }
      },
    }
    const health = createProviderHealth({ client: failing, now: () => NOW })
    await expect(health.load(["groq:a"])).resolves.toBeInstanceOf(Map)
    await expect(
      health.recordFailure(initialTargetState("groq:a"), {
        kind: "server_error",
        cooldownMs: 1_000,
        retryNext: true,
      })
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/ai/__tests__/provider-health.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/provider-health`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ai/provider-health.ts
import "server-only"
import { createAdminClient } from "@/utils/supabase/admin"
import {
  initialTargetState,
  recordSuccess as recordSuccessTransition,
  recordFailure as recordFailureTransition,
  type TargetState,
} from "@/lib/ai/circuit"
import type { FailureDecision } from "@/lib/ai/failure"

/**
 * Structural view of the admin client, covering only the two calls this module
 * makes. Declared locally because generated Supabase types omit
 * ai_provider_state until `supabase gen types` is re-run — the same reason
 * lib/rate-limit-db.ts declares RateLimitRpcClient.
 */
export interface HealthClient {
  from(table: string): {
    select(columns: string): {
      in(column: string, values: string[]): Promise<{
        data: Record<string, unknown>[] | null
        error: { message: string } | null
      }>
    }
    upsert(values: Record<string, unknown>): Promise<{ error: { message: string } | null }>
  }
}

export interface ProviderHealth {
  load(targetIds: string[]): Promise<Map<string, TargetState>>
  isAvailable(state: TargetState, now: number): boolean
  recordFailure(state: TargetState, decision: FailureDecision, status?: number | null): Promise<void>
  recordSuccess(state: TargetState): Promise<void>
}

export interface ProviderHealthDeps {
  client?: HealthClient | null
  now?: () => number
  random?: () => number
}

/** In-process fallback, used when no service-role key is configured. */
const memory = new Map<string, TargetState>()

function rowToState(row: Record<string, unknown>): TargetState {
  const openUntil = row.open_until
  return {
    targetId: String(row.target),
    consecutiveFailures: Number(row.consecutive_failures ?? 0),
    openUntil:
      typeof openUntil === "string" ? Date.parse(openUntil) : openUntil instanceof Date ? openUntil.getTime() : null,
    lastFailureKind: (row.last_failure_kind as TargetState["lastFailureKind"]) ?? null,
    lastStatus: row.last_status == null ? null : Number(row.last_status),
    lastError: row.last_error == null ? null : String(row.last_error),
    lastUsedAt: row.last_used_at ? Date.parse(String(row.last_used_at)) : null,
    successCount: Number(row.success_count ?? 0),
    failureCount: Number(row.failure_count ?? 0),
  }
}

function stateToRow(state: TargetState): Record<string, unknown> {
  return {
    target: state.targetId,
    consecutive_failures: state.consecutiveFailures,
    open_until: state.openUntil === null ? null : new Date(state.openUntil).toISOString(),
    last_failure_kind: state.lastFailureKind,
    last_status: state.lastStatus,
    last_error: state.lastError,
    last_used_at: state.lastUsedAt === null ? null : new Date(state.lastUsedAt).toISOString(),
    success_count: state.successCount,
    failure_count: state.failureCount,
    updated_at: new Date().toISOString(),
  }
}

/**
 * Circuit state, shared across instances when a service-role key is present.
 *
 * Every method degrades to the in-process map rather than throwing. This layer
 * is an optimisation — a cold or unavailable health store must cost efficiency,
 * never availability.
 */
export function createProviderHealth(deps: ProviderHealthDeps = {}): ProviderHealth {
  const client = deps.client === undefined ? (createAdminClient() as HealthClient | null) : deps.client
  const now = deps.now ?? Date.now
  const random = deps.random ?? Math.random

  async function persist(state: TargetState): Promise<void> {
    memory.set(state.targetId, state)
    if (!client) return
    try {
      const { error } = await client.from("ai_provider_state").upsert(stateToRow(state))
      if (error) console.error("[ai-health] upsert failed", error.message)
    } catch (err) {
      console.error("[ai-health] upsert threw", err)
    }
  }

  return {
    async load(targetIds) {
      const states = new Map<string, TargetState>()
      for (const id of targetIds) {
        const cached = memory.get(id)
        if (cached) states.set(id, cached)
      }
      if (!client || targetIds.length === 0) {
        for (const id of targetIds) if (!states.has(id)) states.set(id, initialTargetState(id))
        return states
      }

      try {
        const { data, error } = await client
          .from("ai_provider_state")
          .select("*")
          .in("target", targetIds)
        if (error) throw new Error(error.message)
        for (const row of data ?? []) {
          const state = rowToState(row)
          states.set(state.targetId, state)
        }
      } catch (err) {
        console.error("[ai-health] load failed, using in-process state", err)
      }

      for (const id of targetIds) if (!states.has(id)) states.set(id, initialTargetState(id))
      return states
    },

    isAvailable(state, at) {
      return state.openUntil === null || state.openUntil <= at
    },

    async recordFailure(state, decision, status = null) {
      const next = recordFailureTransition(state, decision, now(), random, {
        kind: decision.kind,
        status,
        error: state.lastError,
      })
      await persist(next)
    },

    async recordSuccess(state) {
      await persist(recordSuccessTransition(state, now()))
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/ai/__tests__/provider-health.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/provider-health.ts lib/ai/__tests__/provider-health.test.ts
git commit -m "feat(ai): persist circuit breaker state with in-process fallback

Cross-instance state when a service-role key is configured, in-process
otherwise. Every method degrades instead of throwing: health tracking is an
efficiency optimisation, so a cold store must never take chat down."
```

---

## Task 6: Per-target quota accounting

**Files:**
- Create: `lib/ai/quota.ts`
- Test: `lib/ai/__tests__/quota.test.ts`

**Interfaces:**
- Consumes: `ProviderTarget` from `@/lib/ai/targets`; the existing `rate_limit_hit` RPC
- Produces: `QuotaClient` (structural), `QuotaTracker`, `createQuotaTracker(deps?)`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ai/__tests__/quota.test.ts
import { describe, expect, it } from "vitest"
import { createQuotaTracker, type QuotaClient } from "@/lib/ai/quota"

function fakeClient(result: { allowed: boolean; retry_after_seconds: number } | null) {
  const calls: { p_key: string; p_limit: number; p_window_seconds: number }[] = []
  const client: QuotaClient = {
    rpc: async (_fn, args) => {
      calls.push(args)
      return { data: result, error: null }
    },
  }
  return { client, calls }
}

describe("createQuotaTracker", () => {
  it("allows a request and records it against a daily window", async () => {
    const { client, calls } = fakeClient({ allowed: true, retry_after_seconds: 0 })
    const quota = createQuotaTracker({ client })
    await expect(quota.consume("groq:a", 14_000)).resolves.toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      p_key: "ai:quota:groq:a",
      p_limit: 14_000,
      p_window_seconds: 86_400,
    })
  })

  it("denies once the provider budget is spent", async () => {
    const { client } = fakeClient({ allowed: false, retry_after_seconds: 120 })
    const quota = createQuotaTracker({ client })
    await expect(quota.consume("groq:a", 14_000)).resolves.toBe(false)
  })

  it("fails open when there is no client", async () => {
    const quota = createQuotaTracker({ client: null })
    await expect(quota.consume("groq:a", 14_000)).resolves.toBe(true)
  })

  it("fails open when the RPC errors", async () => {
    const client: QuotaClient = {
      rpc: async () => ({ data: null, error: { message: "boom" } }),
    }
    const quota = createQuotaTracker({ client })
    await expect(quota.consume("groq:a", 14_000)).resolves.toBe(true)
  })

  it("does not call the store for a target with no declared budget", async () => {
    const { client, calls } = fakeClient({ allowed: false, retry_after_seconds: 0 })
    const quota = createQuotaTracker({ client })
    await expect(quota.consume("groq:a", 0)).resolves.toBe(true)
    expect(calls).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/ai/__tests__/quota.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/quota`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ai/quota.ts
import "server-only"
import { createAdminClient } from "@/utils/supabase/admin"

/** Structural view of the existing rate_limit_hit RPC. */
export interface QuotaClient {
  rpc(
    fn: "rate_limit_hit",
    args: { p_key: string; p_limit: number; p_window_seconds: number }
  ): Promise<{
    data: { allowed: boolean; retry_after_seconds: number } | null
    error: { message: string } | null
  }>
}

export interface QuotaTracker {
  /** Records one request against the target's budget. False = budget spent. */
  consume(targetId: string, dailyRequestBudget: number): Promise<boolean>
}

export interface QuotaTrackerDeps {
  client?: QuotaClient | null
}

const DAY_SECONDS = 86_400

/**
 * Free-tier request budgets, enforced before we burn a call.
 *
 * Reuses the existing rate_limit_hit RPC, which is already atomic and
 * cross-instance. The window is a rolling 24h rather than a calendar day,
 * which is stricter than the providers' own accounting and therefore safe:
 * we can only ever under-use the quota, never overshoot it.
 *
 * Fails OPEN. Free-tier capacity that goes unused because the quota store is
 * down is a worse outcome than an occasional 429 we already handle.
 */
export function createQuotaTracker(deps: QuotaTrackerDeps = {}): QuotaTracker {
  const client =
    deps.client === undefined ? (createAdminClient() as QuotaClient | null) : deps.client

  return {
    async consume(targetId, dailyRequestBudget) {
      if (!client || dailyRequestBudget <= 0) return true
      try {
        const { data, error } = await client.rpc("rate_limit_hit", {
          p_key: `ai:quota:${targetId}`,
          p_limit: dailyRequestBudget,
          p_window_seconds: DAY_SECONDS,
        })
        if (error) throw new Error(error.message)
        const row = Array.isArray(data) ? data[0] : data
        if (!row) throw new Error("rate_limit_hit returned no row")
        return Boolean(row.allowed)
      } catch (err) {
        console.error("[ai-quota] store unavailable, failing open", err)
        return true
      }
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/ai/__tests__/quota.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/quota.ts lib/ai/__tests__/quota.test.ts
git commit -m "feat(ai): enforce per-target daily request budgets

Reuses the atomic rate_limit_hit RPC so budget accounting is cross-instance.
Fails open by design: unused free-tier capacity costs more than an
occasional 429 we already know how to handle."
```

---

## Task 7: Request logger

**Files:**
- Create: `lib/ai/request-log.ts`
- Test: `lib/ai/__tests__/request-log.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `RequestLogClient` (structural), `RequestLogEntry`, `logRequest(entry, deps?)`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ai/__tests__/request-log.test.ts
import { describe, expect, it } from "vitest"
import { logRequest, type RequestLogClient } from "@/lib/ai/request-log"

function fakeClient() {
  const inserted: Record<string, unknown>[] = []
  const client: RequestLogClient = {
    from: () => ({
      insert: async (values: Record<string, unknown>) => {
        inserted.push(values)
        return { error: null }
      },
    }),
  }
  return { client, inserted }
}

describe("logRequest", () => {
  it("inserts a row with the latency breakdown", async () => {
    const { client, inserted } = fakeClient()
    await logRequest(
      {
        userId: "u1",
        targetId: "groq:a",
        outcome: "ok",
        planMs: 210,
        retrieveMs: 480,
        ttftMs: 900,
        totalMs: 3200,
        attempts: [{ targetId: "groq:a", outcome: "ok" }],
        docCount: 8,
        cacheHit: false,
        degradedReason: null,
      },
      { client }
    )
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      user_id: "u1",
      target_id: "groq:a",
      outcome: "ok",
      plan_ms: 210,
      retrieve_ms: 480,
      ttft_ms: 900,
      total_ms: 3200,
      doc_count: 8,
      cache_hit: false,
      degraded_reason: null,
    })
    expect(inserted[0].attempts).toEqual([{ targetId: "groq:a", outcome: "ok" }])
  })

  it("does not throw when no client is configured", async () => {
    await expect(
      logRequest({ outcome: "error", attempts: [] }, { client: null })
    ).resolves.toBeUndefined()
  })

  it("swallows store errors", async () => {
    const client: RequestLogClient = {
      from: () => ({
        insert: async () => ({ error: { message: "boom" } }),
      }),
    }
    await expect(logRequest({ outcome: "error", attempts: [] }, { client })).resolves.toBeUndefined()
  })

  it("records a degraded reason when retrieval was cut short", async () => {
    const { client, inserted } = fakeClient()
    await logRequest(
      { outcome: "ok", attempts: [], degradedReason: "retrieval_budget_exceeded" },
      { client }
    )
    expect(inserted[0].degraded_reason).toBe("retrieval_budget_exceeded")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/ai/__tests__/request-log.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/request-log`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ai/request-log.ts
import "server-only"
import { createAdminClient } from "@/utils/supabase/admin"

/** Structural view of the admin client, covering only the insert this module makes. */
export interface RequestLogClient {
  from(table: string): {
    insert(values: Record<string, unknown>): Promise<{ error: { message: string } | null }>
  }
}

export interface AttemptRecord {
  targetId: string
  outcome: string
  status?: number | null
}

export interface RequestLogEntry {
  outcome: string
  attempts: AttemptRecord[]
  userId?: string | null
  conversationId?: string | null
  targetId?: string | null
  planMs?: number | null
  retrieveMs?: number | null
  ttftMs?: number | null
  totalMs?: number | null
  docCount?: number | null
  cacheHit?: boolean
  degradedReason?: string | null
  promptTokens?: number | null
  completionTokens?: number | null
}

export interface RequestLogDeps {
  client?: RequestLogClient | null
}

/**
 * Fire-and-forget observability.
 *
 * Never throws and never awaited on the response path: a logging failure must
 * not turn a successful answer into an error, and it must not add latency to
 * the stream.
 */
export async function logRequest(
  entry: RequestLogEntry,
  deps: RequestLogDeps = {}
): Promise<void> {
  const client =
    deps.client === undefined ? (createAdminClient() as RequestLogClient | null) : deps.client
  if (!client) return

  try {
    const { error } = await client.from("ai_request_log").insert({
      user_id: entry.userId ?? null,
      conversation_id: entry.conversationId ?? null,
      target_id: entry.targetId ?? null,
      outcome: entry.outcome,
      plan_ms: entry.planMs ?? null,
      retrieve_ms: entry.retrieveMs ?? null,
      ttft_ms: entry.ttftMs ?? null,
      total_ms: entry.totalMs ?? null,
      attempts: entry.attempts,
      doc_count: entry.docCount ?? null,
      cache_hit: entry.cacheHit ?? false,
      degraded_reason: entry.degradedReason ?? null,
      prompt_tokens: entry.promptTokens ?? null,
      completion_tokens: entry.completionTokens ?? null,
    })
    if (error) console.error("[ai-log] insert failed", error.message)
  } catch (err) {
    console.error("[ai-log] insert threw", err)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/ai/__tests__/request-log.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/request-log.ts lib/ai/__tests__/request-log.test.ts
git commit -m "feat(ai): log one request row per chat call with a latency breakdown

Fire-and-forget and never thrown from, so observability cannot turn a good
answer into an error. The stage timings are what make a slow request
diagnosable without a tracing vendor."
```

---

## Task 8: Structured output with bounded repair

**Files:**
- Create: `lib/ai/structured.ts`
- Test: `lib/ai/__tests__/structured.test.ts`

**Interfaces:**
- Consumes: `zod`
- Produces: `StructuredCall`, `ParseResult`, `extractJson(raw)`, `parseAgainst(schema, raw)`,
  `generateStructured<T>(args)`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ai/__tests__/structured.test.ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/ai/__tests__/structured.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/structured`.

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/ai/__tests__/structured.test.ts`
Expected: PASS — 10 tests.

If `z.toJSONSchema` is unavailable, the installed Zod major is not 4 — fix the install rather
than adding `zod-to-json-schema`.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/structured.ts lib/ai/__tests__/structured.test.ts
git commit -m "feat(ai): structured output with a bounded repair ladder

One Zod schema generates the wire schema, validates the response, and drives
the repair prompt. Truncated responses are re-run rather than repaired, since
closing an open brace fabricates data. Returns null instead of throwing so
callers can degrade to the deterministic path."
```

---

## Task 9: SSE frame parser

**Files:**
- Create: `lib/ai/sse.ts`
- Test: `lib/ai/__tests__/sse.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `SseFrame`, `SseParser`, `createSseParser()`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ai/__tests__/sse.test.ts
import { describe, expect, it } from "vitest"
import { createSseParser } from "@/lib/ai/sse"

describe("createSseParser", () => {
  it("extracts content deltas from a complete frame", () => {
    const parser = createSseParser()
    const frames = parser.push('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n')
    expect(frames).toHaveLength(1)
    expect(frames[0].delta).toBe("Hi")
  })

  it("buffers a frame split across chunks", () => {
    const parser = createSseParser()
    expect(parser.push('data: {"choices":[{"delta":')).toHaveLength(0)
    const frames = parser.push('{"content":"Hi"}}]}\n\n')
    expect(frames).toHaveLength(1)
    expect(frames[0].delta).toBe("Hi")
  })

  it("handles CRLF line endings", () => {
    const parser = createSseParser()
    const frames = parser.push('data: {"choices":[{"delta":{"content":"Hi"}}]}\r\n\r\n')
    expect(frames).toHaveLength(1)
    expect(frames[0].delta).toBe("Hi")
  })

  it("ignores keep-alive comments and the DONE sentinel", () => {
    const parser = createSseParser()
    const frames = parser.push(": OPENROUTER PROCESSING\n\ndata: [DONE]\n\n")
    expect(frames).toHaveLength(0)
  })

  it("surfaces the finish reason", () => {
    const parser = createSseParser()
    const frames = parser.push('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n')
    expect(frames[0].finishReason).toBe("length")
  })

  it("surfaces a reasoning channel separately from content", () => {
    const parser = createSseParser()
    const frames = parser.push(
      'data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}\n\n'
    )
    expect(frames[0].reasoning).toBe("thinking...")
    expect(frames[0].delta).toBeUndefined()
  })

  it("reports an error payload as an error frame", () => {
    const parser = createSseParser()
    const frames = parser.push('data: {"error":{"message":"upstream exploded"}}\n\n')
    expect(frames[0].error).toBe("upstream exploded")
  })

  it("skips a malformed frame without losing the next one", () => {
    const parser = createSseParser()
    const frames = parser.push(
      'data: {not json\n\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\n'
    )
    expect(frames).toHaveLength(1)
    expect(frames[0].delta).toBe("ok")
  })

  it("flushes a trailing frame with no terminating blank line", () => {
    const parser = createSseParser()
    parser.push('data: {"choices":[{"delta":{"content":"tail"}}]}')
    const frames = parser.flush()
    expect(frames).toHaveLength(1)
    expect(frames[0].delta).toBe("tail")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/ai/__tests__/sse.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/sse`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ai/sse.ts
export interface SseFrame {
  delta?: string
  reasoning?: string
  finishReason?: string | null
  error?: string
}

export interface SseParser {
  /** Feed decoded text; returns every frame that became complete. */
  push(chunk: string): SseFrame[]
  /** Emit a final frame when the body ended without a terminating blank line. */
  flush(): SseFrame[]
}

interface RawFrame {
  choices?: Array<{
    delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null }
    finish_reason?: string | null
  }>
  error?: { message?: string }
}

/**
 * Parser for the OpenAI-compatible SSE dialect.
 *
 * Tolerates the three things real providers do that break a naive
 * `split("\n")` loop: frames split across chunk boundaries, CRLF line endings,
 * and the trailing frame arriving without its blank-line terminator. A
 * malformed frame is dropped rather than throwing, because losing one delta is
 * recoverable while aborting the stream is not.
 */
export function createSseParser(): SseParser {
  let buffer = ""

  function parseLines(terminated: boolean): SseFrame[] {
    const frames: SseFrame[] = []
    const parts = buffer.split(/\r?\n/)
    // When the caller is flushing, the final part is content rather than a
    // partial line awaiting more input.
    buffer = terminated ? "" : (parts.pop() ?? "")

    for (const rawLine of parts) {
      const line = rawLine.trim()
      if (!line) continue
      if (line.startsWith(":")) continue
      if (!line.startsWith("data:")) continue

      const payload = line.slice(5).trim()
      if (!payload || payload === "[DONE]") continue

      let parsed: RawFrame
      try {
        parsed = JSON.parse(payload)
      } catch {
        continue
      }

      if (parsed.error?.message) {
        frames.push({ error: parsed.error.message })
        continue
      }

      const choice = parsed.choices?.[0]
      if (!choice) continue

      const frame: SseFrame = {}
      if (choice.finish_reason) frame.finishReason = choice.finish_reason

      const delta = choice.delta?.content
      if (typeof delta === "string" && delta) frame.delta = delta

      const reasoning = choice.delta?.reasoning_content ?? choice.delta?.reasoning
      if (typeof reasoning === "string" && reasoning) frame.reasoning = reasoning

      if (frame.delta || frame.reasoning || frame.finishReason) frames.push(frame)
    }

    return frames
  }

  return {
    push(chunk) {
      buffer += chunk
      return parseLines(false)
    },
    flush() {
      if (!buffer.trim()) {
        buffer = ""
        return []
      }
      const pending = buffer
      buffer = pending.endsWith("\n") ? pending : `${pending}\n\n`
      return parseLines(true)
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/ai/__tests__/sse.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/sse.ts lib/ai/__tests__/sse.test.ts
git commit -m "feat(ai): add tolerant SSE frame parser

Handles frames split across chunk boundaries, CRLF endings, and a missing
terminating blank line, all of which occur in practice. Reasoning is surfaced
on its own channel where a provider supplies one, rather than being inferred
from text patterns. A malformed frame is dropped instead of aborting the
stream."
```

---

## Task 10: Streaming gateway with failover

**Files:**
- Create: `lib/ai/gateway.ts`
- Test: `lib/ai/__tests__/gateway.test.ts`

**Interfaces:**
- Consumes: `ProviderTarget` from `@/lib/ai/targets`; `classifyFailure` from `@/lib/ai/failure`;
  `createProviderHealth`, `ProviderHealth` from `@/lib/ai/provider-health`;
  `createQuotaTracker`, `QuotaTracker` from `@/lib/ai/quota`; `createSseParser` from `@/lib/ai/sse`
- Produces: `ChatMessage`, `StreamChatArgs`, `StreamChatResult`, `createGateway(deps?)`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ai/__tests__/gateway.test.ts
import { describe, expect, it } from "vitest"
import { createGateway } from "@/lib/ai/gateway"
import { initialTargetState } from "@/lib/ai/circuit"
import type { ProviderHealth } from "@/lib/ai/provider-health"
import type { QuotaTracker } from "@/lib/ai/quota"
import type { ProviderTarget } from "@/lib/ai/targets"

const NOW = Date.parse("2026-09-19T10:00:00.000Z")

function target(id: string): ProviderTarget {
  return {
    id,
    provider: "groq",
    model: id.split(":")[1],
    url: "https://example.test/v1/chat/completions",
    apiKey: "k",
    tier: "answer",
    supportsJsonSchema: false,
    emitsReasoningChannel: true,
    maxOutputTokens: 512,
    dailyRequestBudget: 100,
  }
}

function sse(...deltas: string[]): string {
  return deltas
    .map((d) => `data: {"choices":[{"delta":{"content":${JSON.stringify(d)}}}]}\n\n`)
    .join("")
}

function streamingResponse(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body))
        controller.close()
      },
    }),
    { status: init.status ?? 200, headers: init.headers }
  )
}

/**
 * Inert stores for the tests that are about streaming rather than about health
 * or quota.
 *
 * Without them `createGateway` builds the REAL stores, and vitest loads
 * `.env.local`, so those tests would be talking to the live project:
 * `quota.consume` would spend real budget through the `rate_limit_hit` RPC, and
 * `health.load` would query `ai_provider_state`, which this plan deliberately
 * has not applied remotely. A unit test must not spend a real budget, and must
 * not depend on a remote round trip to pass. Tests that need specific store
 * behaviour pass their own fake and override these.
 */
function inertStores(): { health: ProviderHealth; quota: QuotaTracker } {
  return {
    health: {
      async load(ids) {
        return new Map(ids.map((id) => [id, initialTargetState(id)]))
      },
      isAvailable(state, at) {
        return state.openUntil === null || state.openUntil <= at
      },
      async recordFailure() {},
      async recordSuccess() {},
    },
    quota: {
      async consume() {
        return true
      },
    },
  }
}

function createTestGateway(
  deps: Parameters<typeof createGateway>[0] = {}
): ReturnType<typeof createGateway> {
  return createGateway({ ...inertStores(), ...deps })
}

describe("createGateway", () => {
  it("streams from the first healthy target and records success", async () => {
    const gateway = createTestGateway({
      now: () => NOW,
      fetchImpl: async () => streamingResponse(sse("Hello", " world")),
    })
    const chunks: string[] = []
    const result = await gateway.streamChat({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a")],
      signal: new AbortController().signal,
      onDelta: (text) => chunks.push(text),
    })
    expect(chunks.join("")).toBe("Hello world")
    expect(result.ok).toBe(true)
    expect(result.targetId).toBe("groq:a")
    expect(result.midStreamFailure).toBe(false)
  })

  it("fails over to the next target on 429 and honours Retry-After", async () => {
    let call = 0
    const gateway = createTestGateway({
      now: () => NOW,
      fetchImpl: async () => {
        call += 1
        if (call === 1) {
          return new Response("slow down", {
            status: 429,
            headers: { "Retry-After": "45" },
          })
        }
        return streamingResponse(sse("second"))
      },
    })
    const result = await gateway.streamChat({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a"), target("groq:b")],
      signal: new AbortController().signal,
      onDelta: () => {},
    })
    expect(result.targetId).toBe("groq:b")
    expect(result.attempts[0]).toMatchObject({ targetId: "groq:a", outcome: "rate_limited" })
  })

  it("reports failure when every target fails, and never throws", async () => {
    const gateway = createTestGateway({
      now: () => NOW,
      fetchImpl: async () => new Response("nope", { status: 429 }),
    })
    const result = await gateway.streamChat({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a"), target("groq:b")],
      signal: new AbortController().signal,
      onDelta: () => {},
    })
    expect(result.ok).toBe(false)
    expect(result.rateLimited).toBe(true)
    expect(result.textChars).toBe(0)
  })

  it("skips a target whose circuit is open", async () => {
    const fetchImpl = async () => streamingResponse(sse("hi"))
    const gateway = createTestGateway({
      now: () => NOW,
      fetchImpl,
      health: {
        async load() {
          const map = new Map()
          map.set("groq:a", {
            targetId: "groq:a",
            consecutiveFailures: 3,
            openUntil: NOW + 60_000,
            lastFailureKind: "server_error" as const,
            lastStatus: 500,
            lastError: null,
            lastUsedAt: NOW,
            successCount: 0,
            failureCount: 3,
          })
          map.set("groq:b", {
            targetId: "groq:b",
            consecutiveFailures: 0,
            openUntil: null,
            lastFailureKind: null,
            lastStatus: null,
            lastError: null,
            lastUsedAt: null,
            successCount: 0,
            failureCount: 0,
          })
          return map
        },
        isAvailable(state, at) {
          return state.openUntil === null || state.openUntil <= at
        },
        async recordFailure() {},
        async recordSuccess() {},
      },
    })
    const result = await gateway.streamChat({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a"), target("groq:b")],
      signal: new AbortController().signal,
      onDelta: () => {},
    })
    expect(result.targetId).toBe("groq:b")
    expect(result.attempts[0]).toMatchObject({ targetId: "groq:a", outcome: "circuit_open" })
  })

  it("flags a mid-stream failure but keeps the partial answer", async () => {
    const encoder = new TextEncoder()
    const gateway = createTestGateway({
      now: () => NOW,
      // The error must be raised from pull(), not from start(): erroring a
      // stream resets its queue, so enqueue-then-error inside start() would
      // discard the chunk before the gateway ever reads it and the test would
      // assert against zero text.
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(sse("The victim was")))
            },
            pull(controller) {
              controller.error(new Error("connection reset"))
            },
          }),
          { status: 200 }
        ),
    })
    const chunks: string[] = []
    const result = await gateway.streamChat({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a")],
      signal: new AbortController().signal,
      onDelta: (text) => chunks.push(text),
    })
    expect(chunks.join("")).toBe("The victim was")
    expect(result.midStreamFailure).toBe(true)
    // Partial text exists, so failover would duplicate content; the UI offers
    // regenerate instead. Marking it complete is the bug being fixed.
    expect(result.truncated).toBe(true)
  })

  it("does not count a 200 response with no content as success", async () => {
    let call = 0
    const gateway = createTestGateway({
      now: () => NOW,
      fetchImpl: async () => {
        call += 1
        if (call === 1) {
          return streamingResponse('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n')
        }
        return streamingResponse(sse("real answer"))
      },
    })
    const result = await gateway.streamChat({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a"), target("groq:b")],
      signal: new AbortController().signal,
      onDelta: () => {},
    })
    expect(result.targetId).toBe("groq:b")
    expect(result.attempts[0]).toMatchObject({ targetId: "groq:a", outcome: "empty_output" })
  })

  it("passes through the reasoning channel separately", async () => {
    const gateway = createTestGateway({
      now: () => NOW,
      fetchImpl: async () =>
        streamingResponse(
          'data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}\n\ndata: {"choices":[{"delta":{"content":"Answer"}}]}\n\n'
        ),
    })
    const reasoning: string[] = []
    const deltas: string[] = []
    await gateway.streamChat({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a")],
      signal: new AbortController().signal,
      onDelta: (text) => deltas.push(text),
      onReasoning: (text) => reasoning.push(text),
    })
    expect(deltas.join("")).toBe("Answer")
    expect(reasoning.join("")).toBe("hmm")
  })

  it("stops cleanly when the client aborts", async () => {
    const controller = new AbortController()
    const gateway = createTestGateway({
      now: () => NOW,
      fetchImpl: async () => {
        controller.abort()
        const error = new Error("aborted")
        error.name = "AbortError"
        throw error
      },
    })
    const result = await gateway.streamChat({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a")],
      signal: controller.signal,
      onDelta: () => {},
    })
    expect(result.aborted).toBe(true)
    expect(result.ok).toBe(false)
  })

  it("skips a target whose daily budget is spent", async () => {
    const gateway = createTestGateway({
      now: () => NOW,
      fetchImpl: async () => streamingResponse(sse("hi")),
      quota: { async consume() { return false } },
    })
    const result = await gateway.streamChat({
      messages: [{ role: "user", content: "hi" }],
      targets: [target("groq:a")],
      signal: new AbortController().signal,
      onDelta: () => {},
    })
    expect(result.ok).toBe(false)
    expect(result.attempts[0]).toMatchObject({ targetId: "groq:a", outcome: "quota_exhausted" })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/ai/__tests__/gateway.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/gateway`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ai/gateway.ts
import "server-only"
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

export interface GatewayDeps {
  fetchImpl?: typeof fetch
  health?: ProviderHealth
  quota?: QuotaTracker
  now?: () => number
}

export interface Gateway {
  streamChat(args: StreamChatArgs): Promise<StreamChatResult>
}

const DEFAULT_FIRST_TOKEN_MS = 4_000
const DEFAULT_STREAM_MS = 30_000

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

        const startedAt = now()
        let state = states.get(target.id)
        if (!state) {
          state = {
            targetId: target.id,
            consecutiveFailures: 0,
            openUntil: null,
            lastFailureKind: null,
            lastStatus: null,
            lastError: null,
            lastUsedAt: null,
            successCount: 0,
            failureCount: 0,
          }
        }

        if (!health.isAvailable(state, startedAt)) {
          attempts.push({ targetId: target.id, outcome: "circuit_open", ms: 0 })
          continue
        }

        if (!(await quota.consume(target.id, target.dailyRequestBudget))) {
          attempts.push({ targetId: target.id, outcome: "quota_exhausted", ms: 0 })
          continue
        }

        const headers: Record<string, string> = {
          Authorization: `Bearer ${target.apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(target.headers ?? {}),
        }

        let response: Response
        try {
          response = await fetchImpl(target.url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: target.model,
              stream: true,
              temperature,
              max_tokens: maxOutputTokens ?? target.maxOutputTokens,
              messages,
            }),
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
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/ai/__tests__/gateway.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Run the full suite and the typecheck**

```bash
npm test && npx tsc --noEmit && npm run lint
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/gateway.ts lib/ai/__tests__/gateway.test.ts
git commit -m "feat(ai): streaming gateway with circuit-aware failover

Consults circuit state and daily budget before spending a request, classifies
every failure instead of logging it as OpenRouter, and stops failing over once
text has started flowing so two providers' answers are never stitched
together. A partial answer is preserved and flagged rather than presented as
complete, and a 200 response with no content no longer counts as success."
```

---

## Task 11: Harden and rewire the AI chat route

**Files:**
- Modify: `app/api/ai-chat/route.ts` (full replace)
- Test: covered by Task 12

**Interfaces:**
- Consumes: `buildProviderTargets` from `@/lib/ai/targets`; `createGateway` from `@/lib/ai/gateway`;
  `rateLimitPersistent` from `@/lib/rate-limit-db`; `logRequest` from `@/lib/ai/request-log`
- Produces: unchanged HTTP contract — `POST` returning `text/plain` stream, 401/400/429 JSON errors

- [ ] **Step 1: Replace the route**

Keep every piece of `lib/chat/*` behaviour: same auth, same intent gate, same retrieval, same
prompt. Only the provider layer, limits and observability change.

```ts
// app/api/ai-chat/route.ts
import { createClient } from "@/utils/supabase/server"
import { searchAll } from "@/lib/chat/search"
import { buildSystemPrompt } from "@/lib/chat/prompt"
import {
  REFUSAL_NO_CONTEXT,
  classifyChatIntent,
  shouldRefuseForMissingContext,
} from "@/lib/chat/intent"
import { buildProviderTargets } from "@/lib/ai/targets"
import { createGateway } from "@/lib/ai/gateway"
import { logRequest } from "@/lib/ai/request-log"
import { rateLimitPersistent } from "@/lib/rate-limit-db"

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

const RATE_LIMIT = { limit: 20, windowMs: 5 * 60 * 1000 }

const EMPTY_RESULT_MESSAGE =
  "I could not find a reliable answer for that. Try naming the episode number, movie number, or character you mean."
const RATE_LIMITED_MESSAGE =
  "All free AI providers are temporarily at capacity. Please try again in a moment."
const PARTIAL_RESULT_SUFFIX = "\n\n_(The response was cut short. Ask again to retry.)_"

type ChatRole = "user" | "assistant"
interface ChatTurn {
  role: ChatRole
  content: string
}

/**
 * History is accepted from the client but treated as untrusted: it is only
 * ever replayed as conversational context, and roles are restricted so a
 * caller cannot inject a `system` turn. Server-owned transcripts arrive in a
 * later phase; until then this stays the authoritative sanitiser.
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

  const { message, history } = (body ?? {}) as { message?: unknown; history?: unknown }
  if (typeof message !== "string" || !message.trim()) {
    return jsonError("A non-empty `message` is required.", 400)
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return jsonError(`Message too long (max ${MAX_MESSAGE_CHARS} characters).`, 400)
  }

  const userMessage = message.trim()
  const priorTurns = sanitizeHistory(history)

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

  const lastUserTurn = [...priorTurns].reverse().find((t) => t.role === "user")
  const searchQuery = lastUserTurn ? `${lastUserTurn.content} ${userMessage}` : userMessage

  const retrieveStartedAt = Date.now()
  let context: Awaited<ReturnType<typeof searchAll>>
  let retrievalFailed = false
  try {
    context = await searchAll(searchQuery, userId)
  } catch {
    retrievalFailed = true
    context = { episodes: [], cases: [], dcwWiki: [] }
  }
  const retrieveMs = Date.now() - retrieveStartedAt

  const hasInDomainContext =
    context.episodes.length > 0 ||
    context.cases.length > 0 ||
    context.dcwWiki.some((r) => r.source === "dcw")
  if (
    shouldRefuseForMissingContext({
      searchQuery,
      priorUserMessages: priorTurns.filter((t) => t.role === "user").map((t) => t.content),
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
  const gateway = createGateway()
  const requestStartedAt = Date.now()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      let firstTokenMs: number | null = null

      const close = () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          // Already closed by a client disconnect.
        }
      }

      const enqueue = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          closed = true
        }
      }

      // One budget for the whole request, not one per provider. The gateway's
      // timeouts are per target, so a run of stalled providers can outlast the
      // platform's own limit — and a response the platform cuts never gets the
      // "cut short" label. Aborting ourselves keeps that label ours to write.
      const budget = new AbortController()
      const budgetTimer = setTimeout(() => budget.abort(), TOTAL_BUDGET_MS)
      const abortOnDisconnect = () => budget.abort()
      if (request.signal.aborted) {
        budget.abort()
      } else {
        request.signal.addEventListener("abort", abortOnDisconnect)
      }

      let result
      try {
        result = await gateway.streamChat({
          messages,
          targets,
          signal: budget.signal,
          onDelta: (text) => {
            if (firstTokenMs === null) firstTokenMs = Date.now() - requestStartedAt
            enqueue(text)
          },
        })
      } finally {
        clearTimeout(budgetTimer)
        request.signal.removeEventListener("abort", abortOnDisconnect)
      }

      if (result.aborted) {
        // Our own budget expiring is not the same as the user closing the tab:
        // in the first case they are still listening and the answer must be
        // labelled, in the second there is nobody left to tell.
        if (result.textChars > 0 && !request.signal.aborted) {
          enqueue(PARTIAL_RESULT_SUFFIX)
        }
        close()
      } else if (!result.ok) {
        enqueue(result.rateLimited ? RATE_LIMITED_MESSAGE : EMPTY_RESULT_MESSAGE)
        close()
      } else {
        if (result.midStreamFailure || result.truncated) enqueue(PARTIAL_RESULT_SUFFIX)
        close()
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
        docCount: context.episodes.length + context.cases.length + context.dcwWiki.length,
        degradedReason: retrievalFailed ? "retrieval_failed" : null,
      })
    },
    cancel() {
      // The client disconnected. Upstream reads are released inside the
      // gateway's finally block; nothing to do here.
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
```

- [ ] **Step 2: Verify the deleted code is gone**

```bash
grep -n "OPENROUTER_URL\|function buildProviderTargets\|function pumpStream\|OpenRouter stream error" app/api/ai-chat/route.ts
```
Expected: no output. `ThinkingFilter` is no longer imported by the route — reasoning is handled
by the gateway — but `lib/chat/answer.ts` is **not** deleted, because the prompt-filtering
helpers are still referenced by `lib/__tests__/chat-answer.test.ts`. Removing the module is a
later phase.

- [ ] **Step 3: Verify the old test suite still passes**

```bash
npm test && npx tsc --noEmit && npm run lint
```
Expected: all green. If `lib/chat/answer.ts` is now unused by production code, `eslint` may
report nothing (it does not flag unused exports), so no action is needed here.

- [ ] **Step 4: Commit**

```bash
git add app/api/ai-chat/route.ts
git commit -m "refactor(ai): rewire the chat route onto the model gateway

Replaces the sequential retry loop and local SSE pump with the gateway, adds
the missing rate limit and same-origin guard, caps the body size, and sets an
explicit maxDuration so the platform cannot cut a stream mid-answer. A partial
answer is now labelled rather than presented as complete."
```

---

## Task 12: Route integration test

**Files:**
- Create: `app/api/ai-chat/route.integration.test.ts`
- Modify: `vitest.config.mts` (only if the include glob excludes this path — `**/*.test.ts`
  already matches, so expect no change)

**Interfaces:**
- Consumes: the route from Task 11
- Produces: nothing

- [ ] **Step 1: Write the failing test**

The route imports `@/utils/supabase/server` (cookie-bound) and `@/lib/chat/search` (live
network). Both are mocked so the test is offline and deterministic.

The two gateway stores are mocked for isolation, not convenience. `vitest.config.mts`
loads `.env.local`, so a real `SUPABASE_SERVICE_ROLE_KEY` is present on a developer
machine: without these mocks the test would build a real service-role client and call
`rate_limit_hit` and `ai_provider_state` against the live project — and the migration that
creates those tables is deliberately not applied remotely yet (Task 4). A machine with no
`.env.local` would instead throw at import, because `@/lib/env` calls `required()` at
module scope. `vi.mock` replaces the module before it is evaluated, which removes both
failure modes. Both stores are covered properly by their own offline unit tests in Tasks 5
and 6; here they only have to be inert.

```ts
// app/api/ai-chat/route.integration.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getUser = vi.fn()
const maybeSingle = vi.fn()

vi.mock("@/utils/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }),
  }),
}))

const searchAll = vi.fn()
vi.mock("@/lib/chat/search", () => ({
  searchAll: (...args: unknown[]) => searchAll(...args),
}))

vi.mock("@/lib/chat/prompt", () => ({
  buildSystemPrompt: () => "SYSTEM PROMPT",
}))

const rateLimitPersistent = vi.fn()
vi.mock("@/lib/rate-limit-db", () => ({
  rateLimitPersistent: (...args: unknown[]) => rateLimitPersistent(...args),
}))

const logRequest = vi.fn()
vi.mock("@/lib/ai/request-log", () => ({
  logRequest: (...args: unknown[]) => logRequest(...args),
}))

// Inert stores: no circuit is open, every daily budget has room. See the note
// above — these stand in for modules that cannot be imported without env.
vi.mock("@/lib/ai/provider-health", () => ({
  createProviderHealth: () => ({
    load: async () => new Map(),
    isAvailable: () => true,
    recordFailure: async () => {},
    recordSuccess: async () => {},
  }),
}))

vi.mock("@/lib/ai/quota", () => ({
  createQuotaTracker: () => ({ consume: async () => true }),
}))

const KEY = "test-key"

function sse(...deltas: string[]): string {
  return deltas
    .map((d) => `data: {"choices":[{"delta":{"content":${JSON.stringify(d)}}}]}\n\n`)
    .join("")
}

function providerResponse(body: string, status = 200) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body))
        controller.close()
      },
    }),
    { status }
  )
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/ai-chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      host: "localhost",
      origin: "http://localhost",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

async function readText(response: Response): Promise<string> {
  return await response.text()
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GROQ_API_KEY = KEY
  delete process.env.GEMINI_API_KEY
  delete process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_API_KEY_2
  delete process.env.CEREBRAS_API_KEY
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
  maybeSingle.mockResolvedValue({ data: { display_name: "Noah", username: "noah" } })
  rateLimitPersistent.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
  searchAll.mockResolvedValue({ episodes: [], cases: [], dcwWiki: [] })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("POST /api/ai-chat", () => {
  it("streams an answer from the provider", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => providerResponse(sse("Hi ", "there"))))
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(post({ message: "Who is Haibara?" }))
    expect(response.status).toBe(200)
    expect(await readText(response)).toBe("Hi there")
  })

  it("rejects an unauthenticated caller with 401", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    vi.stubGlobal("fetch", vi.fn())
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(post({ message: "hi" }))
    expect(response.status).toBe(401)
  })

  it("rejects a cross-origin request with 403", async () => {
    vi.stubGlobal("fetch", vi.fn())
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(
      post({ message: "hi" }, { origin: "https://evil.example", host: "localhost" })
    )
    expect(response.status).toBe(403)
  })

  it("returns 429 with Retry-After when the rate limit is exhausted", async () => {
    rateLimitPersistent.mockResolvedValue({ allowed: false, retryAfterSeconds: 42 })
    vi.stubGlobal("fetch", vi.fn())
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(post({ message: "hi" }))
    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("42")
  })

  it("never calls a provider for an out-of-domain request", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(post({ message: "Write me a Python web scraper" }))
    expect(response.status).toBe(200)
    expect(await readText(response)).toMatch(/Detective Conan/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses a question retrieval could not ground in the series", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(post({ message: "Who won the 1998 World Cup?" }))
    expect(response.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("labels a partial answer instead of presenting it as complete", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const encoder = new TextEncoder()
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(sse("The victim was")))
            },
            // The error must come from pull(), not start(): erroring a stream
            // resets its queue, so enqueue-then-error in the same callback
            // discards the chunk and the route correctly sees an empty
            // response instead of a partial one.
            pull(controller) {
              controller.error(new Error("connection reset"))
            },
          }),
          { status: 200 }
        )
      })
    )
    const { POST } = await import("@/app/api/ai-chat/route")

    const text = await readText(await POST(post({ message: "Who is Haibara?" })))
    expect(text).toContain("The victim was")
    expect(text).toContain("cut short")
  })

  it("reports capacity exhaustion when every provider is rate limited", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 429 })))
    const { POST } = await import("@/app/api/ai-chat/route")

    const text = await readText(await POST(post({ message: "Who is Haibara?" })))
    expect(text).toMatch(/at capacity/i)
  })

  it("falls over to the next model when the first returns empty content", async () => {
    let call = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1
        if (call === 1) {
          return providerResponse('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n')
        }
        return providerResponse(sse("Second model answered"))
      })
    )
    const { POST } = await import("@/app/api/ai-chat/route")

    const text = await readText(await POST(post({ message: "Who is Haibara?" })))
    expect(text).toBe("Second model answered")
  })

  it("rejects an oversized message with 400", async () => {
    vi.stubGlobal("fetch", vi.fn())
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(post({ message: "x".repeat(1001) }))
    expect(response.status).toBe(400)
  })

  it("rejects a non-JSON body with 400", async () => {
    vi.stubGlobal("fetch", vi.fn())
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(
      new Request("http://localhost/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", host: "localhost" },
        body: "not json",
      })
    )
    expect(response.status).toBe(400)
  })

  it("returns 500 when no provider is configured", async () => {
    delete process.env.GROQ_API_KEY
    vi.stubGlobal("fetch", vi.fn())
    const { POST } = await import("@/app/api/ai-chat/route")

    const response = await POST(post({ message: "hi" }))
    expect(response.status).toBe(500)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/api/ai-chat/route.integration.test.ts`
Expected: FAIL if Task 11 is incomplete. If Task 11 is done, most tests should already pass —
run it and confirm; any failure here is a real defect in Task 11, not a test problem.

- [ ] **Step 3: Fix whatever the tests reveal**

Do not weaken an assertion to make it pass. The assertions encode the Review Focus list: a
cross-origin request must be refused, a partial answer must be labelled, an ungrounded
question must not reach a provider, an empty-content 200 must not end the attempt loop.

- [ ] **Step 4: Run the full suite**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
```
Expected: all green. The build step matters here — the route is imported at build time during
page-data collection, so a bad top-level import surfaces only in `build`.

- [ ] **Step 5: Commit**

```bash
git add app/api/ai-chat/route.integration.test.ts
git commit -m "test(ai): add route integration coverage with a mocked provider

Covers the paths that had no test at all: auth, cross-origin rejection, rate
limiting, refusal short-circuits, partial-answer labelling, empty-content
failover, capacity exhaustion, and body validation. Providers and Supabase are
mocked, so the suite is offline and deterministic."
```

---

## Task 13: Document the AI provider configuration

**Files:**
- Modify: `.env.example`
- Modify: `SYSTEM_DOCS.md` (the "Environment Variables" and "AI Chatbot" sections)
- Modify: `lib/chat/answer.ts` (header comment only — record that the route no longer uses it)

**Interfaces:**
- Consumes: `buildProviderTargets` behaviour from Task 1
- Produces: documentation

- [ ] **Step 1: Add the AI keys to `.env.example`**

Append after `NEXT_PUBLIC_SITE_URL`:

```bash
# ── AI Chatbot providers (all optional, all free tier) ────────────────
# At least ONE must be set or /api/ai-chat returns 500.
# Every key is server-only: never prefix these with NEXT_PUBLIC_.
#
# Tried in this order, skipping any target whose circuit is open:
#   1. Gemini (AI Studio)   - strict JSON schema support, ~1,400 req/day
#   2. Groq (Cloud)         - fastest, json_object only, ~14,000 req/day
#   3. OpenRouter (:free)   - strict schema unsupported, ~50 req/day per key
#   4. Cerebras             - strict JSON schema support, ~900 req/day
#
# Comma-separate multiple OpenRouter keys in one variable; duplicates and
# blank entries are ignored. OPENROUTER_API_KEY_2 is merged with the first.
GEMINI_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=
OPENROUTER_API_KEY_2=
CEREBRAS_API_KEY=
```

- [ ] **Step 2: Correct `SYSTEM_DOCS.md`**

In the "Environment Variables" block, add the five keys. In the "AI Chatbot → Architecture"
block, replace the provider-fallback description with the real behaviour:

```
      → Model gateway (lib/ai/gateway.ts):
          Circuit state and daily budget are checked per target before a request
          is spent. Failures are classified (misconfigured / rate_limited /
          server_error / timeout / network / empty_output) and a misconfigured
          target is cooled down for 24h rather than retried on every request.
          Failover stops once text has started streaming, so a partial answer is
          kept and labelled instead of being stitched to another model's reply.
```

Also update the feature list: reasoning is forwarded on its own channel where the provider
supplies one, and the request log table is new.

- [ ] **Step 3: Note the pending removal in `lib/chat/answer.ts`**

Replace the file's top doc comment's first paragraph with one that records current status:

```ts
/**
 * Reasoning and non-answer text filtering.
 *
 * STATUS: the streaming `ThinkingFilter` is no longer used by
 * app/api/ai-chat/route.ts — the model gateway forwards a provider's reasoning
 * channel directly. The pure helpers below are still covered by
 * lib/__tests__/chat-answer.test.ts and remain for providers that deliver
 * reasoning inline. Removing them is part of the retrieval/prompt rewrite.
 */
```

- [ ] **Step 4: Confirm the docs are accurate**

```bash
grep -n "GEMINI_API_KEY" .env.example SYSTEM_DOCS.md
grep -n "openrouter/free" SYSTEM_DOCS.md
```
Expected: the first prints matches in both files. The second prints nothing — `openrouter/free`
survives only as the explanatory comment in `lib/ai/targets.ts` recording why the model was
removed, and a document that still lists it would be describing behaviour that no longer
exists.

- [ ] **Step 5: Full verification**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add .env.example SYSTEM_DOCS.md lib/chat/answer.ts
git commit -m "docs(ai): document provider configuration and gateway behaviour

The AI keys were documented nowhere, so the route could not be configured
locally. Also corrects the architecture doc, which described the old
unconditional provider fallback."
```

---

## Completion Criteria

Phase 0 and Phase 1 of the spec are done when all of the following hold:

- [ ] `npm test` — the existing 6 chat suites plus ~55 new tests pass.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build` — all clean.
- [ ] `/api/ai-chat` is rate limited (429 with `Retry-After`), same-origin guarded (403),
      size capped (413/400), and declares `maxDuration`.
- [ ] A misconfigured target is cooled down for 24h instead of retried every request.
- [ ] A 429 honours `Retry-After`; repeated transient failures back off exponentially with
      jitter, capped at 15 minutes.
- [ ] Each target's daily free-tier budget is enforced before a request is spent.
- [ ] A provider that dies mid-stream leaves a labelled partial answer, not a silent
      truncation, and is not stitched to another provider's output.
- [ ] A 200 response with `finish_reason: "length"` and no content falls through to the next
      target.
- [ ] Every provider interaction is recorded in `ai_request_log` with a latency breakdown and
      the attempt list.
- [ ] `ChatWidget` works unmodified: the response is still `text/plain` streaming.
- [ ] `.env.example` lists all five AI keys.

## What This Plan Does Not Do

Deferred to later plans, by design:

| Deferred | Plan |
| --- | --- |
| Indexed corpus, FTS + trigram + RRF, escalation ladder, deterministic tools | Plan 2 |
| Server-owned transcripts, rolling summaries, long-term memory, decay scoring | Plan 3 |
| Query planner, provenance-tagged assembly, injection screening, citations | Plan 4 |
| AI SDK transport, citations UI, regenerate/edit, conversation drawer | Plan 5 |
| Deleting `ThinkingFilter` and the client-supplied `history` parameter | Plans 4–5 |
| Response cache for repeated identical questions (spec §9) | Plan 2 or later |

The response cache is the one item that needs a note: spec §9 calls for it, and it is not
in any task above because a cache keyed on the question is only correct once retrieval and
prompt assembly are deterministic — that is, once Plans 2–4 have fixed what goes into the
prompt. Caching before then would serve answers grounded in a corpus that is being changed
underneath it. `ai_request_log` (Task 7) is what will make the hit-rate measurable when it
is built.
