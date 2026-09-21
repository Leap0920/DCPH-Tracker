# DCPH-Tracker — System Documentation

> Complete technical reference for the Detective Conan PH community platform.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15.1 (App Router) |
| Language | TypeScript 5.7 |
| UI | React 19, Tailwind CSS 3.4 |
| Animation | Framer Motion 11 |
| Database | Supabase (PostgreSQL + PostgREST + RLS) |
| Auth | Supabase Auth (Brevo SMTP & OTP Verification) |
| Hosting | Vercel (auto-deploy from `main`) |
| AI Chatbot | Multi-Provider Failover (Google Gemini, Groq Cloud, OpenRouter) |
| Testing | Vitest |

---

## Frontend

### Core
- **Next.js 15** — App Router, Server Components, Server Actions, API Routes
- **React 19** — Client components marked with `"use client"`
- **TypeScript** — Strict mode, path aliases via `@/*`

### Styling
- **Tailwind CSS 3.4** — Utility-first CSS framework
- **tailwind-merge** — Deduplicates conflicting Tailwind classes (`cn()` utility)
- **tailwindcss-animate** — Animation utilities
- **class-variance-authority (CVA)** — Component variant management
- **clsx** — Conditional class joining

### UI Components
- **Radix UI** — Headless, accessible primitives:
  - `@radix-ui/react-dialog` — Modal dialogs
  - `@radix-ui/react-dropdown-menu` — Dropdown menus
  - `@radix-ui/react-select` — Select inputs
  - `@radix-ui/react-tabs` — Tab panels
  - `@radix-ui/react-tooltip` — Tooltips
  - `@radix-ui/react-avatar` — Avatar with fallback
  - `@radix-ui/react-separator` — Visual dividers
  - `@radix-ui/react-label` — Form labels
  - `@radix-ui/react-slot` — Polymorphic components

### Icons & Animation
- **Lucide React** — Icon library (500+ icons)
- **Framer Motion** — Page transitions, layout animations, scroll effects

### State Management
- **TanStack React Query** — Server state caching, optimistic updates, mutations

### Image Export
- **html-to-image** — Renders DOM nodes to PNG (used for the "Wrapped" shareable stat cards with `dcphtracker.vercel.app/{username}` footer)

---

## Backend / API

### API Routes (`app/api/`)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/sync` | POST | Content sync from Jikan/Kitsu/AniList (cron + admin) |
| `/api/chat` | POST/DELETE | Community chat message send/unsend (permanent retention) |
| `/api/ai-chat` | POST | AI chatbot with RAG + multi-provider failover chain (Auth required) |
| `/api/auth/otp` | POST | Custom OTP email delivery via Brevo SMTP |
| `/api/dcw/episode` | GET | DCW wiki episode details |
| `/api/proxy-image` | GET | CORS-safe avatar proxy for canvas export |
| `/api/analytics` | GET | User analytics data |
| `/api/tracker` | GET | Tracker content entries |

### Server-Side Code
- **Supabase Server Client** — `createClient()` from `@/utils/supabase/server` (async, cookie-based)
- **Supabase Client** — `createClient()` from `@/utils/supabase/client` (sync, browser-based)
- **Supabase Admin Client** — `createAdminClient()` from `@/utils/supabase/admin` (bypasses RLS with service role)
- **Rate Limiting** — In-memory per-IP + persistent DB-backed (`lib/rate-limit.ts`, `lib/rate-limit-db.ts`)
- **Profanity Filter** — `lib/profanity.ts` — redacts forbidden words from chat messages
- **Origin Check** — `lib/origin-check.ts` — same-origin verification for API routes

### Middleware
- **Auth middleware** — Refreshes Supabase session tokens
- **CSP nonce** — Content Security Policy with per-request nonces

---

## Database (Supabase)

### Project
- **URL**: `https://hgwtlbbbkxppbasbhvlo.supabase.co`
- **Tables**: 15+ tables with Row-Level Security (RLS)
- **Migrations**: SQL files in `supabase/` directory

### Core Tables

| Table | Purpose |
|-------|---------|
| `content_entries` | All episodes, movies, specials, OVAs (1200+ entries) |
| `watch_status` | User watch data per entry (watched/rewatched/unwatched, count, rating, favorite) |
| `profiles` | User profiles (username/handle, display_name, avatar_url, bio, role) |
| `arcs` | Story arcs with episode ranges |
| `dcw_cases` | Crime data from DCW wiki (victim, suspects, location, method) |
| `chat_messages` | Community chat messages (permanently retained) |
| `chat_rooms` | Chat room definitions |
| `badges` | Achievement badges |
| `user_badges` | Earned badges per user |
| `watch_events` | Immutable watch log (feeds leaderboards) |
| `episode_comments` | Episode discussion threads |
| `notifications` | User notifications |
| `sync_staging` | Admin approval queue for synced content |
| `screening_events` | Movie screening event listings |
| `ai_provider_state` | Cross-instance circuit-breaker state per gateway target |
| `ai_request_log` | One row per AI chat request (target, outcome, timings) |
| `ai_documents` | Retrieval corpus: one searchable row per catalog/curated document |
| `ai_wiki_cache` | Time-boxed cache of DCW / Wikipedia extracts |
| `ai_conversations` | One row per AI conversation (rolling summary, message count, last activity) |
| `ai_messages` | AI transcript turns, with a generated `fts` column for episodic search |
| `ai_user_memories` | Long-term facts about a user, one active row per slot |

> **Service-role only.** Every `ai_*` table — `ai_provider_state` and `ai_request_log` (Plan 1),
> `ai_documents` and `ai_wiki_cache` (Plan 2), and the three above — has RLS enabled with **no
> policies** and no grants to `anon` or `authenticated`, so only the service-role key can read
> or write one.

### SQL Views
- `all_episodes_with_crimes` — Joins `content_entries` with `dcw_cases`
- `public_profiles` — PII-safe profile subset (`user_id`, `username`, `display_name`, `avatar_url`, `bio`)

### Key SQL Migrations (`supabase/`)
- `migration-public-profiles-bio.sql` — includes `bio` in `public_profiles` view
- `migration-remove-chat-purge.sql` — removes automatic 12-hour chat purge
- `migration-chat-realtime.sql` — adds `chat_messages` to Supabase Realtime publication
- `migration-sync-staging.sql` — admin approval staging queue
- `migration-episode-comments.sql` — episode comment threads and policies
- `migration-leaderboard-rls.sql` — row-level security for leaderboard reads
- `migration-enforce-bans.sql` — enforces account bans at the database layer
- `migrations/20260919090000_ai_gateway_infra.sql` — `ai_provider_state` + `ai_request_log`
- `migrations/20260919100000_ai_corpus.sql` — `pg_trgm`, `ai_documents`, `ai_wiki_cache`, and the three retrieval RPCs
- `migrations/20260919110000_ai_memory.sql` — `ai_conversations`, `ai_messages`, `ai_user_memories`
- `migrations/20260919120000_ai_memory_supersede.sql` — the `ai_memory_supersede` function that replaces an active memory slot atomically
- `migrations/20260919130000_ai_request_log_pipeline.sql` — `plan_source`, `tools` and `citations_valid` on `ai_request_log`

> **Not applied remotely.** The five `20260919*` migrations are committed but have **not** been
> run against the linked Supabase project. Applying them is a deliberate manual step (`supabase db
> push`, or pasting the files into the SQL editor); no test executes the SQL, because CI has no
> Postgres. Until they are applied, `/api/admin/ingest-corpus` fails with a Postgres error and the
> indexed corpus is empty, so the agentic pipeline answers from its in-process static corpus
> instead (see "Agentic pipeline"); `/api/ai-chat` has no transcript or memory to read and falls
> back to the client's `history`, and the memory and conversation endpoints return the Postgres
> error; and the request log's insert fails on the three new pipeline columns, a fire-and-forget
> write that costs no answer.

---

## External APIs

