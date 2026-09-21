# DCPH Bot — Agentic Remaster Design

**Date:** 2026-09-19
**Status:** Awaiting review
**Author:** Engineering (with NoahOsmonth)
**Scope:** `app/api/ai-chat/*`, `lib/chat/*`, `components/chat/*`, new `lib/ai/*`, Supabase schema additions

---

## 1. Goal

Turn DCPH Bot from a hand-rolled keyword-search wrapper into a **grounded, memory-bearing
assistant with an agentic retrieval loop**, while cutting the class of bugs that currently
produces empty or invented answers.

Success looks like:

| Criterion | Target |
| --- | --- |
| Grounded answers | Every factual claim traceable to a citation the UI renders |
| Retrieval recall@5 on a golden question set | ≥ 85% |
| Time to first token | p50 < 1.5s, p95 < 3.5s (retrieval no longer blocks a live wiki fetch) |
| Cross-session memory | Bot recalls a fact stated weeks earlier; user can view and delete it |
| Zero-LLM degradation | Off-topic refusal, smalltalk, and catalog lookup still work when every provider is down |
| Quota safety | No provider is retried after a deterministic 4xx; per-request LLM calls ≤ 2 on the hot path |
| Rollback | `AI_PIPELINE=v1` restores current behaviour without a redeploy of old code |

### Constraints (agreed)

1. **$0 model budget.** Free tiers only: Gemini AI Studio, Groq, OpenRouter `:free`, Cerebras.
2. **Full memory** — server-side transcripts *and* extracted long-term facts.
3. **Lexical retrieval only** — Postgres FTS + scoring. No embeddings, no pgvector.
4. **Backend + chat UI/UX remaster** (not backend-only; not the admin dashboard).

---

## 2. What the current implementation actually does

### 2.1 Call path

```
ChatWidget.send()
  → POST /api/ai-chat  { message, history[] }        ← history is CLIENT-SUPPLIED
    → auth (cookie Supabase client)
    → classifyChatIntent()            (pure regex)
    → searchAll(query)                (parallel; can take seconds)
        ├── DCW MediaWiki: up to 6 searches + 4 parses, serially throttled 200ms
        ├── Wikipedia:       up to 3 searches + extracts
        ├── content_entries: ILIKE '%term%' × 3 term-groups × 80 rows
        ├── dcw_cases:       same
        └── watch_status     (up to 500 rows)
    → shouldRefuseForMissingContext() (refuse before any LLM call)
    → buildSystemPrompt()             (raw wiki text concatenated into the SYSTEM prompt)
    → for each of ~20 provider targets, sequentially:
         fetch(stream) → pumpStream() → ThinkingFilter → text/plain chunks
```

### 2.2 Defects this design must eliminate

Verified in source; each is a real failure mode, not a style preference.

**Correctness / trust**

1. `history` is client-supplied and unauthenticated (`route.ts:302`, `sanitizeHistory:161`).
   A caller can forge assistant turns and prior system-shaped context. Transcripts must be
   server-owned.
2. `searchAll` failure is swallowed into an empty context (`route.ts:348-353`). "Retrieval
   broke" is indistinguishable from "nothing matched", so the model answers from nothing.
3. Retrieved DCW/Wikipedia text is concatenated **into the system prompt** (`prompt.ts:197-207`)
   with no provenance boundary. MediaWiki is user-editable — this is a live indirect
   prompt-injection channel.
4. `finish_reason: "length"` is recorded (`route.ts:263`) then a truncated answer is still
   shipped as complete if any text was emitted (`route.ts:460`).
5. Once `sent > 0`, no failover occurs (`route.ts:460`) — a provider that dies mid-sentence
   truncates the reply permanently.

**Cost / quota**

6. No rate limiting, no origin check on the only expensive route in the repo — 13 other
   routes use `lib/rate-limit`.
7. No request timeouts. `signal: request.signal` (`route.ts:430`) only fires on client
   disconnect; a hung provider stalls the stream indefinitely.
8. No `Retry-After` handling, no per-provider retry/backoff, no circuit breaking.
9. `openrouter/free` (`route.ts:101`) is a load balancer that serves a different model per
   request — the file's own comment at `route.ts:16-30` documents it returning 0 content
   characters and 1,644 reasoning characters, yet it remains the first OpenRouter entry.
10. A dead model name is retried on **every** request forever; nothing remembers a 404.