### 1. Detective Conan World (DCW) Wiki
- **URL**: `https://www.detectiveconanworld.com/wiki/api.php`
- **Type**: MediaWiki 1.45 API (public, no key required)
- **Client**: `lib/dcw.ts` — `dcwQuery()` with throttling (200ms min interval), retries, backoff
- **Usage**:
  - Episode details (cast, gadgets, plot) — `lib/dcw-episode.ts`
  - Crime case data (victim, method, suspects) — `lib/dcw-cases.ts`
  - Title matching (tracker ↔ wiki) — `lib/dcw-match.ts`
  - Image fetching — `lib/dcw-image-for-title.ts`
  - Chatbot search — `lib/chat/search.ts`

Per-target budgets, models and timeouts live in `lib/ai/targets.ts` (budgets),
`lib/ai/circuit.ts` (cooldowns) and `lib/ai/gateway.ts` (timeouts); this section is a summary.

### 2. Google AI Studio (Gemini API)
- **URL**: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
- **Type**: OpenAI-compatible Google Gemini API
- **Models**: `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.6-flash`, `gemini-3-flash` (1400 req/day each)
- **Role**: Primary intelligence tier in AI chatbot fallback chain

### 3. Groq Cloud API
- **URL**: `https://api.groq.com/openai/v1/chat/completions`
- **Type**: OpenAI-compatible ultra-fast LPU inference
- **Models**: `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`, `qwen/qwen3.6-27b`, `openai/gpt-oss-20b`, `groq/compound` (14,000 req/day each)
- **Role**: Secondary high-volume tier

### 4. OpenRouter API
- **URL**: `https://openrouter.ai/api/v1/chat/completions`
- **Type**: Multi-model aggregator
- **Models**: `minimax/minimax-m3:free`, `minimax/minimax-m2.7:free`, `google/gemma-4-31b-it:free`, `z-ai/glm-5.2:free`, `nvidia/nemotron-3.5-lightning:free`, `inclusionai/ling-3.0-flash-fin:free` (50 req/day per key)
- **Role**: Tertiary backup tier with primary + secondary key failover

### 5. Cerebras API
- **URL**: `https://api.cerebras.ai/v1/chat/completions`
- **Type**: OpenAI-compatible inference (constrained-decoding JSON schema support)
- **Models**: `gpt-oss-120b`, `gemma-4-31b` (900 req/day each)
- **Role**: Final fallback tier

### 6. Jikan API (MyAnimeList)
- **URL**: `https://api.jikan.moe/v4`
- **Type**: Free MAL API wrapper
- **Usage**: Fetches episode lists, anime details for content sync

### 7. Kitsu API
- **URL**: `https://kitsu.io/api/edge`
- **Type**: Free anime database API
- **Usage**: Franchise entry data (movies, specials, OVAs) for content sync

### 8. AniList API
- **URL**: `https://graphql.anilist.co`
- **Type**: GraphQL API
- **Usage**: Airing schedule data for content sync

---

## AI Chatbot (DCPH Bot)

### Architecture
```
User question (Signed-in member)
  → ChatWidget (floating launcher → slide-up panel)
    → POST /api/ai-chat (Auth verified)
      → DCW Wiki search (MediaWiki API, multiple query variations)
      → Wikipedia search (fallback when DCW has few results)
      → Tracker DB search (content_entries + dcw_cases)
      → User watch history & profile (if signed in)
      → Build system prompt (Tagalog/English natural tone + structured episode cards)
      → Model gateway (lib/ai/gateway.ts) — targets tried in that order:
          Google Gemini (AI Studio) → Groq Cloud → OpenRouter (:free) → Cerebras
          Circuit state and daily budget are checked per target before a request
          is spent. Failures are classified (misconfigured / rate_limited /
          server_error / timeout / network / empty_output) and a misconfigured
          target is cooled down for 24h rather than retried on every request.
          Failover stops once text has started streaming, so a partial answer is
          kept and labelled instead of being stitched to another model's reply.
      → Stream plain text response back
    → ChatWidget renders streaming markdown
```

The retrieval line above is v1's path, which `AI_PIPELINE=v1` restores; by default (unset) the
same route retrieves through the agentic pipeline — see "Agentic pipeline" below.

### Key Chatbot Features
1. **Member-Only Access Gating**: Unauthenticated visitors see a friendly lock card with a one-click "Sign In to Chat" button triggering Supabase Auth modal. Server returns 401 Unauthorized for anonymous calls.
2. **Interactive Suggestion Chips**: Quick-action prompt chips (`What should I watch next?`, `Manga Canon Guide`, `Agasa's Gadgets`, `Movies vs Episodes`) powered by Lucide icons.
3. **Session Persistence**: Active conversations are stored in `sessionStorage` (`dcph_chat_history_v1`) so chats survive page transitions across `/tracker`, `/cases`, `/profile`, etc.
4. **Voice Input (Speech-to-Text)**: Native browser Web Speech API microphone button with audio recording animation.
5. **One-Click Message Copying**: Copy button with checkmark feedback under bot messages.
6. **Rich Interactive Tracker Links**: Episode/case links are styled as interactive badges linking to `https://dcphtracker.vercel.app/tracker/...`.
7. **Reasoning Kept Out of the Answer**: a provider's reasoning channel (`reasoning_content` / `reasoning`, sent by Groq and OpenRouter) is parsed separately from the answer text by `lib/ai/sse.ts` and is never stitched into the streamed reply. Reasoning delivered inline in `content` is no longer filtered on the streaming path — `lib/chat/answer.ts` retains those helpers for that case, but `/api/ai-chat` no longer wires the streaming `ThinkingFilter` in.
8. **Request Log**: every chat request writes one `ai_request_log` row with the target used, the outcome, the per-target attempt list, and retrieval / time-to-first-token / total timings, so provider health and latency are measurable.

### AI Retrieval Corpus

The corpus is `ai_documents` — one row per retrievable document, ids namespaced by source
(`entry:<slug>`, `character:<id>`, `relationship:<id>`, `arc:<slug>`, `thread:<slug>`,
`guide:canon`, `movie:<n>`, `gadget:<n>`, `case:<page_title>#<index>`) — with a generated `fts`
column (title weight A, body weight B), a trigram index on `title`, a GIN index on `aliases`,
and `episode_number` / `movie_number` as first-class columns. `ai_wiki_cache` holds time-boxed
DCW / Wikipedia extracts (7-day TTL, 1.2 s time box per fetch) so a wiki lookup cannot stall a
chat request. Both tables are service-role only: RLS on, no policies.

Three RPCs, one per retrieval branch:

| RPC | Branch | What it matches |
|-----|--------|-----------------|
| `ai_docs_entity` | R1, entity-precise | episode/movie number (rank 3.0), exact title (2.0), alias overlap (1.5), title substring (1.0) |
| `ai_docs_fts` | R2, full text | `websearch_to_tsquery('english', query)` over `title \|\| body` — token AND, and a malformed query yields an empty tsquery that matches nothing instead of raising |
| `ai_docs_fuzzy` | R3, typo tolerance | `similarity()` on `title` against the query and each keyword ≥ 3 characters, `pg_trgm` threshold 0.3 |

`lib/ai/retrieval/ladder.ts` runs them cheapest-first: R1 and R2 together, R3 only while fewer
than **6** distinct candidates are fused, R4 (wiki) only when the question needs lore and the
budget allows. The ladder has a **1.5 s** wall-clock budget; a round skipped for time is
recorded in `steps` and sets `degraded: "retrieval_budget"` on the result, so a thin answer is
labelled rather than silently degraded. Candidate lists are fused with reciprocal rank fusion
(`lib/ai/retrieval/rrf.ts`) and re-ranked by the tracker scorer
(`lib/ai/retrieval/candidates.ts`); a branch that rejects degrades to an empty result, never to
a failed request.

**Ingestion**: `POST /api/admin/ingest-corpus` rebuilds the corpus from `content_entries`,
`dcw_cases` and the curated guides, hashing each document and upserting only what changed.
Auth is the `x-admin-secret` header matching `ADMIN_TASK_SECRET || CRON_SECRET`; `?dryRun=1`
computes the report without writing, and the route caps at `maxDuration = 300`. With the dev
server running:

```bash
curl -X POST "http://localhost:3000/api/admin/ingest-corpus?dryRun=1" \
  -H "x-admin-secret: $ADMIN_TASK_SECRET"
```

**Golden eval**: `lib/__tests__/retrieval-eval.test.ts` runs 60 hand-authored questions
(`lib/__tests__/fixtures/golden-qa.json`) through the real ladder over an in-process index of
the seed catalog and the curated guides, and gates at **recall@5 ≥ 0.85**. That number is an
offline approximation (plan deviation D5): `createStaticSource` implements the same three
branches as the RPCs but not Postgres's exact ranking or stemming, and `dcw_cases` has no
offline source, so case retrieval is not covered. It measures the pipeline — ladder, fusion,
scorer — not the SQL.

**Manual verification**, after applying `20260919100000_ai_corpus.sql`:

```sql
-- The migration's first statement needs this schema to exist; Supabase creates it,
-- but check before running the file if the project was ever rebuilt by hand.
select 1 from pg_namespace where nspname = 'extensions';

select count(*) from public.ai_documents;
select id, rank from public.ai_docs_entity(array[500], array['haibara'], 5);
select id, rank from public.ai_docs_fts('ski lodge murder', 5);
select id, rank from public.ai_docs_fuzzy('haibarra', array['haibarra'], 5);
```

### AI Memory and Transcripts

The bot's memory has three tiers, written at different times by different parts of the pipeline.
Nothing that writes memory runs on the response's critical path: the L1 window and the memory
read are bounded pre-stream reads (400 ms each; a timed-out window falls back to the client's
`history`, and a failed memory read injects nothing), and everything that writes — the assistant
turn, extraction, consolidation, the rolling summary — runs in `after()`, once the answer has
been sent.

| Tier | What it is | Where it lives |
|------|-----------|----------------|
| L1 working | the last **8** messages verbatim plus the rolling summary of the turns before them | `ai_conversations.summary` + the newest `ai_messages` rows |
| L2 episodic | every message, FTS-indexed and searchable per user | `ai_messages` (generated `fts`, GIN index) |
| L3 semantic | durable facts about the user, one row per active slot | `ai_user_memories` |

The episodic search itself (`searchMessages`) is a tested port method from Phase 3; the routed
tool that consumes it ships in Phase 4 (deviation D5).

**The three tables.** `ai_conversations` is one row per thread: `title` (the first user turn,
capped at 80 characters), the rolling `summary`, `summarized_through` (the index the summary
covers up to), `message_count`, `last_message_at` and `archived_at`. `ai_messages` is the
transcript: `role` (`user` / `assistant` / `system`), `content`, `metadata`, optional model and
token columns, `feedback` (`up` / `down`) and a generated `fts` column —
`to_tsvector('english', content)`, GIN-indexed — which is what episodic search matches against.
`ai_user_memories` is the semantic tier: `kind`, `key`, `value`, `confidence`, `status`
(`active` / `superseded` / `expired`), `superseded_by`, `source_message_id`, `evidence_count`,
`last_confirmed_at` and `expires_at`.

All three are RLS-enabled with **no policies** and no grants to `anon` or `authenticated`, so
only the service-role key reaches them. `ai_messages` deliberately has no `user_id`: ownership is
enforced by an ownership check on the conversation, carried in the same query that reads or
writes a message (deviation D1). That is why every store method that touches a message takes a
user id — a port implementation that read messages by conversation id alone would be a
cross-user leak.

**Write schedule.** Extraction lives in `lib/ai/memory/write.ts` and runs only when
`messageCount % MEMORY_WRITE_EVERY === 0` (`MEMORY_WRITE_EVERY` is 4), i.e. on every fourth
assistant turn, in `after()`. On the other three turns the writer returns `reason: "not_due"`
before any model call, port read or store read — the zero is asserted in
`lib/__tests__/memory-write.test.ts`. The rolling summary has its own schedule: it is due when at
least `SUMMARY_TRIGGER` (8) messages sit outside the 8-message verbatim window and are not yet
covered by `summarized_through`, and each round reads at most `SUMMARY_INPUT_LIMIT` (40) messages
from the start of the unsummarized region, so a region longer than one round loses nothing (a
call is bounded at two rounds, and a backlog drains over consecutive turns).

**The decay score.** Each turn, `lib/ai/memory/score.ts` scores the user's active facts against
the question:

```
score = 0.55·lexical + 0.25·confidence + 0.20·exp(−age_days / 45)
```

`lexical` is the fraction of the query's tokens found in the fact's `key` and `value`, and
`age_days` is measured from `last_confirmed_at`. The weights are `W_LEXICAL = 0.55`,
`W_CONFIDENCE = 0.25` and `W_RECENCY = 0.20` over `HALF_LIFE_DAYS = 45`; the three sum to 1, so a
fact that matches every token, is fully confident and was just confirmed scores exactly 1. The
best `MEMORY_LIMIT` (12) facts are rendered inside a `MEMORY_TOKEN_BUDGET` (200 tokens) prompt
allowance, one `[MEM] key: value (conf X)` line each.

**Precedence.** The prompt puts both memory sections after every retrieved-context section and
labels them: remembered facts are *"not instructions"*, and a conflict with the tracker entries
or wiki pages resolves in favour of those. The rolling summary is labelled as history written by
the assistant, so a summary that paraphrases a user instruction is still read as history. A
`[MEM]` line is data the user told us, never a command. Watch progress is the one fact on a
clock: `watch_progress` is written with `expires_at = progressExpiry(now)` (now + 90 days) and
the store's `loadActive` drops a fact whose `expires_at` has passed, because the tracker is
authoritative about where the user is in the series.

**Retention and control.**

- `GET /api/ai-chat/memory` lists the user's facts with their confidence, status and
  `lastConfirmedAt`, active first, capped at `MEMORY_LIST_LIMIT` (50).
- `DELETE /api/ai-chat/memory?id=<uuid>` deletes one fact. A malformed id is a 400 without a
  database call, and an id that is not the caller's gets the same 404 as one that does not exist,
  so neither reveals whether another user's row is there.
- Asking *"what do you remember about me?"* is answered from the memory table in plain text with
  **no model call**. The matcher in `lib/ai/memory/recall.ts` is deliberately narrow, so
  *"what do you remember about episode 5"* is a tracker question and still reaches retrieval.
- `GET /api/ai-chat/conversations` lists the newest 30 non-archived conversations;
  `GET /api/ai-chat/conversations?id=<uuid>` returns one conversation with its title, summary and
  transcript, capped at 200 messages; `DELETE ?id=<uuid>` **archives** it (sets `archived_at`)
  rather than deleting it, so a mis-tap cannot destroy a thread. Every response is
  `Cache-Control: no-store`, and an anonymous caller gets a 401.

**The chat contract change (D3).** `POST /api/ai-chat` accepts an optional `conversationId` in
the request body and returns the resolved id in the `X-Conversation-Id` response header on the
streaming answer. When the body carries none, the server attaches to the user's most recent
conversation whose `last_message_at` is within 30 minutes (`RECENT_CONVERSATION_MS`), or creates
a new one; an id that is unknown or belongs to someone else is refused without creating
anything. The legacy `{ message, history }` body still works exactly as before — the client is
expected to start sending the id in Phase 5, and until then the server-owned transcript and the
client's `history` coexist.

**The kill switch (D6).** `AI_MEMORY=off` stops memory extraction and injection: the memory read
and the recall answer return empty before touching the database, the async writer never runs, and
the prompt gets no `[MEM]` section. Transcripts still record, and the memory endpoints still
work — `GET` still lists and `DELETE` still deletes, because a user must be able to see and
remove what was stored before the switch was flipped. Any value other than `off`, including
unset, means on. It is independent of the spec's `AI_PIPELINE=v1` rollback (spec §12), which
restores the pre-Phase-3 pipeline behind the same route.

**Migration status.** `20260919110000_ai_memory.sql` (the three tables) and
`20260919120000_ai_memory_supersede.sql` (the `ai_memory_supersede` function) are committed but
**not applied** to the remote project — applying them is a deliberate human step, and neither a
test nor a plan step runs `supabase db push`. No test executed this SQL: the tests read the
migration files and assert their structure (table and column names, the partial index predicate,
the absent destructive statements), not their effect.