**Quality**

11. 2,367 lines of curated, accurate character/relationship data (`lib/characters-guide.ts`),
    plus `arcs-guide.ts`, `canon-guide.ts`, `movies-guide.ts`, are **not reachable from chat**.
    The bot instead guesses character-appearance lists from scraped wikis.
12. `ThinkingFilter` (`answer.ts`, 304 lines + ~30 regexes) infers reasoning-vs-answer
    boundaries from text patterns. Providers that label reasoning properly make this
    unnecessary; providers that don't make it unreliable.
13. The gadget list and watch-order advice are hardcoded in the system prompt
    (`prompt.ts:155-175`) duplicating knowledge that should be retrieved.
14. Context is assembled with no token budget or accounting.
15. `MAX_TOKENS = 1500` with reasoning-heavy free models consumed by thinking is exactly how
    the documented "0 content characters" failure happens.

**Hygiene**

16. `OPENROUTER_URL` (`route.ts:14`) is dead. All provider logs say "OpenRouter"
    (`route.ts:258,437,444,467`).
17. `createClient()` is constructed 4+ times per request (`search.ts` helpers each build one).
18. No tests cover `route.ts`, `lib/chat/search.ts`, or any component. `vitest.config.mts` is
    `environment: "node"`.
19. `.env.example` documents no AI keys and `.env.local` has none, so the route returns
    "Chat is not configured on this server." locally — the feature cannot be developed
    against a real provider today.

---

## 3. Approaches considered

**A. In-place restructure into a layered pipeline (recommended).** Keep Next.js routes,
keep the *tested* lexical scorer in `lib/chat/query.ts`, replace the orchestration around it.
Add Postgres. Adopt AI SDK 5 for the UI transport only.

**B. Framework rewrite (LangGraph / Mastra / LangChain).** Rejected. The published consensus
for a tool surface of this size is that graph frameworks cost more than they return; every
framework assumes reliable tool-calling, which free-tier models do not provide; and it would
discard `lib/chat/query.ts` and its tests.

**C. Single-shot hardening — fix the bugs, add memory, change nothing structural.** Rejected.
Delivers neither the agentic behaviour nor the retrieval ceiling lift that motivated the work;
defects 2, 3, 11 and 12 are structural.

---

## 4. Architecture

Six layers. Each has one job and a narrow interface, so it can be tested without the layer
above it.

```
┌──────────────────────────────────────────────────────────────────────┐
│ L6  UI           components/chat/*  — AI SDK transport, parts,       │
│                  citations, activity, memory panel                   │
├──────────────────────────────────────────────────────────────────────┤
│ L5  API route     app/api/ai-chat/route.ts — thin: guard, delegate,  │
│                   stream. ~120 lines, no business logic.             │
├──────────────────────────────────────────────────────────────────────┤
│ L4  Orchestrator  lib/ai/orchestrator.ts — the agent loop:           │
│                   plan → gather (tools) → assemble → answer          │
├───────────────┬──────────────────┬───────────────────────────────────┤
│ L3 Retrieval  │ L3 Memory        │ L3 Prompt assembly                │
│ escalation    │ load, score,     │ budget, provenance tags,          │
│ ladder + tools│ consolidate      │ injection defense                 │
├───────────────┴──────────────────┴───────────────────────────────────┤
│ L2  Model gateway  lib/ai/gateway.ts — capability registry, health,  │
│     circuit breaker, quota accounting, structured output + repair    │
├──────────────────────────────────────────────────────────────────────┤
│ L1  Data  Supabase (Postgres FTS, pg_trgm) + curated TS corpus       │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.1 Why the loop is code-driven, not model-driven

The published pattern for tool-using agents assumes a model that emits reliable tool calls.
On free tiers it does not. So control inverts: **code owns the loop; the model makes narrow,
schema-validated decisions.** This keeps the agentic shape (plan → act → observe → answer)
while removing the failure mode where a weak model forgets to call a tool, calls the wrong
one, or loops.

Concretely: the planner emits *which tools to run and with what arguments* as a validated
`QueryPlan`. Code executes them in parallel. If the planner call fails, exceeds budget, or
returns invalid JSON twice, a **deterministic router** (`lib/chat/intent.ts` + `tokenize`)
produces the same plan shape from regexes. The request proceeds either way.

### 4.2 Call path (target)

```
POST /api/ai-chat
  → guard: same-origin → auth → persistent rate limit (user + IP) → size caps
  → load: conversation (own), last 12 messages, rolling summary, memory facts
  → plan: QueryPlan via cheap model (strict JSON schema)
            └─ on failure → deterministic plan from intent.ts + tokenize
  → gather: run tools in parallel, bounded (retrieval escalation ladder)
  → assemble: token-budgeted context, provenance-tagged
  → answer: stream from best available model, citations required
  → after(): persist messages; every N turns extract + consolidate memory
```

**Hot-path LLM calls: 2 maximum** (plan, answer). Memory work happens in `after()` and costs
the user nothing in latency.

---

## 5. Data model

Additive migrations only, newest convention (`supabase/migrations/<timestamp>_*.sql`).
Every table is RLS-enabled; private tables get no policies and are reachable only through
`service_role`, mirroring the existing `rate_limits` pattern.

### 5.1 `ai_conversations`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `user_id` | uuid → `auth.users` on delete cascade | |
| `title` | text | derived from first user turn, no extra LLM call |
| `summary` | text | rolling summary of turns older than the verbatim window |
| `summarized_through` | int | count of messages the summary covers |
| `message_count` | int | |
| `last_message_at` | timestamptz | index key |
| `archived_at` | timestamptz | soft delete |

Index: `(user_id, last_message_at desc)`.

### 5.2 `ai_messages`

`id`, `conversation_id` (cascade), `role` check in (`user`,`assistant`,`system`), `content`,
`metadata jsonb` (citations, tool steps, flags), `model`, `prompt_tokens`, `completion_tokens`,
`feedback` check in (`up`,`down`), `feedback_note`, `created_at`.

Generated `fts tsvector` over `content`, GIN-indexed — this is episodic search.

### 5.3 `ai_user_memories`

The long-term store. Slot-shaped with history, so facts evolve instead of duplicating.

| column | notes |
| --- | --- |
| `kind` | check in (`preference`,`progress`,`identity`,`interest`,`constraint`) |
| `key` | normalized slot, e.g. `favorite_character`, `watch_progress`, `dislikes` |
| `value` | human-readable fact |
| `confidence` | real 0–1, default 0.7 |
| `status` | check in (`active`,`superseded`,`expired`) |
| `superseded_by` | self-FK — preserves the old fact rather than deleting it |
| `source_message_id` | provenance back to the turn it came from |
| `evidence_count` | incremented when the same fact recurs |
| `last_confirmed_at` | drives decay |
| `expires_at` | nullable; set for `progress`-type facts |

Partial unique index on `(user_id, kind, key) where status = 'active'` — one live fact per
slot. A conflicting new fact supersedes the old row and inserts a new one.

### 5.4 `ai_documents` — the retrieval corpus

One table, stable string ids, so the corpus can be rebuilt idempotently.

| column | notes |
| --- | --- |
| `id` | `entry:<slug>`, `case:<page_title>`, `character:<id>`, `arc:<id>`, `guide:canon`, `gadget:<n>` |
| `source` | `content_entries` / `dcw_cases` / `characters` / `arcs` / `canon` / `movies` / `gadgets` |
| `title`, `body`, `url` | |
| `metadata jsonb` | `episode_number`, `movie_number`, `air_date`, `canon_type`, `arc_id`, `aliases[]` |
| `content_hash` | skip re-indexing unchanged rows |
| `updated_at` | |
| `fts tsvector` | generated from `title || ' ' || body`, GIN |

Plus `gin (title gin_trgm_ops)` for typo tolerance, and `create extension if not exists pg_trgm`.

**Corpus composition — this is the headline quality win.** Roughly 1,317 catalog entries and
~838 case records move from `ILIKE` scanning into an indexed corpus, and for the first time
the curated TypeScript data is indexed too:

| Source | Becomes |
| --- | --- |
| `content_entries` | one doc per entry; synopsis + numbering + air date + canon type |
| `dcw_cases` | one doc per case; victim/suspects/location/cause/description |
| `lib/characters-guide.ts` `CHARACTERS` | one doc per character: role, affiliation, bio, aliases |
| `lib/characters-guide.ts` `RELATIONSHIPS` | one doc per relationship: typed edge + detail |
| `lib/characters-debut.ts` | debut episode + spoiler metadata folded into the character doc |
| `lib/arcs-guide.ts` `STORY_ARCS` / `RECURRING_THREADS` | one doc per arc: range, highlights, cast, threads |
| `lib/canon-guide.ts` ranges | `guide:canon` doc + machine-readable ranges for the classification tool |
| `lib/movies-guide.ts` `MAINLINE_MOVIES` | mainline movie ordering and notes |
| Gadgets | extracted from the current system prompt into `gadget:*` docs |

An ingestion script (`scripts/ingest-ai-corpus.mjs`) builds these from the DB plus the
imported TS modules, hashes, and upserts. Idempotent; safe to re-run; usable from CI as a
build-time fixture generator for tests.

### 5.5 `ai_wiki_cache`

`cache_key` pk (normalized query + source), `source`, `title`, `extract`, `url`, `fetched_at`,
`expires_at`. Turns the live MediaWiki call from a blocking always-on dependency into a
time-boxed, cached fallback. Service-role only.

### 5.6 `ai_provider_state`

`target` pk (`groq:openai/gpt-oss-120b`), `consecutive_failures`, `open_until`,
`last_error`, `last_status`, `last_used_at`, `success_count`, `failure_count`.

Cross-instance circuit breaker. This is what makes defect 10 impossible: a 404/401 marks the
target disabled for a long window instead of being retried on every request.

### 5.7 `ai_request_log`

One row per chat request: `user_id`, `conversation_id`, `model_used`, latency breakdown
(`plan_ms`, `retrieve_ms`, `ttft_ms`, `total_ms`), `tool_calls jsonb`, `doc_ids text[]`,
`cache_hit`, `degraded` reason, token counts. RLS on, no policies.

This is the debugging surface the design depends on (§9) and the data source for any later
quality dashboard.

---

## 6. Retrieval design

### 6.1 Lexical only — and why that is sufficient here

The user chose no embeddings. For this corpus that is a defensible choice rather than a
compromise: Detective Conan questions are overwhelmingly **exact-match** questions —
episode numbers, movie numbers, character names, case details, arc names. Published guidance
is explicit that full-text search is the branch that carries exact identifiers, and vector
search is what smooths them over.

What we give up is paraphrase tolerance ("the one at the ski lodge"). Three cheap
compensations:

- **Alias expansion** — the existing `CHARACTER_ALIASES` map (`query.ts:128-147`) extended and
  driven from the indexed `aliases[]` metadata instead of a hardcoded table.
- **`pg_trgm` on titles** — typo tolerance ("haibarra" still finds Haibara).
- **Synonym/domain lexicon** — canon, filler, anime-original, arc names, "BO"/Black
  Organization, gadget names, and Tagalog query words.

### 6.2 The escalation ladder

Deterministic, cheapest-first. Stop as soon as the evidence threshold is met.

| Round | Branch | Cost |
| --- | --- | --- |
| R1 | Entity-precise: episode/movie numbers, exact character name, alias | 1 indexed query |
| R2 | FTS: `websearch_to_tsquery` over `ai_documents.fts`, `ts_rank_cd`, top 80 | 1 indexed query |
| R3 | Fuzzy: `pg_trgm` similarity on title + keyword-only fallback | 1 indexed query |
| R4 | Wiki: cache first, then a time-boxed live DCW/Wikipedia fetch | ≤ 1.2s budget |

**Evidence threshold: 6 documents.** R1 and R2 run in parallel. R3 runs only if R1+R2
produced fewer than 6. R4 runs only if the ladder is still below 6 **and** the plan marked
the question as needing lore the corpus cannot hold. The whole ladder carries a 1.5s
wall-clock budget; on expiry the answer proceeds with what was gathered and the request is
logged `degraded`.

### 6.3 Fusion and re-ranking

R2 and R3 produce two ranked lists with incomparable scores. They are fused with
**Reciprocal Rank Fusion** (`Σ 1/(k + rank)`, `k = 50`), which requires no score
normalisation and is the standard, well-tested choice.

The fused list then goes through **the existing scorer in `lib/chat/query.ts`** —
`scoreEntry`, `FIELD_WEIGHTS`, `BONUS_EXACT_NUMBER`, `BONUS_PHRASE_IN_TITLE`, `rankEntries`.
This is deliberate: it is the most valuable code in the current implementation, it is
already covered by `lib/__tests__/chat-query.test.ts`, and FTS candidate generation plus
their scorer is strictly better than either alone. `rankEntries` generalises from
`content_entries` rows to `ai_documents` rows by keeping a `fieldsOf(doc)` adapter — the
same pattern `search.ts:610-620` already uses to inject linked case text.

### 6.4 Tools

Tools are plain functions, not model-driven tool calls. Each takes validated arguments,
returns evidence with stable ids, and is independently testable.

| Tool | Returns | Deterministic? |
| --- | --- | --- |
| `searchCatalog(query, filters)` | episodes/movies/specials documents | no (FTS + scorer) |
| `searchCases(query)` | crime-record documents | no |
| `lookupCharacter(name)` | character doc + relationships + debut | yes |
| `classifyEpisode(n)` | canon / filler / anime-canon + arc membership | **yes** — from `canon-guide` ranges |
| `arcForRange(a, b)` | arc documents overlapping a range | **yes** — from `STORY_ARCS` |
| `nextUnwatched(limit)` | catalog entries the user has not watched | **yes** — from `watch_status` |
| `wikiLookup(topic)` | cached wiki extract | cached |

`classifyEpisode` is worth calling out: "is episode 500 filler?" is currently answered by
model guesswork. It becomes a table lookup, and the answer is then guaranteed correct.

---

## 7. Memory design

Three tiers, matching the established taxonomy.

| Tier | Store | Written | Read |
| --- | --- | --- | --- |
| **L1 working** | last N turns verbatim + `ai_conversations.summary` | inline | every turn |
| **L2 episodic** | `ai_messages` (full history, FTS-indexed) | inline (cheap) | on demand, search |
| **L3 semantic** | `ai_user_memories` | **async, in `after()`** | every turn, scored |

### 7.1 Why writes are asynchronous

Published practice is emphatic that semantic-memory writes must not sit inline with the
user-facing request: extraction is an LLM call, it is slow, and it makes p95 latency
unpredictable. Writes run in Next.js `after()`, batched — extraction fires when a
conversation reaches **every 4th assistant turn**, not on every message, and once more when
a conversation is explicitly closed or reset. A turn that produces no extractable candidate
costs nothing beyond the one call.

### 7.2 Extraction → consolidation

Two stages, both schema-validated with Zod and both strictly bounded.

**Extract.** One structured call over the recent window plus the conversation summary,
returning `MemoryCandidate[] = { kind, key, value, confidence }`. Guided to a controlled
`key` vocabulary so dedup actually works. Runs on Cerebras or Gemini, which the research
confirms do **constrained decoding** against a JSON schema — compliance is ~99.9% versus
8–15% failure for `json_object` mode, which matters because Groq only offers the latter.

**Consolidate.** For each candidate: look up the active row for `(user_id, kind, key)`.

| Situation | Operation |
| --- | --- |
| No row | ADD |
| Same value | UPDATE `evidence_count`, `last_confirmed_at`, raise confidence |
| Different value | SUPERSEDE old row, ADD new |
| Below confidence floor | NOOP — dropped |

Failure handling follows the researched playbook: read the terminating signal first
(`finish_reason`); truncation re-runs with a raised budget rather than "repairing" JSON;
**one** repair attempt with the validator error attached; then give up and return null
rather than throwing. Never loop.

### 7.3 Retrieval scoring with decay

Facts are ranked by relevance, confidence and recency — the standard shape, adapted to
lexical matching:

```
score = 0.55 · lexical_match(query, fact)
      + 0.25 · confidence
      + 0.20 · exp(−age_days / half_life)          half_life = 45 days