Manual verification, after applying both migrations:

```sql
select to_regclass('public.ai_conversations'),
       to_regclass('public.ai_messages'),
       to_regclass('public.ai_user_memories');

select proname from pg_proc where proname = 'ai_memory_supersede';

-- The partial predicate: `... WHERE (status = 'active')`.
select indexdef from pg_indexes
 where tablename = 'ai_user_memories'
   and indexname = 'ai_user_memories_active_slot_idx';

-- Two rows, one slot. Replace <user-uuid> with a real auth.users id.
insert into public.ai_user_memories (user_id, kind, key, value, confidence)
values ('<user-uuid>', 'preference', 'favorite_character', 'Haibara', 0.9)
returning id;

select public.ai_memory_supersede(
  '<user-uuid>', '<id-from-above>', 'preference', 'favorite_character', 'Ran', 0.9, null, null
);

select value, status, superseded_by
  from public.ai_user_memories
 where user_id = '<user-uuid>' and kind = 'preference' and key = 'favorite_character'
 order by created_at;
```

The last query shows the round trip: one `active` row (`Ran`) and one `superseded` row
(`Haibara`) whose `superseded_by` points at it.

**Cost.** Memory adds at most one free-tier model call per four assistant turns, and it is issued
in `after()`, after the response has been sent: the writer returns before any provider, port or
store call unless the turn is due. A summary is a second, independent call, spent only when
enough unsummarized turns have left the verbatim window to reach `SUMMARY_TRIGGER`, and a due
turn whose L1 window is empty makes no call at all. A due extraction spends its one call even
when the model reports no candidates — the call is the cost, and the empty answer is what makes
consolidation a no-op with no database write.

### Agentic pipeline

By default `/api/ai-chat` answers through the agentic pipeline: retrieve, screen, assemble,
answer, validate. It is Phase 4's path, and it runs behind the same route — the guards, auth,
rate limit and intent refusal, Plan 3's transcript and memory reads, the gateway and the stream
are unchanged. Code owns the loop; the model may make one narrow, schema-validated decision
(which tools to run) and then writes the answer. `AI_PIPELINE=v1` restores the previous path entirely,
so nothing in this section runs then.

**The call path.**

```text
POST /api/ai-chat  guards → auth → rate limit → intent refusal
  → persistence: window and memory reads, recall branch     lib/chat/persistence.ts
  → runPipeline                                             lib/ai/pipeline/index.ts
      → resolveRetrievalDeps   indexed corpus, else cached static (D2)
      → planQuery              router first, planner when unsure (D1)
      → executePlan            ladder + tools in one round trip, merged by id
      → screenEvidence         injection screening: exclude or redact (D4)
      → assembleMessages       budgets, provenance tags, [E1] numbering
  → streamChat                 the unchanged gateway path   lib/ai/gateway.ts
  → validateCitations          on the accumulated answer, after the stream (D3)
  → logRequest                 fire-and-forget, never awaited
  → after()                    Plan 3's memory and transcript work, unchanged
```

The stages are `lib/ai/pipeline/`'s `index.ts` (the composition), `source-resolver.ts`,
`planner.ts`, `router.ts`, `plan.ts` (the schema), `execute.ts` and `assemble.ts`, with screening
in `lib/ai/prompt/screen.ts`, the citation contract in `lib/ai/citations.ts`, and the eighth tool
in `lib/ai/tools/search-conversations.ts`. Every stage carries a hard bound — the planner
1,200 ms, the corpus probe 400 ms, execution 2,000 ms — and a stage that overruns degrades
instead of extending the request; the route's `TOTAL_BUDGET_MS` (45 s) is one clock shared by the
planner and the answer stream, so a client that disconnects while the planner is thinking aborts
it. Three v2-specific route behaviours are deliberate: the retrieval context handed to
`buildSystemPrompt` is empty while the watch history stays a real, bounded read (`searchAll` used
to fetch it for free), the memory block and the rolling summary are **not** passed to the prompt
builder because the assembler owns both sections, and the refusal gate keeps
`shouldRefuseForMissingContext` and its signature, with `hasContext` on v2 meaning "the assembly
holds at least one document or wiki extract" (D8). The pipeline never throws: a total failure
returns a result with `degraded: "pipeline_failed"` and an empty evidence set, which the refusal
gate answers honestly.

**The `QueryPlan` contract.** One object per request (`lib/ai/pipeline/plan.ts`), validated by a
Zod schema before any stage reads it. The plan may decide which of the eight tools to run
(`search_catalog`, `search_cases`, `lookup_character`, `classify_episode`, `arc_for_range`,
`next_unwatched`, `wiki_lookup`, `search_conversations`), each step's arguments, the retrieval
keywords and numbers the ladder searches with, whether the question needs the wiki round
(`needsLore`), and its chronological preference. It may not decide the prompt, the budgets, or
the evidence the tools return: a tool call is the only way to reach a fact, and every fact is
screened, budgeted and tagged by code. The caps are `MAX_PLAN_STEPS` (4), `MAX_PLAN_KEYWORDS`
(8) and `MAX_PLAN_NUMBERS` (8); a step that violates the schema rejects the whole plan rather
than being half-applied, and identical steps collapse so no tool call is spent twice. The
deterministic router (`lib/ai/pipeline/router.ts`) answers first and the planner is the
escalation (D1): the router recognizes the curated names the corpus is built from, reads episode
and range references, decides whether a question is lore-shaped, and marks itself confident only
on an unambiguous entity or number hit, a list, a refusal or a greeting — never on a comparison
or a lore question. Which path won is recorded per request as `plan_source` (`router`, `model`
or `fallback`).

**`AI_PLANNER`.** Three modes, read by `plannerMode` (`lib/ai/pipeline/planner.ts`): `auto` (the
default), `always` and `off`; any other value, unset included, is `auto`. `auto` calls the model
only when the router is not confident, `always` restores the spec's literal two-call hot path,
and `off` never spends the call. The call is `generateStructured` over the plan schema on a
schema-capable gateway target, bounded at `PLANNER_BUDGET_MS` (1,200 ms) and inside the shared
request clock; D1's rationale is the quota — on a free tier a model call is a budget, so a
confident router spends nothing, and only a genuinely ambiguous question pays. Every failure — a
timeout, a provider rejection, a schema-invalid reply, an empty step list, or a floor-only plan
with no keywords — returns the router's plan with `source: "fallback"` and a short error code
(`planner_timeout`, `planner_failed`, `planner_invalid`, `planner_no_steps`,
`planner_empty_search`). The planner never rejects and never returns null, and with no
schema-capable target injected it stays on the router's plan and spends nothing.

**`AI_PIPELINE`.** Unset, empty or any value other than exactly `v1` runs v2 (surrounding
whitespace is tolerated, case is not). `v1` restores the previous path behind the same route —
`searchAll` plus the Plan 3 prompt, byte-for-byte in behaviour — and it therefore gets none of
v2's properties: no plan is made and `plan_source` stays null, nothing is screened so
`degraded_reason` can never be `"screened"`, citations are not validated and `citations_valid`
stays null, and the memory block and rolling summary go back into `buildSystemPrompt` instead of
being owned by the assembler. It remains the rollback (constraint 11), and
`app/api/ai-chat/route.integration.test.ts` — which sets the variable in its `beforeEach` — is
the standing v1 regression test.

**Source resolution.** `resolveRetrievalDeps` (`lib/ai/pipeline/source-resolver.ts`) decides
which corpus the request reads. `indexed` reads `ai_documents` through Plan 2's three RPCs;
`static` reads the corpus built in this process from the curated guides plus the live tracker
rows — the same documents the ingestion route would write. Reachability is asked directly, never
inferred from a row count: one `ai_documents` select of one column and one row under a
`CORPUS_PROBE_MS` (400 ms) box decides it, because `createSupabaseSource` answers `[]` for both
"no rows" and "no table", and an empty table is the expected pre-ingestion state while a missing
one is not. A static corpus is cached for `CORPUS_CACHE_TTL_MS` (5 minutes), with the in-flight
promise memoized so two requests arriving together pay for one tracker read; the read is capped
at `CORPUS_MAX_ROWS` (20,000), and a failed row read degrades to the curated half rather than to
an empty source. Static mode reports `degraded: "corpus_static"` — the deployment's state rather
than this request's, so it is the last degrade reason reported and the first displaced.