```

Bounded budget: the top ~12 facts, ~200 tokens. Hard cap of 50 active facts per user, with
consolidation beyond that — otherwise the memory table becomes an unbounded transcript with
extra steps.

### 7.4 Memory hygiene

- **Progress facts expire.** `watch_progress` carries `expires_at`; the tracker DB is
  authoritative and a stale remembered episode number would directly contradict it.
- **Nothing is silently trusted.** The tracker and corpus outrank memory; the prompt states
  this explicitly, so a wrong remembered fact cannot override retrieved ground truth.
- **Provenance is kept.** Every fact points at the message it came from.
- **User control.** "What do you remember about me?" answers from the table, and the UI can
  delete a fact. Non-negotiable for a feature that stores personal facts, and cheap.
- **Memory content is untrusted input.** Facts derive from user text; they are
  provenance-tagged and never treated as instructions (§8).

---

## 8. Prompt assembly and injection defense

### 8.1 Provenance tagging

Every context segment is tagged by its trust tier — the "spotlighting" family of defenses,
which the literature measures as reducing indirect-injection attack success from >50% to
<2% with negligible task impact.

```
[SYS]   instructions, operator-owned, highest privilege
[MEM]   remembered facts about this user
[RET]   retrieved corpus text  ← untrusted data, never instructions
[WIKI]  cached wiki text       ← untrusted data, never instructions
[USR]   the user's own words
```

The system prompt states the scheme and that no lower tier may override a higher one.
Retrieved text is delimiter-wrapped and screened by a lightweight scanner for
instruction-override and role-hijack patterns before admission. This closes defect 3, which
is a real vulnerability: the current prompt pastes raw, publicly editable wiki text into the
system prompt with no boundary at all.

The rule of thumb the design follows: the bot has private-ish data, exposure to untrusted
content, and the ability to render links — so untrusted content must never reach the
instruction plane.

### 8.2 Budgeted assembly

Approximate token accounting (`chars / 4`), with fixed ceilings and a deterministic
eviction order when over budget:

| Segment | Budget | Eviction |
| --- | --- | --- |
| System prompt (stable prefix) | ~900 | never evicted |
| Memory facts | ~200 | fewest facts first |
| Evidence documents | ~1,800 | lowest fused rank first |
| Rolling summary | ~300 | never evicted |
| Recent turns | ~800 | oldest first |

**Stable prefix matters for cost.** The system prompt and tool/format instructions form a
constant prefix so providers that support prompt caching can cache it.

### 8.3 The system prompt itself

Rebuilt around retrieval rather than hardcoding:

- Hardcoded gadget list (`prompt.ts:155-164`) → retrieved from `gadget:*` docs.
- Hardcoded watch-order advice `prompt.ts:166-175` → retrieved from movie/arc docs.
- Adds: citation contract (`[E1]`, `[E2]` referencing supplied evidence ids), memory
  precedence rules, provenance rules, and an explicit "if the evidence does not contain the
  answer, say so" instruction.
- Keeps: scope boundaries, language/tone rules (Tagalog/Taglish), spoiler policy, no-code
  rule. These are working product decisions and the existing tests for them stay green.

### 8.4 Citation contract

The model must cite evidence ids. Citations are parsed out of the stream, validated against
the ids actually supplied, and rendered as chips. An answer asserting facts with no valid
citation is flagged `degraded` in `ai_request_log` — which is how retrieval and grounding
quality become measurable instead of anecdotal.

---

## 9. Model gateway

`lib/ai/gateway.ts`. One module owns every provider interaction.

**Capability registry.** Per target: `supportsJsonSchema`, `jsonSchemaStrict`, `supportsTools`,
`emitsReasoningChannel`, `contextWindow`, `maxOutputTokens`, `dailyRequestBudget`, `tier`
(`plan` | `answer`). Capability, not a hardcoded guess — routing depends on it.

**Known-bad targets are removed.** `openrouter/free` (nondeterministic per its own
documented incident), `liquid/lfm-2.5-2.6b:free` and `poolside/laguna-s-2.1:free` (not
instruction-following generalists). The list is data, in one place, with a comment recording
why each removal happened.

**Failure classification** — this is the core of defect 8's fix:

| Signal | Action |
| --- | --- |
| `400` / `401` / `403` / `404` | Disable target for 24h — misconfiguration is not transient |
| `429` | Honour `Retry-After`; cool the target till then; count against daily quota |
| `5xx` / network | Exponential backoff with jitter, `consecutive_failures += 1` |
| Repeated failures | Circuit opens (`open_until`); skipped until it closes |
| Timeout | Per-attempt ceiling; treat as transient |

**Timeouts and budget.** Total request budget with `maxDuration` set explicitly. Per-attempt:
a **4s connect + first-token ceiling** (a free-tier provider that has not produced a token in
4s is not going to serve this request well), then a **30s streaming ceiling**, then a **60s
whole-request ceiling** covering both LLM calls and the retrieval ladder. A hung provider can
no longer stall the response.

**Quota accounting.** Daily request counters per target via the existing `rate_limit_hit`
RPC (key `ai:quota:<target>:<yyyymmdd>`), so free-tier daily caps are respected rather than
discovered by failure. When the budget is spent, the target is skipped.

**The two entry points.**

- `streamChat({ messages, targetPreferences })` — streaming answer, ordered fallback across
  healthy targets.
- `generateStructured({ schema, messages })` — Zod schema → JSON Schema → strict
  `response_format` where supported → validate → one repair turn → null. Used by the planner
  and memory extraction.

**Mid-stream failure.** Keeps the "emit nothing, fall through" behaviour, and adds the
missing half: if a provider dies *after* emitting, the partial answer is preserved, the
stream ends cleanly with a `finish_reason: "provider_error"` data part, and the UI offers
regenerate. A half-sentence reply is never silently presented as complete.

**Caching.** Normalized-question exact-match cache with a TTL for the public, non-personal
portion of answers, plus `ai_wiki_cache` for wiki content. Response caching is central to
surviving free-tier quotas and to time-to-first-token for repeated questions.

**Reasoning channels.** Where a provider sends a real reasoning channel, it is forwarded as
a distinct UI part and rendered collapsed. `ThinkingFilter`'s regex heuristics are retained
only for providers lacking that channel, behind the gateway — so the ~30-regex text-boundary
inference is no longer on the critical path for providers that label reasoning properly.

---

## 10. UI / UX remaster

Adopting **AI SDK 5** (`ai`, `@ai-sdk/react`) for the transport. Note the deliberate
split: the SDK owns the wire protocol and UI state; the gateway keeps its OpenAI-compatible
raw fetch. The gateway already works with these endpoints and a rewrite would add failure
modes for no behavioural gain — the route feeds the SDK through `createUIMessageStream`,
so typed parts, step parts and resumability all work without touching provider code.

**What changes**

| Area | Now | After |
| --- | --- | --- |
| Transport | `fetch` + `getReader`, plain text | `useChat` + `DefaultChatTransport`, typed parts, SSE |
| Message model | `{ id, role, content }` in sessionStorage | `UIMessage` parts, server-persisted |
| Reasoning | ~30 regexes inferring boundaries | Provider reasoning channel → collapsed part |
| Sources | Inline styled links | Citation chips from validated evidence ids, clickable to `/tracker/[slug]` |
| Activity | None | Real step parts: "Searching episodes…", "Checking wiki…" |
| Actions | Copy, Stop | Copy, Stop, **Regenerate**, **Edit & resend**, 👍/👎 |
| History | One ephemeral thread | Conversation drawer: list, rename, delete, new |
| Errors | Single `<p>` line | Classified states with a retry that preserves the message |
| Memory | Invisible | "What I remember" panel with per-fact delete |
| Streaming markdown | Hand-rolled "markdown-lite" | Streaming-safe renderer; code fences still suppressed by policy |
| Accessibility | `aria-modal="false"`, no focus trap | Focus trap, `aria-busy`, keyboard nav, `Cmd/Ctrl+Enter` |

**What stays.** The visual language is good and should be preserved: `bg-surface`,
`text-ink`, `border-line`, accent tokens, the floating launcher, the suggestion chips, the
auth lock card, Web Speech voice input, and the `useCharacterChromeHidden` mobile behaviour.
This is a capability remaster, not a redesign.

---

## 11. Observability and evaluation

**Structured logging.** One `ai_request_log` row per request: model used, latency
breakdown, tools called, docs retrieved, whether citations validated, degradation reason.
Retrieval failures become diagnosable ("did the lexical branch miss, did fusion bury it,
did the model ignore good context?") instead of mysterious.

**Golden eval set.** A fixture file (`lib/__tests__/fixtures/golden-qa.json`) of 50–100
questions with expected doc ids and expected-refusal flags, built *before* the retrieval
rewrite, per the standard advice that you cannot tell which change helped without one. Run
in CI, gated on recall@5 ≥ 0.85.

**Injection regression corpus.** Adversarial retrieved documents and override attempts
asserted against the assembly layer.

**Behavioural contract tests.** Recording real responses would be brittle against free-tier
model churn; tests assert the *contract* — citations valid, refusal correct, memory written,
ladder escalated — against a mocked gateway, so they stay deterministic and offline.

---

## 12. Phased plan

Each phase is independently shippable and independently verifiable.

**Phase 0 — Safety net and observability. No behaviour change.**
Rate limit (persistent, per user + IP), same-origin check, size caps, per-attempt timeouts,
budget, `maxDuration`. Fix the mislabeled logs and the dead constant. Add AI keys to
`.env.example` so the feature is developable locally. Add the route integration test
harness with a mocked gateway. Existing tests, typecheck, lint and build stay green.

**Phase 1 — Model gateway.**
Capability registry, failure classification, circuit breaker, quota accounting, backoff,
`generateStructured` with Zod + repair, reasoning-channel handling. Remove `openrouter/free`
and the non-instruction-following models. Remove `ThinkingFilter` from the critical path for
labelled-reasoning providers. Unit tests for every failure class.

**Phase 2 — Corpus and retrieval.**
Migrations for `ai_documents` + `ai_wiki_cache`. Ingestion script over the DB **and** the
curated TS modules. FTS + `pg_trgm` + RRF + the existing scorer generalised to
`ai_documents`. Escalation ladder. Tools including the deterministic `classifyEpisode`. Wiki
moves behind cache + time box. Golden eval set lands here and gates the phase.

**Phase 3 — Persistence and memory.**
Migrations for conversations, messages, memories, provider state, request log, with RLS.
Server-owned transcripts replace client `history`. Rolling summaries. Async extraction and
consolidation in `after()`. Decay-scored retrieval. Memory transparency and delete.

**Phase 4 — Agentic pipeline and prompt assembly.**
`QueryPlan` schema and planner, deterministic fallback router, parallel tool execution,
budgeted provenance-tagged assembly, injection screening, citation contract, rebuilt system
prompt with the hardcoded knowledge moved into the corpus.

**Phase 5 — Streaming and UI remaster.**
AI SDK transport, parts rendering, citations, activity, regenerate/stop/edit, feedback,
conversation drawer, memory panel, accessibility. Add a jsdom environment for component
tests.

**Phase 6 — Observability and docs.**
`ai_request_log` queries surfaced, eval harness wired into CI, `SYSTEM_DOCS.md` and
`.env.example` updated to match reality.

**Rollback.** `AI_PIPELINE=v1` restores the current pipeline behind the same route, so a
quality regression is an env-var change rather than a revert. The new schema is additive, so
v1 continues to work against it.

---

## 13. Risks

| Risk | Mitigation |
| --- | --- |
| Free-tier quota exhaustion | Daily accounting per target, circuit breaker, response cache, ≤2 LLM calls on the hot path, memory work deferred to `after()` |
| Weak model ignores the schema | Constrained decoding where available (Cerebras/Gemini), one repair attempt, then a null result that degrades to lexical-only answering |
| Quality regression from the rewrite | Golden eval set in CI, `AI_PIPELINE` rollback flag, phases shipped independently |
| Migration risk on a live project | Additive only; RLS on by default; no destructive change; service-role-only tables for internals |
| Latency from added stages | Retrieval budget, parallel tool execution, cache, streaming, `after()` for writes |
| Memory stores something wrong | Provenance, confidence, supersede-don't-overwrite, tracker and corpus outrank memory, user-visible delete |
| Two providers' JSON dialects diverge | Zod is the single source of truth: one schema generates the wire schema, validates the response, and drives repair |
| Scope creep into embeddings | Explicitly out of scope by decision; the schema keeps `metadata text[]` and doc ids stable so embeddings can be added later without a rewrite |

---

## 14. Out of scope

Deliberately excluded, to keep this shippable:

- Vector embeddings / pgvector (decided against).
- Any agent framework (LangGraph, Mastra, LangChain).
- Fine-tuning or self-hosting models.
- Multi-model ensembling, best-of-N, or a critic pass — quota cannot afford it.
- Auth or RLS changes outside the new tables.
- Realtime collaboration, voice beyond the existing Web Speech input.
- An admin analytics dashboard and a DB-backed eval-case table — the golden set lives in
  the repo, which is what CI actually needs.
- Unrelated refactoring anywhere outside the AI chat path.

---

## 15. Open questions

None blocking. Two decisions worth confirming during Phase 2:

1. **Corpus refresh cadence.** `ai_documents` is refreshed by a script. Should it run on the
   existing cron alongside the DCW sync, or stay a manual/CI step? Recommendation: cron,
   after `sync-crimes`, since case data already refreshes there.
2. **Conversation retention.** Transcripts accumulate. Recommendation: keep 12 months of
   `ai_messages`, with the rolling summary outliving them. Cheap to add in Phase 3.