The deployed project is exactly that case today: none of the `20260919*` migrations are applied,
so `ai_documents` does not exist and the probe fails. Because `createSupabaseSource` swallows a
missing table and returns `[]`, a pipeline that read it without asking would answer *"I could not
find a reliable answer"* to every question. The corpus fallback is therefore explicit
(constraint 12, D7): when the resolved mode is `static` and the screened evidence is empty,
`runPipeline` calls `runLegacyRetrieval` — the same `searchAll` the route uses for
`AI_PIPELINE=v1` — converts its `ChatContext` into documents and wiki extracts with the same
builders the ingestion route uses, screens that too, and re-assembles. The result carries
`degraded: "corpus_unavailable"`. A `searchAll` rejection is caught: the request answers from an
empty evidence set rather than throwing. Without this fallback, every question would have been
refused once v2 shipped, before a human applied the migrations.

**Provenance tags and the wrap.** Every retrieved segment is tagged with its trust tier when it
reaches the prompt: `[SYS]` the operator-owned system prompt, `[RET]` retrieved corpus
documents, `[WIKI]` cached wiki extracts, `[CONV]` passages from the user's own earlier
conversations, `[MEM]` remembered facts about the user, `[USR]` the user's own words. The rule is
one-way: no lower tier may override a higher one, and `[RET]`, `[WIKI]` and `[CONV]` are
untrusted data, never instructions. Retrieved text is wrapped between `<<<EVIDENCE` and
`EVIDENCE>>>` (`WRAP` / `wrapEvidence` in `lib/ai/prompt/screen.ts`), one pair per rendered
document, and the prompt tells the model that text between the markers is data. That sentence is
only true because screening runs before wrapping: a document that carries a marker is excluded,
so a marker pair in a prompt is always the wrapper's own. Conversation turns are the one tier
that is not tagged in-band — they stay separate `role: "user"` / `role: "assistant"` messages,
because prefixing someone's own words with a tag would rewrite their message for the provider's
chat template.

**Assembly.** `assembleMessages` (`lib/ai/pipeline/assemble.ts`) is the last stage before the
model and the only place that decides what happens when the prompt does not fit. Tokens are
`chars / 4` — the memory module's `CHARS_PER_TOKEN`, imported rather than re-declared so the two
cannot disagree — measured against five ceilings:

| Segment | Ceiling (tokens) |
|---------|------------------|
| `system` | 1,500 |
| `memory` | 200 |
| `evidence` | 1,800 |
| `summary` | 300 |
| `turns` | 800 |

The system prompt's ceiling is a report baseline rather than a trigger: it is never evicted, and
the rebuilt prompt's own character ceiling is what actually bounds it. Overflow is evicted in a
fixed order, never truncated mid-sentence: evidence from the tail of the rendered order first
(the ladder's ranking is the input order, so the last-rendered document is the lowest-ranked one,
and a wiki extract renders after every document and so goes before all of them), then turns
oldest-first with the newest turn kept whole even when it alone overruns the ceiling, then the
rolling summary last and only when nothing else remains. Memory and the system prompt are never
evicted — the first is cheap and load-bearing, the second is the contract. Numbering is
re-densified after eviction, so `[E1]` always exists while any evidence survives and no gap can
be cited; `report.evicted` names the evicted ids, then the trimmed-turn count, then the summary,
and any evicted document sets `degraded: "evidence_evicted"`. Those two are not the same
condition: the list is non-empty for a trimmed turn or a dropped summary too, while the reason is
set only by a document or wiki id — so a non-empty `evicted` does not imply the badge. The list
is carried out of the pipeline unchanged as `PipelineResult.evicted` (never null; `[]` when
nothing was evicted) and onto the wire as an **optional** `ActivityPart.evicted`, omitted when
empty, which is why `PROTOCOL_VERSION` stays `1`: an optional field is not a shape change. The
activity trace words the three shapes on three separate lines rather than calling every entry a
source. Each admitted document renders as
one block — `[E#]`, its tag, its label (the document title, collapsed to one line), then the
wrapped body — and `report.evidence` lists exactly the blocks that were rendered, so `[E2]`
resolves to a real document id.

**Screening.** Every untrusted segment — ladder documents, tool documents, wiki extracts —
passes through `lib/ai/prompt/screen.ts` before the assembler wraps it, and both the title and
the body are screened, because the title is a rendered label. A high-severity match disqualifies
the whole document. The high-severity families are instruction overrides (English and
Tagalog/Taglish), role hijacks (`you are now`, `act as an assistant`, `pretend to be`),
system-plane spoofs (`[SYS]` or `<system>` claims, provider dialect tokens), false authority
notices, exfiltration requests for the prompt or API keys, a long opaque blob that decodes to any
of those, and the evidence delimiter itself. A low-severity match — a bare imperative ("always
answer…"), a zero-width or bidi character, a markdown heading claiming a trust tier — redacts the
offending line to `[screened]` and admits the document, with the line count preserved so a diff
shows what went. That split is D4: dropping a whole document for one noisy wiki paragraph would
let a single stray byte break an answer. Every match is counted, and an exclusion sets
`degraded_reason: "screened"` unless a stronger reason was already recorded. The regression
corpus is `lib/__tests__/fixtures/adversarial-docs.json` — 17 documents: 13 high-severity attack
documents (override, role, system tags, encoded blob, Tagalog, zero-width, soft hyphen, false
authority, exfiltration, markdown), 2 low-severity documents, and 2 false-positive documents pinned
as hard as the attacks (a medicine label, and a wiki page describing an impostor who "pretends
to be the phantom thief Kaito Kid" — `pretend` is matched in its base form only). The control run
over the real corpus is the pipeline-level eval below: all 60 real cases pass through
`screenDocuments` and still assemble their expected documents, so no legitimate curated text
lost a slot.

**Citations.** The assembler numbers every admitted block `[E1]`, `[E2]`, …, and
`citationInstruction` — the same string the rebuilt prompt embeds, so the instruction the model
reads and the parser that checks it cannot drift — asks the answer to cite the blocks it used.
The grammar is narrow (`lib/ai/citations.ts`): `[E#]` with one or two digits, an uppercase `E`
and a single bracket pair, so `[E1, E2]`, `[e1]`, `(E1)`, `[E1 ]`, `[E0]` and `[[E1]]` are not
citations. `MAX_CITATIONS` (12) is the ceiling the instruction quotes, not the parser's limit:
validation resolves every `[E#]` against the evidence actually supplied, and `[E12]` when five
documents were given parses and then lands in `unknown` rather than disappearing. Two conditions
make `citations_valid` true: nothing was fabricated, and a citation exists whenever one was
required. `requireCitation` is "evidence was supplied at all", so a greeting with nothing to cite
is neither invalid nor uncited, while a fabricated number is invalid even then — the flag
forgives a missing citation, not an invented one. An evidence-backed answer that cites nothing
valid is recorded as `degraded_reason: "uncited"`. Validation reads the accumulated answer text —
never the synthetic rate-limited or partial-answer strings — and never rewrites a character of
it: Phase 4 records, Phase 5 renders chips.

**The request log.** `ai_request_log` gained three nullable columns, written only when
`runPipeline` returned a result (`lib/ai/request-log.ts`):

| Column | Type | Meaning |
|--------|------|---------|
| `plan_source` | `text` | `router`, `model` or `fallback` — which planner decided |
| `tools` | `text[]` | the dispatched tools, deduped, in execution order |
| `citations_valid` | `boolean` | whether every cited `[E#]` resolved to supplied evidence |

The mapping uses `?? null`, never a falsy test, so an empty tool list (`[]`) and a `false`
citation verdict survive as real answers, while null means no v2 decision was recorded. `tools` is
capped at `MAX_LOGGED_TOOLS` (8) before insert — the plan caps itself at four steps, so the bound
never truncates a real request. A `v1` request leaves all three null, and so does a v2 request
whose pipeline threw. `degraded_reason` on v2 carries, in precedence order, `retrieval_failed`,
the pipeline's own reason (`pipeline_failed`, `corpus_unavailable`, `execute_budget`,
`ladder_failed`, `tool_failed`, `retrieval_budget`, `evidence_evicted`, `corpus_static`),
`screened`, then `uncited`; `plan_ms` is the planner stage's measurement.

**Migration status.** `20260919130000_ai_request_log_pipeline.sql` (the three columns above) and
`20260919140000_ai_message_feedback.sql` (the feedback table) are committed but **not applied**
to the remote project, like the four `20260919*` migrations before them. Applying either is a
deliberate manual step, and neither a test nor a plan step runs `supabase db push`. The pipeline
migration is additive: three `add column if not exists`, all nullable, no default, and no policy
or grant — `20260919090000` already enables RLS on `ai_request_log` with no policies, and
restating access control is how an additive migration accidentally widens a table only
`service_role` may touch. The feedback migration is likewise additive: one
`create table if not exists` plus two indexes, RLS enabled with no policies and no grants. No
test executes either SQL: `lib/__tests__/ai-request-log-migration.test.ts`,
`lib/__tests__/ai-message-feedback-migration.test.ts` and the memory migration test read the
files and assert their structure, not their effect, because CI has no Postgres.

Manual verification, after applying both migrations:

```sql
select column_name, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'ai_request_log'
   and column_name in ('plan_source', 'tools', 'citations_valid');
-- Three rows, each is_nullable = 'YES' with a null column_default.

select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'ai_message_feedback'
 order by ordinal_position;
-- id, message_id, user_id, value, note, created_at.

select indexname
  from pg_indexes
 where schemaname = 'public'
   and tablename = 'ai_message_feedback'
 order by indexname;
-- ai_message_feedback_message_idx, ai_message_feedback_message_user_idx.
```

**Cost.** v2 adds at most one model call per request, and only when `AI_PLANNER=auto` and the
router is not confident — on the turns where it is sure, and under `off`, the planner spends
nothing. Retrieval and the tools cost no quota at all: the ladder is SQL through the service-role
client (and the static fallback runs in process), the tools are in-process reads, and screening,
assembly and citation validation are pure functions. Memory extraction is unchanged from Phase 3
— every fourth assistant turn, in `after()`, after the answer has been sent. Nothing here
crosses a paid tier or adds a provider.

**Measured.** Both golden evals run offline, with no database, model or network, and both gate at
`RECALL_GATE` (0.85). The retrieval-level eval (`lib/__tests__/retrieval-eval.test.ts`) measures
the ladder over the 60 hand-authored cases at **0.9833** (59 of 60) — 0.9667 before Task 14's
word-order fix in `lib/chat/query.ts`. The pipeline-level eval
(`lib/__tests__/pipeline-eval.test.ts`) measures what the assembled prompt actually numbers,
through the router, the executor, the screener and the assembler over the same 60 cases, at
**1.0000 (60/60)**.

Both files share `evaluateRetrieval`'s report, whose field is `recallAt5`, and the gate is
`RECALL_GATE` (0.85) at `EVAL_K` (5). `npm run test:eval` runs exactly those two files and prints
each measured recall as one line, and `.github/workflows/ci.yml` runs it as its own step named
**"Eval gate (recall)"** between "Test" and "Build", so a slow erosion toward the gate is visible
in the CI log rather than buried in the suite's output. The full suite keeps its own copy of the
assertion, so the gate cannot be removed by deleting a CI line.

### AI observability

**What the log carries.** `ai_request_log` is one row per chat request, written by
`lib/ai/request-log.ts` and read by `lib/ai/observability/store.ts`. Its nineteen columns are the
sixteen from `20260919090000_ai_gateway_infra.sql` — `id`, `user_id`, `conversation_id`,
`target_id`, `outcome`, `plan_ms`, `retrieve_ms`, `ttft_ms`, `total_ms`, `attempts`, `doc_count`,
`cache_hit`, `degraded_reason`, `prompt_tokens`, `completion_tokens`, `created_at` — plus the
three the pipeline added (`plan_source`, `tools`, `citations_valid`), which "The request log"
above describes. Two indexes, `(created_at desc)` and `(user_id, created_at desc)`, are what make
a windowed read bounded, and the table is RLS-enabled with no policies, so every read on this
surface goes through `createAdminClient()`.

**The read side and its bounds.** `lib/ai/observability/store.ts` is a port, a Supabase adapter
and a policy layer, in the shape `lib/ai/feedback/store.ts` establishes. `summary` answers one
window; `recent` answers the newest rows; `feedbackSummary` joins the up/down/noted vote counts
from `ai_message_feedback`; `retention` sweeps expired rows. Every bound is a constant in that
module, and the policy layer clamps whatever a caller hands it, so no caller can widen one:

| Constant | Value | Meaning |
| --- | --- | --- |
| `DEFAULT_WINDOW_MS` | `86_400_000` (24 h) | the window when a caller omits an edge |
| `MAX_WINDOW_MS` | `2_592_000_000` (30 d) | the ceiling; the older edge moves, `untilMs` does not |
| `RECENT_ROW_LIMIT` | `200` | `recent()`'s default **and** ceiling |
| `PERCENTILE_SAMPLE_CAP` | `1000` | rows a `summary` reads for buckets and latency |
| `NULL_BUCKET` | `"none"` | the key a null reason or null source is counted under |

The one distinction a reader must not miss: `requestCount` is **exact** — a `head` count that
transfers no rows — while the breakdowns by `outcome`, `degraded_reason`, `plan_source` and
`citations_valid` are computed from a row sample capped at `PERCENTILE_SAMPLE_CAP`. The summary
therefore carries `sampled` and `sampledRows`, so a capped breakdown is never presented as the
whole window. A null `degraded_reason` (no degradation) and a null `plan_source` (a v1 request)
are counted under `NULL_BUCKET`, not dropped, and `latency.*.count` is the number of non-null
samples rather than the row count — a stage that did not run has no latency, and counting it as
zero would make the median of a window that never retrieved anything look fast.

**The operator surface.** The page at `/admin/ai` (`app/(app)/admin/ai/page.tsx`) is a server
component: it calls `requireAdmin()` — the admin layout already does, and this is defence in
depth — reads the store directly with the service-role client (D1) and renders
`components/admin/AiObservabilityReport.tsx`. A missing table renders as "the request log is not
available yet" rather than a crash, which is the deployed project's real state: none of the
`20260919*` migrations are applied, so every store method rejects.

The JSON route `GET /api/admin/ai-observability` accepts `since`/`until` (ISO timestamps or epoch
milliseconds; an unparseable edge is a 400) and answers `{ summary, recent, feedback }` with
`Cache-Control: no-store`. It has two ways in: an **admin session**, or the **`CRON_SECRET`
Bearer header**, compared in constant time by `lib/cron-auth.ts`. The secret grants no wider a
query — the same window is parsed, the same store answers, the same body comes back. The route
carries no copy of the window bound: it passes the caller's edges through, the store clamps them,
and the summary reports the window that was actually read.

**The retention policy.** `GET /api/admin/ai-retention` is `CRON_SECRET` **only** — there is no
session path, so an admin browser tab cannot delete log rows. `DEFAULT_RETENTION_DAYS = 90`,
overridable by `AI_LOG_RETENTION_DAYS`; an absent, unparseable, non-integer, zero or negative
value falls back to 90, never to 0. A batch is `RETENTION_BATCH_ROWS = 200` and one invocation
runs at most `RETENTION_MAX_BATCHES = 20` of them, so a single call is bounded at 4,000 rows. The
cutoff is `now - retentionDays() * 86_400_000`, and the response reports `retentionDays`,
`cutoffMs` (with an ISO `cutoff` string for the cron log), `dryRun`, `removed`, `batches` and
`exhausted`.

`exhausted: false` means the run stopped at a bound with expired rows still present, so a partial
sweep is never reported as complete. The default is a dry run: only `?dry_run=false` deletes. A
dry run cannot page — the next read would return the same ids — so it reads exactly one 200-row
batch; its `removed` therefore means "the first 200 it would remove", and `exhausted` is the
signal that more remain. The sweep deliberately does **not** go through the store's windowed
reads: `resolveWindow` clamps every window to `MAX_WINDOW_MS` (30 days), so a 90-day cutoff
routed through it would silently under-report by a factor of three while reporting the sweep as
complete. `ai_message_feedback` is never pruned (D3) — it is small, one row per message per user,
and it is the quality signal.

**The crons.** `vercel.json` declares four entries; the first two are pre-existing.

| Path | Schedule |
| --- | --- |
| `/api/sync?mode=airing` | `23 0 * * *` |
| `/api/sync?mode=seed` | `0 3 * * 1` |
| `/api/admin/ai-retention?dry_run=false` | `17 4 * * *` |
| `/api/admin/ingest-corpus` | `41 5 * * 0` |

Vercel Cron Jobs issue **GET**, which is why `GET /api/sync` gained a cron path that delegates to
`POST` when the Bearer secret matches (and otherwise runs its unchanged session-status body), and
why `/api/admin/ingest-corpus` gained a `GET` handler — its `POST` keeps the `x-admin-secret`
header and its behaviour, while the `GET` uses the Bearer secret and calls the same `runIngest`.
On the Hobby (free) tier a cron may fire **at most once per day**, with **±59 minutes** of
scheduling precision — a schedule states a window, not a minute — and a multi-day expression like
`0 9 * * 1-5` would be rejected at deploy time. Cron jobs are capped at **100 per project on
every plan**; all four entries above fire at most daily, so none is rejected. Known gaps in the
sync route: `maxDuration = 60` may be tight for a seed that does two paginated pulls plus per-row
image resolution, a GET cron and a manual admin POST share one rate-limit bucket (2 per 60 s), and
`syncAiring`'s AniList failure fails open by design-accident.

**The response cache (D6).** Unimplemented, and deliberately: the log has never been read and
there is no measured evidence of repeated identical questions, so a cache now would buy no
measured need at the cost of a real correctness risk — a stale answer, and a per-user answer
served from a shared entry. The trigger that would reopen the decision is the log showing the
same question asked repeatedly inside a short window. `ai_request_log.cache_hit` **already
exists** (`20260919090000` defines it `boolean not null default false`) and is always `false`
because nothing writes it, so a future cache needs no migration — only the code that would set
it. Nothing in this phase writes it.

### Chat UI

The client half of the chat lives in `components/chat/`. Its transport is one module, its rendering
is a set of prop-driven components, and the widget that would host them is not rebuilt yet (see
"Not covered yet" below).

**The transport.** `POST /api/ai-chat` answers an AI SDK UI message stream. The route builds it with
the standalone `createUIMessageStream` and wraps it with `createUIMessageStreamResponse` (`ai`
^7.0.107); `toUIMessageStreamResponse` is not a standalone export in this version — it survives only
as a deprecated method on a `streamText` result, which this route does not use — so a reader looking
for it in `app/api/ai-chat/route.ts` will not find it. `lib/ai/stream/protocol.ts` is the one module
both sides import, and it names the four data parts exactly: `data-evidence`, `data-activity`,
`data-degraded` and `data-citations` (`PARTS`). `useChat` (from `@ai-sdk/react`) owns the wire and
reports a `status` of `submitted`, `streaming`, `ready` or `error`; there is no `stopped` status in
the SDK. `useChatStream` adds one, because after an abort the SDK returns to `ready` and cannot say
whether the reader or the network ended the turn: it keeps its own `ChatStreamStatus` (`idle`,
`streaming`, `stopped`, `error`) plus a `stoppedMessageId`, so a turn the reader stopped renders as
stopped rather than complete.

**Two versions that must not be merged.** `AI_PIPELINE`'s `v1`/`v2` is the *pipeline* — plan, gather,
screen, assemble, cite-validate. `PROTOCOL_VERSION` is the *message-stream envelope's* compatibility
seam and is currently `1`. They are different axes and move for different reasons. The route's v2
writes an `evidence` part and a `citations` part; v1 writes neither, so its turns render as text
plus an activity trace and any degrade badges — that is the plan's "parts on v2, only text on v1",
and it is about the pipeline. The envelope version travels once, in the `activity` part, and stays
`1` across that difference: v1 and v2 send the same envelope, an optional field is not a shape
change, and the version bumps only when a part's payload changes shape. A client that reads a
version it does not know renders the text alone rather than guess at the data parts' shapes.

**The view model.** `toMessageViews` maps the SDK's `UIMessage[]` to `ChatMessageView[]` through
`toMessageView`, and every data part is read through `protocol.ts`'s guards, never a cast: a payload
that fails its guard is ignored rather than rendered, and only the first valid part of each kind is
taken. Text parts are concatenated verbatim — the answer is never trimmed, re-encoded or regexed.
`degraded` parts merge across the whole message and dedupe in arrival order, because the route
writes one before the text (the pipeline's own reason, `retrieval_failed`, and `screened`) and one
after it (`uncited`, and the synthetic token), so a client must apply a late part rather than assume
the part always precedes the text. A turn whose `activity` part carries a `protocol` this client
does not know drops the activity, the refs, the citation report and the degraded list together and
renders as text alone. An unknown degrade reason is not hidden: `degradeWording` renders it as
`degraded: <reason>`, the raw token being the only honest thing to show before a wording exists.
`state` is one discriminated value rather than a set of booleans, in precedence order `streaming`,
`stopped`, `synthetic` (a `degraded` part named one of the three synthetic tokens), `degraded` (any
other reason), `complete`.

**Eviction, worded in three lines.** `report.evicted` carries three shapes in one list — dropped
document/wiki ids, a `turns:<n>` marker and a `summary` marker — and `evictionWording` (in
`components/chat/ActivityTrace.tsx`) renders them as three separate lines, because a trimmed turn
and a dropped summary are not sources and one line for all three would misdescribe two of them:
"3 sources did not fit: …", "2 earlier turns were trimmed", "the earlier conversation summary was
dropped". The list is read from its end, since the assembler appends its markers last; reading the
prefixes instead would mistake a document whose id happened to be `turns:5` for a marker.

**The citation contract as the UI sees it.** `components/chat/CitationChips.tsx` builds its list
from `EvidenceRef[]` plus the server's `CitationReport` and from nothing else. The answer text is
never a prop and never parsed: a chip that came from a regex over prose would be the drift the
numbering contract exists to prevent. A number the report marked `unknown` with no matching ref is
a fabricated citation; it has no source to show, and it renders anyway — visually distinct
(`border-danger/50 text-danger`) and named as broken (`E<n> — cited but not among the sources
supplied`) — because dropping it would hide the one fact the validator went to the trouble of
reporting. A number that is both cited and admitted resolves to its ref, one chip and not two. A
turn with no citation report renders no chips at all: the refs are what the model *could* cite, not
what it did.

**The activity and degrade vocabulary.** The authority is `DEGRADED_REASONS` in
`lib/ai/stream/protocol.ts` — the pipeline's eight, the route's three (`screened`, `uncited`,
`retrieval_failed`) and the three synthetic tokens. The wording table in `ActivityTrace.tsx` is
typed `Record<DegradedReason, string>`, so adding a reason to the server's vocabulary without
wording it fails `tsc` rather than reaching a reader as an unexplained badge. `SYNTHETIC_STATE_REASONS`
are filtered out of the list handed to the trace (`traceReasons` in `ChatMessage.tsx`), so each
state is said once: the synthetic badge names it and the trace does not repeat it. The trace renders
no provider name, key or raw error — it has no channel for one — and every number in it is a value
the server measured, never a client clock reading.

Two wordings a reader might expect in the view model are not there. `none` and `not recorded` are
`formatTools` in `components/admin/AiObservabilityReport.tsx`, where `[]` (nothing was dispatched)
and `null` (the row predates the pipeline) must not read alike, and `unmeasured` is that file's
`formatCitations`, the rendering of `citations_valid: null` for a request that made no v2 citation
decision. In the chat UI an empty tool list is `activitySummary`'s "no steps", not "none".

**Feedback storage and its ownership rule.** `public.ai_message_feedback`
(`20260919140000_ai_message_feedback.sql`) is one row per message per user: `value smallint check
(value in (-1, 1))` and an optional `note`, RLS enabled with no policies and grants revoked from
`anon` and `authenticated`, so only the `service_role` key reaches it. A second vote is a
replacement, not a second row: `lib/ai/feedback/store.ts` upserts on `(message_id, user_id)` — the
unique index `ai_message_feedback_message_user_idx` — and `POST /api/ai-chat/feedback` is its only
writer. Ownership is never a client-supplied filter: the message id is resolved through the caller's
own conversations before anything is written, and "no such message", "not yours" and "not an id" are
the same 404, so a caller cannot probe another user's ids. The table is never pruned — it is small
and it is the quality signal — and the observability store reads it through `feedbackSummary`.

**The drawer and the memory panel.** `components/chat/ConversationDrawer.tsx` reads
`GET /api/ai-chat/conversations` (the 30 newest, archived rows excluded) and loads one transcript
from `GET …?id=<uuid>`. Its `DELETE …?id=<uuid>` **archives**: it sets `archived_at`, the transcript
survives, every list read excludes it, and nothing can un-archive it — the port's patch mapping has
a tested explicit-null branch, but no route reaches it, so there is no undo. That is why the guard
against a mis-tap is an inline confirmation in the row rather than a "restore" button after the
fact; an undo here would be a button that lies about what the route can do.
`components/chat/MemoryPanel.tsx` reads `GET /api/ai-chat/memory`, which now reports `memoryEnabled`
alongside `facts` and `cap` so a client can tell "memory is off" from "nothing stored yet" — both of
which arrive as an empty `facts` array. The route deliberately does not consult `AI_MEMORY`: the
switch stops extraction and injection, not transparency, so stored facts are returned either way and
a user who hit the kill switch can still see and remove them. Its `DELETE ?id=<uuid>` is a **real**
delete, unlike the conversations archive, and it takes exactly one id — the route and the
`MemoryStore` behind it have no bulk shape, so a later reader should not add a "clear all"; the
guard against a mis-tap is the inline confirmation in the row.

**Accessibility.** The message container's live region lives in `components/chat/ChatWidget.tsx` and
transitions with the turn: while an answer streams it is `aria-live="polite"` with no `role`, so each
delta is announced without the container also claiming to be a log; when the turn ends it becomes
`aria-live="off"` with `role="log"`, so the finished transcript is navigable as a log rather than
re-announced. `aria-atomic="false"` throughout, so only the changed part is read. Verified in a browser
in both directions. Focus restoration is handled per panel, not by
the primitive: Radix restores focus only to a `DialogTrigger`, and these panels are opened by
controls outside themselves, so each captures `document.activeElement` in `onOpenAutoFocus` and
returns it in `onCloseAutoFocus` (`SourcesPanel`, `ConversationDrawer`, `MemoryPanel`). Every
`framer-motion` transition in `components/chat/` has a reduced-motion branch — `useReducedMotion()`
selects `initial={false}`, so the final state is applied at once — and
`components/chat/__tests__/a11y.test.tsx` drives each keyboard path with `user-event` keys alone and
pins both branches.

**Touch targets.** The drawer's archive control and the memory panel's delete control are `size-11`
(44 px) below `sm` and `size-7` (28 px) at `sm` and up; only the hit area changes, the glyph keeps
its `size-3.5`. The shared dialog close control in `components/ui/dialog.tsx` is a 16 px glyph
(`h-4 w-4`) with `p-1`, so a 24 px hit area — the minimum of WCAG 2.2 SC 2.5.8 — with the offsets
dropped to `3` so the padding grows the box outward around the same glyph position.
`components/chat/__tests__/responsive.test.tsx` asserts both values, and jsdom reports no layout, so
it asserts the Tailwind spacing tokens (4 px per unit) rather than geometry.

**Migration and rollback.** `supabase/migrations/20260919140000_ai_message_feedback.sql` is
committed and **not applied** to any database, and no test executes it: the migration tests read the
file and assert its structure, not its effect, because CI has no Postgres. The manual verification
SQL a human runs after applying it is in "Migration status" above — the columns query against
`information_schema.columns` and the `pg_indexes` query for `ai_message_feedback_message_idx` and
`ai_message_feedback_message_user_idx`. The rollback is `AI_PIPELINE=v1`, and it changes the
pipeline and therefore which parts the UI receives: v1 sends no evidence part and no citations part.
**The UI itself has no v1 switch and must not need one** — it renders text alone when the parts are
absent, so a v1 deployment shows the answer, the activity trace and any degrade badges, with no
chips and no sources.

**What the browser pass measured.** Everything below was observed in a real browser at 360×740 against
the real widget, not in jsdom, because the claims are geometric and jsdom computes no layout. The panel
settles at `336×544` with its right and bottom edges 20 px from the viewport, which is
`w-[min(26rem,calc(100vw-1.5rem))]` and `h-[min(34rem,calc(100dvh-6rem))]`; the composer's form sits
flush inside the panel's bottom edge (1 px, the border). The drawer and the memory panel are
full-viewport sheets at this width — `360×740` at `(0,0)`, `position: fixed`, `top: 0`, `height: 740px`,
`overflow-y: auto` — which is the `h-dvh` branch of `SHEET`, and the exact behaviour the responsive test
could not observe. The composer's textarea caps at 120 px and scrolls internally (`overflow-y: auto`)
rather than growing, and the composer stays inside the panel as it grows. At 360×320 the panel takes the
`dvh` branch of its height (224 px) and the transcript overflows and scrolls. The header's four icon
controls and the composer's two are 28×28 and 40×40 respectively: both clear the 24 px floor of
WCAG 2.2 SC 2.5.8, and the 28 px controls are below the 44 px that iOS HIG and SC 2.5.5 recommend, so
that is a recorded recommendation rather than a defect. Selecting a conversation in the drawer fetches it
by id and replaces the transcript with plain-text turns (no activity trace, which only the stream
carries), and closes the drawer.

**Not verified here.** The two reduced-motion branches and the entrance transitions are CSS-driven, and
the automation tab used for this pass produces no compositor frames, so no animation could be observed
advancing in it; `prefers-reduced-motion` was not toggled either. Those branches are pinned by
`components/chat/__tests__/a11y.test.tsx` on class and prop output, not on motion. The 44 px-versus-28 px
observation above is a measurement, not a judgement about which the design should take.

---

## Profile & Rankings System

### Profile Dossier (`/profile/[username]`)
- **Detective Career Rank Badge**: Level 1 (Civilian Observer) to Level 7 (Master Detective) calculated from `casesSolved`.
- **Public Bio**: Displays user's custom bio with whitespace formatting.
- **Editable Codename (`@username`)**: Users can customize their unique `@username` handle in Settings with real-time validation and collision checks.
- **Career Stats Grid**:
  - Cases Solved (with catalog total)
  - Total Rewatches
  - Hours Watched (days/hours/minutes)
  - Detective Rank Level (clickable link to `/community/rankings`)

---

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://hgwtlbbbkxppbasbhvlo.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
NEXT_PUBLIC_SITE_URL=https://dcphtracker.vercel.app

# Cron sync
CRON_SECRET=...
ADMIN_TASK_SECRET=

# AI Chatbot providers — see .env.example for the full annotated list.
# All optional free tiers; at least one is required or /api/ai-chat returns 500.
# Server-only: never prefix these with NEXT_PUBLIC_ (they would ship to the browser).
GEMINI_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=
OPENROUTER_API_KEY_2=
CEREBRAS_API_KEY=
```

---

## Deployment

- **Platform**: Vercel
- **Auto-deploy**: `main` branch
- **Cron jobs** (Vercel Cron):
  - `/api/sync?mode=airing` — daily
  - `/api/sync?mode=seed` — weekly
- **Production URL**: `https://dcphtracker.vercel.app`

