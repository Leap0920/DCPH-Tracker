# Plan 6 — Observability, the eval gate and cron wiring (Phase 6)

**Spec:** `docs/superpowers/specs/2026-09-19-dcph-bot-agentic-remaster-design.md` §12, Phase 6 —
"`ai_request_log` queries surfaced, eval harness wired into CI, `SYSTEM_DOCS.md` and `.env.example`
updated to match reality."

**Depends on:** Plans 1–4 (gateway, corpus/retrieval, persistence/memory, agentic pipeline) and
Plan 5 Tasks 1–7 (the UI message stream, feedback, the client view model, the rendering). Plan 5's
§9 lists exactly what this phase consumes.

**Status:** planned. Written 2026-09-20, after Plan 5 Tasks 1–7 closed. Plan 5 Tasks 8–11 (the
widget, drawer, memory panel, a11y) remain blocked on precondition P1 — the user's uncommitted
`components/chat/ChatWidget.tsx` — and are **not** part of this plan.

---

## 1. What ships

The pipeline has been writing a rich request log since Phase 1 and **nothing has ever read it**.
This phase builds the read side: a bounded, tested store over `ai_request_log` and
`ai_message_feedback`, an operator surface that renders it, and the retention policy that keeps it
from growing without bound. It also gives the golden evals their own named CI signal instead of
letting them hide inside `npm run test`, and it brings `SYSTEM_DOCS.md` and `.env.example` back in
line with what the code actually does.

Two smaller pieces close debts the earlier phases recorded and deferred to here: `report.evicted`
from `assembleMessages`, which no layer currently carries past the pipeline, and the response-cache
question, which Phase 4 §9 explicitly deferred "to Phase 6 with the log data".

Nothing in Phases 1–5 changes behaviour. The new surface is read-only except for one retention
delete, which is bounded, dry-runnable and off unless a cron explicitly runs it.

## 2. Global constraints

1. **Free tiers only, still.** This phase adds no model call and no provider. The observability
   surface is SQL through the service-role client, and the eval gate runs offline.
2. **`service_role` is server-only, and internal tables stay unreachable from a browser.**
   `ai_request_log` and `ai_message_feedback` both have RLS enabled with no policies; every read
   here goes through `createAdminClient()`. The operator surface is gated on the `admin` role or on
   `CRON_SECRET`, never on being signed in.
3. **`CRON_SECRET` is sent via `Authorization: Bearer` only — never in a query string.** That rule is
   already stated in `app/api/sync/route.ts` and is restated here because this phase adds routes
   that a cron calls.
4. **Every query is bounded.** A window parameter is capped, a row limit is capped, and no query is
   unbounded by default. An observability surface that can table-scan a growing log is a
   denial-of-service on its own database.
5. **Migrations are additive only.** This phase adds **no** migration: the log has carried
   `plan_source`, `tools` and `citations_valid` since `20260919130000`, and feedback has its table
   since `20260919140000`. Retention deletes rows, not schema, and is not a migration.
6. **The evals are the quality gate, and they must stay offline.** `lib/__tests__/retrieval-eval.test.ts`
   and `lib/__tests__/pipeline-eval.test.ts` touch no database, no network, no model and no timer.
   The CI step this phase adds runs exactly those files and nothing else.
7. **A green suite must stay green.** Every task's gate is the full suite (both vitest projects),
   `tsc`, lint and build, exactly as Plans 4 and 5 ran them.
8. **Tests never touch a network, a database, a model or a real timer.** The store is a port with an
   injected client, as `lib/ai/feedback/store.ts` and `lib/ai/memory` already are.
9. **No new npm dependency.** No observability vendor, no metrics library, no chart library.
10. **The in-flight workstream is not swept.** `components/chat/ChatWidget.tsx` and the nine files
    staged with it belong to the user. This phase touches none of them; if a task needs one, it
    stops and reports.
11. **Git discipline.** `git add -- <paths>` then `git commit --only -m "..." -- <paths>`. Never
    `git add -A`, never `git commit -a`, never `--amend`.
12. **Style.** No semicolons, double quotes, 2-space indent.

## 3. Baseline at the start of this plan

Verified at Plan 5 Task 7's close (`5146632`):

- **Tests:** 1,345 / 84 files (node 1,250 / 79, dom 95 / 5). The node count includes the user's
  untracked `lib/__tests__/characters-graph-engine.test.ts` (7 tests) from another workstream.
- **Gates:** `npx tsc --noEmit` exit 0; `npm run lint` 0 errors / 14 pre-existing warnings;
  `npm run build` succeeds with four `/api/ai-chat*` routes; `/community/chat` first load 110 kB.
- **Evals:** retrieval 0.9833 (59/60) and pipeline-level 1.0000 (60/60), both gating at
  `RECALL_GATE` (0.85) from inside `npm run test`.
- **The log is write-only.** `ai_request_log` is written by `lib/ai/request-log.ts` and read by
  nothing. Nineteen columns: `id`, `user_id`, `conversation_id`, `target_id`, `outcome`, `plan_ms`,
  `retrieve_ms`, `ttft_ms`, `total_ms`, `attempts`, `doc_count`, `cache_hit` (always `false` — see
  D6), `degraded_reason`, `prompt_tokens`, `completion_tokens`, `created_at`, plus Phase 4's
  `plan_source`, `tools` and `citations_valid`. Two indexes exist: `(created_at desc)` and
  `(user_id, created_at desc)`, which is what makes a windowed read bounded.
- **`ai_message_feedback`** exists (migration committed, **not applied**) with `message_id`,
  `user_id`, `value` (`1`/`-1`), `note`, `created_at`, and `forMessages(ids)` already written for
  this phase.
- **`report.evicted`** is produced by `assembleMessages` and read by nobody: `PipelineResult` does
  not carry it, so the route cannot send it and the UI cannot render it.
- **Cron:** `vercel.json` declares two entries, both hitting `/api/sync`. `CRON_SECRET` is verified
  by a private `headerMatchesSecret` inside `app/api/sync/route.ts` — the only copy in the repo.
- **CI:** `.github/workflows/ci.yml` runs typecheck, lint, `npm run test` and build, with build-time
  placeholder Supabase env vars and a comment that the `.next/` output must never be deployed.
- **`app/admin.tsx`** is a 24-line stub. `app/api/admin/route.ts` is the admin-role gate pattern:
  `isSameOrigin` → rate limit → `getUser()` → `profiles.role === "admin"`.

## 4. Architecture of the new path

```text
operator (browser)                          cron (Vercel)
  GET /admin/ai  (server component)           GET /api/admin/ai-observability
      │ admin role in profiles                    │ Authorization: Bearer CRON_SECRET
      └──────────────┬──────────────────────────────┘
                     ▼
        lib/ai/observability/store.ts          the read side, bounded
          summary({ sinceMs, untilMs })          counts by outcome / degraded_reason /
          recent({ limit })                      plan_source, latency, citation rate
          └─ createAdminClient()  ── SQL ──►  ai_request_log
        lib/ai/feedback/store.ts forMessages() ►  ai_message_feedback

  GET /api/admin/ai-retention                cron, CRON_SECRET, dry_run default
      └─ delete rows older than RETENTION_DAYS, bounded per run

  npm run test:eval  →  the two golden evals, own CI step, prints the measured numbers
```

Three properties this shape exists to keep:

1. **One read side, two callers.** The admin page and the cron route call the same store, so the
   number a human reads and the number a machine reads cannot disagree.
2. **The store owns the bounds.** The window, the row limit and the retention age are constants in
   one module, not parameters a caller can widen.
3. **Reads never change behaviour.** Nothing in this phase is on the answer path; a failure in any
   of it must be invisible to a chat request.

## 5. Deviations and decisions taken here

**D1 — A server component, not a client fetch, for the operator page.** `app/(app)/admin/ai/page.tsx`
(C13: the admin UI lives in the `(app)` route group) reads the store directly with the service-role
client after checking the admin role. A client
component fetching an API route would add a round trip, a loading state and a second place the auth
check could be forgotten. The JSON route exists for the cron and for any future tooling, not for the
page.

**D2 — Admin role *or* `CRON_SECRET`, and the secret wins no privileges.** The route accepts either,
because a cron has no session. The secret is compared in constant time against a SHA-256 digest of
the header, exactly as `app/api/sync/route.ts` does, and never read from a query string. The two
paths are otherwise identical — the secret does not unlock a wider query.

**D3 — Retention deletes, and it is the only write in this phase.** `ai_request_log` grows one row
per chat request forever. A bounded, `dry_run`-by-default delete of rows older than a configurable
age is the honest fix; the alternative — an unbounded table on a free-tier database — is how the
observability feature becomes the outage. `ai_message_feedback` is **not** pruned: it is small
(one row per message per user) and it is the quality signal, which is the thing worth keeping.

**D4 — The eval gate is a separate named CI step, not a new test file.** The evals already run
inside `npm run test` and already fail the build on a regression. What they do not do is *show their
number*, so a slow erosion toward the gate is invisible in the log. The step runs the same two files
through a `test:eval` script and prints the measured recall, and the suite keeps its own copy of the
assertion so the gate cannot be removed by deleting a CI line.

**D5 — `report.evicted` is plumbed, not recomputed.** The pipeline already computes which documents
were dropped; this phase carries it out (`PipelineResult.evicted`) and renders it in the activity
trace's expanded view. Recomputing it anywhere would be a second answer to the same question. The
protocol field is **optional and additive**, so `PROTOCOL_VERSION` does not move — `protocol.ts`'s
own rule is that the version bumps when a payload changes shape, not when an optional field appears.

**D6 — The response cache stays unimplemented, and that is the Phase 6 answer.** Phase 4 §9 deferred
the decision here. The evidence for caching would be a log showing the same question asked
repeatedly within a short window; the log has never been read and the deployed project has none of
the `20260919*` migrations applied, so there is no such evidence and inventing a cache now would be
a correctness risk (stale answers, per-user data in a shared entry) bought with no measured need.
The decision is recorded in `SYSTEM_DOCS.md` with the trigger that would reopen it, and Task 6
carries it out. Note that **`ai_request_log.cache_hit` already exists** (`20260919090000` defines it
`boolean not null default false`) and nothing ever sets it, so a future cache needs no migration —
only the code that would write it. Task 6 must say that, not claim the column was skipped.

**D7 — No chart library, no new palette.** The operator page renders numbers and short tables in the
existing tokens. A sparkline is not worth a dependency (constraint 9).

### C1–C5 — corrections found while executing Task 1

Recorded as each task completed, in the Plan 4/5 pattern. A correction here overrides the task text
above it.

**C1 — Task 1's `Files:` header omits the file its own item 4 mandates.** §6 Task 1 lists
`package.json`, `ci.yml` and "the two eval tests", but item 4 requires a new guard test — and the
task index's Delta column says "+1 guard test". The guard lives at
`lib/__tests__/eval-gate.test.ts`.

**C2 — Task 1's guard did not pin the workflow step, and that is the hole D4 exists to close.**
Deleting the `Eval gate (recall)` step from `ci.yml` left every other test green and the gate
invisible again. A fourth assertion in `lib/__tests__/eval-gate.test.ts` now reads `ci.yml` and
requires both the step name and `npm run test:eval` (commit `a968048`).

**C3 — D4's cost is real and unstated.** The step re-runs both eval files that "Test" already ran,
adding ~4.3 s per CI run. That is the intended trade — visibility for seconds — but D4 reads as if
the step were free.

**C4 — "Both eval files print their measured value" is per file, not per test.**
`pipeline-eval.test.ts` has two tests that compute recall (the gate test and the determinism test);
only the gate test prints, so the file emits one line, as D4's "a single line" requires. A reviewer
should not expect two lines from it.

**C5 — The pipeline report's field is `recallAt5`, not `recall`.** Both evals share
`evaluateRetrieval`'s report, whose field is `recallAt5`; the gate is `RECALL_GATE = 0.85` with
`EVAL_K = 5`. Task 6 must document the gate with those real names and the real measured numbers
(retrieval 0.9833, 59/60; pipeline 1.0000, 60/60).

**Verified at Task 1's close** (`f9fbd7f` + `a968048`): 85 files / **1,349** tests (node 80 files /
**1,254** tests; dom 5 files / 95 tests); `tsc` exit 0; lint 0 errors / 14 warnings; build succeeds
with the four `/api/ai-chat*` routes. `npm run test:eval` runs exactly the two eval files and prints
`retrieval recall@5 0.9833 (59/60) ≥ 0.85` and `pipeline-level recall 1.0000 (60/60) ≥ 0.85`.
The counts in this paragraph originally read 1,348 / 1,253 — C11 corrects them.

### C6–C11 — corrections found while executing Task 2

**C6 — §4's diagram promised a cursor that does not exist.** The diagram's operator row read
`recent({ limit, cursor })`; §6 Task 2 item 3 and the module both implement `recent({ limit })` with
no pagination. The diagram now says `recent({ limit })`. If the operator page ever needs a second
page, that is new work with its own bound — a cursor over `created_at` is the obvious key, since
`(created_at desc)` is already indexed.

**C7 — §6 Task 2 item 2 is not implementable as a literal reading, and the plan must say what it
actually gets.** PostgREST has no `GROUP BY`, so exact counts by `outcome`, `degraded_reason`,
`plan_source` and `citations_valid` would require enumerating every value of a free `text` column.
The module instead takes an **exact** `requestCount` from a `head: true` count (no rows
transferred), and computes the buckets from a row sample capped at `PERCENTILE_SAMPLE_CAP`, exposing
`sampled: boolean` and `sampledRows: number` so a capped breakdown can never be presented as the
whole window. Task 3's page must render `sampled` — a breakdown shown without it is a lie about the
window.

**C8 — §6 Task 2 item 5 named four bounds but gave no values.** The module fixes them, and Task 3
and Task 6 must import or quote these rather than restating them:

| Constant | Value | Meaning |
| --- | --- | --- |
| `DEFAULT_WINDOW_MS` | `86_400_000` (24 h) | the window when a caller omits an edge |
| `MAX_WINDOW_MS` | `2_592_000_000` (30 d) | the ceiling; the older edge moves, `untilMs` does not |
| `RECENT_ROW_LIMIT` | `200` | `recent()`'s default **and** its ceiling |
| `PERCENTILE_SAMPLE_CAP` | `1000` | rows a `summary` reads for buckets and latency |
| `NULL_BUCKET` | `"none"` | the key a null reason or null source is counted under |

`MAX_WINDOW_MS` is the one Task 3's route must import — a route that restates "30 days" as a literal
is the second copy that drifts. `NULL_BUCKET` is a string because it is a `Record` key: a v1
request's null `plan_source` and a request that degraded for no reason both land under `"none"`, and
the page renders it as "none" rather than hiding it.

**C9 — the latency trio omits `plan_ms`.** The table carries `plan_ms` and the writer sets it for v2
requests, but §6 Task 2 item 2 asks only for `retrieve_ms` / `ttft_ms` / `total_ms`, so no percentile
exists for planning. Each `recent` row does carry `planMs`. This is deliberate — `retrieve_ms`
already contains planning (the Plan 5 C-finding that produced `ActivityTrace`'s "Retrieve (includes
plan)" label) — but the plan should have said so instead of leaving a reader to wonder.

**C10 — §6 Task 6 item 1 said "thirteen columns"; the table has nineteen.** Sixteen from
`20260919090000` plus the three from `20260919130000` (`plan_source`, `tools`, `citations_valid`).
Corrected in place above; the number would otherwise have propagated into `SYSTEM_DOCS.md` as fact.

**C11 — this document's own Task 1 baseline was off by one test, and the cause is known.** Task 1's
close recorded 1,348 / node 1,253. The true figures are **1,349 / node 1,254**. Proven, not guessed:
a `git worktree` at `7e4f7dc` with `.env.local` copied in measures **84 files / 1,342 tests**, and
the two files that worktree lacks relative to the working tree are
`lib/__tests__/observability-store.test.ts` (Task 2's, 28 tests) and the **untracked**
`lib/__tests__/characters-graph-engine.test.ts` (7 tests). 1,342 + 7 = 1,349. Nothing was added or
removed between the two commits — `git diff --stat 7e4f7dc..HEAD` is the two new files alone — so
the earlier number was a transcription error, not a drift. The lesson for the remaining tasks: when
a count is recorded, the working tree contains untracked test files from the user's in-flight
workstream, and any count that excludes them will disagree with a clean checkout.

**Verified at Task 2's close** (`cd012fe`): 86 files / 1,377 tests (node 81 files / 1,282 tests; dom
5 files / 95 tests); `tsc` exit 0; lint 0 errors / 14 warnings; build succeeds with the four
`/api/ai-chat*` routes. The two new files are `lib/ai/observability/store.ts` (505 lines) and
`lib/__tests__/observability-store.test.ts` (657 lines, 28 tests). The nine in-flight files remain
staged and `components/chat/ChatWidget.tsx` is untouched.

### C12–C17 — corrections found while executing Task 3

**C12 — my C8 wording contradicted itself, and the resolution is that the store owns the bound.**
C8 said both "import `MAX_WINDOW_MS`" and (in the dispatch brief) "pass the caller's values
through". Under pass-through the route never names a bound, so importing the constant would be a
dead import that only adds a lint warning. The authoritative reading is the behavioural one, and it
satisfies §6 Task 3 item 1 ("validated and **clamped** to the store's maximum") and §8 criterion 3
end to end: the route validates and refuses an unparseable edge with a 400, the store clamps, and
the response's `summary.sinceMs`/`untilMs` report the window actually read. **One bound, in the
module that owns it.** C8's "import `MAX_WINDOW_MS`" sentence applies only if a future caller
clamps in the route — do not restate the value as a literal there either.

**C13 — the page path is `app/(app)/admin/ai/page.tsx`; the plan's `app/admin/ai/page.tsx` does not
exist.** The admin UI lives in the `(app)` route group (as do `/admin/content`, `/admin/sync`,
`/admin/users`), so the URL is `/admin/ai` but the file is under the group. §5 D1 and §6 Task 3's
`Files:` header both carried the wrong path.

**C14 — the page must not hand-roll the role check, and the plan's "exactly as `app/api/admin/route.ts`
does" is the wrong model for a page.** `lib/auth/admin.ts` already exports `requireAdmin()`, and
`app/(app)/admin/layout.tsx` already calls it for every page beneath it. The page calls it again as
defence in depth; the route, which has no layout, returns 403 the way `app/api/admin/route.ts` does.
Two surfaces, two correct answers — the plan conflated them.

**C15 — the vitest project split dictates where the tests can live, and the plan's suggested path was
impossible.** The dom project's `include` is `components/**/*.test.{ts,tsx}` only, so a JSX test under
`app/**` is never collected; the node project excludes `components/**`. The route test is therefore
`app/api/admin/ai-observability/route.test.ts` (node, 16 tests) and the component test is
`components/admin/__tests__/ai-observability-report.test.tsx` (dom, 11 tests). §6 Task 3's
`app/admin/__tests__/ai-observability.test.ts` could not have run.

**C16 — an async server component cannot be rendered by either vitest project, so the page's own two
decisions are covered only indirectly.** React's sync/legacy renderers cannot await an async
component and there is no jsdom project for `app/**`. The page is therefore deliberately thin — auth,
store read, render a pure component — and the *behaviours* its branches produce are covered: the
missing-table state by the component's `status="unavailable"` test, the store-failure path by the
route's 500 test, and the guard by the same `requireAdmin()` the admin layout already calls. **What
is not executed by any test is the page's own `requireAdmin()` call and its `try/catch` wiring.** That
is a real, recorded gap, not an oversight: closing it would need a third vitest project for `app/**`
with a server-component renderer, which is out of scope here. Task 6's documentation must not claim
the page is unit-tested.

**C17 — `summary` and `feedbackSummary` resolved their windows independently, so the page could show
two different windows.** Each method calls `resolveWindow(input, clock())` with `clock` defaulting to
`Date.now`, and the page and route call them in a `Promise.all`. Two `Date.now()` calls can straddle a
millisecond, so the summary's reported window and the feedback's window could differ — small, but it
is exactly the kind of dishonesty this surface exists to avoid, and the page's one-sentence
explanation would then be wrong about the feedback numbers beside it. Both call sites now read the
clock **once per request** and inject it through the store's existing `now` seam
(`createObservabilityStore({ port, now: () => now })`), which is what that seam is for. Pinned by a
route test asserting the injected clock is fixed (commit `3e9f100`).

**Verified at Task 3's close** (`c9ac0b4` + `3e9f100`): 88 files / **1,404** tests (node 82 files /
1,298 tests; dom 6 files / 106 tests); `tsc` exit 0; lint 0 errors / 14 warnings; build succeeds with
`/admin/ai` (2.17 kB / 117 kB first load) and `/api/admin/ai-observability` (256 B) in the route
table; `npm run test:eval` passes and still prints both measured numbers. Six files in the Task 3
commit, three in the clock fix. The nine in-flight files remain staged and
`components/chat/ChatWidget.tsx` is untouched.

### C18–C22 — corrections found while executing Task 4

**C18 — §6 Task 4 item 2's parenthetical is false, and taken literally it is a behaviour change.**
`AssemblyReport.evicted` holds **three shapes in one list** (document/wiki ids, then `turns:<n>`, then
`summary`), so `evicted.length > 0` is true for a trimmed turn or a dropped summary alone. But
`degraded: "evidence_evicted"` is set only when `evictedIds.length > 0` — document evictions. Feeding
`degradeReason`'s `evicted` argument from the new list's length would therefore newly degrade a
turn-trim-only request, changing `PipelineResult.degraded`, the `ai_request_log` row and the badge a
reader sees. The call site is **unchanged** (`assembled.report.degraded === EVIDENCE_EVICTED`) and two
new tests pin it: a `["turns:2"]` result and a `["summary"]` result must both carry a non-empty
`evicted` **and** a `null` `degraded`.

**C19 — Task 4's `Files:` header and its "5 modified files" delta are wrong; two of the five needed no
change.** `lib/ai/pipeline/assemble.ts` already exported `TURN_EVICTION_PREFIX` and
`SUMMARY_EVICTION`, and `app/api/ai-chat/route.ts` already hands the whole `PipelineResult` to
`buildActivityPart`, so neither was touched. The real delta is three source files
(`lib/ai/pipeline/index.ts`, `lib/ai/stream/protocol.ts`, `components/chat/ActivityTrace.tsx`) and
four test files.

**C20 — "lists the evicted ids in one line ('3 sources did not fit: …')" is only honest for the first
group.** `turns:<n>` and `summary` are not sources, and the plan's single line would have labeled a
trimmed turn as a source that "did not fit". The expanded view renders three separate lines — sources
with their ids, trimmed turns, the dropped summary — from an exported `evictionWording` helper that
reads the markers from the tail of the list (the order `assemble.ts` writes them in). The collapsed
line is unchanged.

**C21 — the marker duplication in `protocol.ts` is deliberate, and a test is what keeps it honest.**
`ActivityTrace.tsx` is a client component, so importing `assemble.ts` for the marker values would pull
the assembler and its tokenizer into every client bundle that renders a trace. `protocol.ts`
therefore declares `TURN_EVICTION_MARKER`/`SUMMARY_EVICTION_MARKER` itself, and a node test asserts
they equal the assembler's exported constants — the copy cannot drift silently.

**C22 — the bundle-safety rule was load-bearing and unpinned.** C21's duplication exists only because
`protocol.ts` must stay browser-bundle-safe, and nothing in the suite would have noticed a value
import being added — the rule was verified by hand (an esbuild `--platform=browser` bundle containing
zero `import`/`require` statements) and would have rotted. A test now reads
`lib/ai/stream/protocol.ts` and requires every `import` line to be an `import type`. Negative control
run: appending a value import fails it with the offending line quoted (commit `cd09c7d`).

**Verified at Task 4's close** (`e0c81d2` + `cd09c7d`): 88 files / **1,421** tests (node 82 files /
1,309 tests; dom 6 files / 112 tests); `tsc` exit 0; lint 0 errors / 14 warnings; build succeeds;
`npm run test:eval` passes and still prints `retrieval recall@5 0.9833 (59/60) ≥ 0.85` and
`pipeline-level recall 1.0000 (60/60) ≥ 0.85`. `PROTOCOL_VERSION` remains `1`, and the
browser-target bundle of `protocol.ts` is still 3.8 kB with zero `import`/`require` statements.

### C23–C31 — corrections found while executing Task 5

**C23 — the plan's regression proof for the `headerMatchesSecret` extraction did not exist.**
§3 ("the only copy in the repo"), §6 Task 5 item 1 ("its existing tests are the regression proof that
the extraction changed nothing") and §7's risk table all assert that `app/api/sync/route.ts` has
tests. It has none: `app/api/sync/` held only `route.ts`, and no test file imported it. The
extraction's safety therefore rested on the moved body being byte-identical plus
`lib/__tests__/cron-auth.test.ts`. **Closed in `8265118`** — `app/api/sync/route.test.ts` now exists
(10 tests, then 12), covering the GET cron delegation, the session status body, the wrong/absent
secret paths, the query-string refusal and the guard order. Two related staleness points: §3's "the
only copy in the repo" was already false when Task 5 started (Task 3 had added a second copy in
`ai-observability/route.ts`), and the new file needed a **chainable thenable Supabase stub** rather
than the plain object the other route tests use, because this route queries the database itself
instead of delegating every read to a mocked collaborator.

**C24 — the two existing `vercel.json` crons had never run.** Vercel Cron Jobs issue **GET**, and
`GET /api/sync` was a session-only status endpoint taking no request argument and ignoring `?mode=`.
So `/api/sync?mode=airing` and `/api/sync?mode=seed` returned 401 to every cron invocation, and had
done since they were added. Task 5 item 4's "do not change or remove the two existing entries" was
only honest once `GET` gained a cron path: it now delegates to `POST` when
`headerMatchesSecret(authorization, cronSecret())` matches, and otherwise runs the **unchanged**
session-status body. Two preconditions were checked rather than assumed: `isSameOrigin` returns true
with no `Origin` header (a cron sends none), and `POST` reads `mode`/`dry_run`/`limit` from
`request.nextUrl.searchParams`, which a GET request carries.

**C25 — the retention sweep cannot use the store's windowed reads, and the plan never said so.**
`resolveWindow` clamps every window to `MAX_WINDOW_MS` (30 days). A 90-day retention cutoff routed
through it would silently clamp to 30 days, so a "count what would be deleted" built on
`countRequests` would under-report by a factor of three while reporting the sweep as complete. The
retention path therefore has its own bounded, **unwindowed** read (`select id … lt(created_at, cutoff)
order created_at asc limit n`) and does not touch `resolveWindow` at all. Pinned by a test that
asserts the cutoff is the full 90 days and not the 30-day clamp; the negative control (routing the
cutoff through `resolveWindow`) fails it with `NOW - 30d` against the expected `NOW - 90d`.

**C26 — §6 Task 5's `Files:` header omits `lib/ai/observability/store.ts`.** The retention constants,
the `AI_LOG_RETENTION_DAYS` reader and the sweep itself all had to live there, because §3's property 2
says the retention age is a constant in one module and the module that owns the other bounds is the
store. The `Delta:` line is understated too: the real delta is four new files, six modified
source/test files, plus `vercel.json`.

**C27 — the dry run reports one batch, not the whole backlog, and the plan's wording invites the
wrong reading.** A dry run deletes nothing, so it cannot page — the next read would return the same
ids. It reads exactly one `RETENTION_BATCH_ROWS` (200) batch and reports `exhausted: false` when that
batch was full. So a dry-run `removed` means "the first 200 it would remove", and `exhausted` is the
signal that more remain. Task 6 must document this precisely rather than implying `removed` is the
total expired count.

**C28 — the Vercel Hobby tier does not limit this, and the concern that it might was resolved by
research rather than assumption.** Task 5's four `vercel.json` entries raised the question of whether
Hobby's cron limits make the file undeployable. Researched (Vercel's own docs, 2026-09): **cron jobs
are capped at 100 per project on every plan** — the old per-team cap of 2 for Hobby was lifted in
January 2026 — and Hobby's real restriction is that a cron may fire **at most once per day**, with
±59 minutes of scheduling precision. All four entries satisfy that (`23 0 * * *` daily, `0 3 * * 1`
weekly, `17 4 * * *` daily, `41 5 * * 0` weekly); a multi-day expression such as `0 9 * * 1-5` would
be rejected at deploy time, and none is used. So the "$0, free tiers only" constraint holds. The one
caveat worth documenting is the ±59-minute precision: a schedule states a window, not a minute.

**C29 — `mode` was unvalidated on a path Task 5 made live for the first time.** `POST`'s docblock
documents `mode=seed|airing|all`, but only `airing` was special-cased — everything else, including a
typo like `mode=airng`, fell through to the full seed (two paginated pulls plus per-row DCW image
resolution). That was harmless while no cron could reach the route; once C24 made the crons work, a
mistyped `vercel.json` path or a stray curl would silently buy an expensive invocation instead of an
error. The route now validates `mode` against `SYNC_MODES = ["all", "seed", "airing"]` and answers
400 otherwise, **after** the auth guards so an anonymous caller still gets its 401 rather than
learning the vocabulary (`3846399`). Safe for every real caller: `lib/actions/admin-system.ts`'s
`SyncMode` is `"seed" | "airing"` and `vercel.json` uses those two.

**C30 — an unused `rateLimit` import was removed from `app/api/sync/route.ts`.** Only
`authRateLimitKey` is used; lint is silent on it (the config reports no unused-import rule for this
file), so it had sat there unremarked. Same commit as C29.

**C31 — three pre-existing sync-route risks are recorded, not fixed.** (a) `maxDuration = 60` covers
a seed that performs two paginated full syncs plus per-row image resolution, and the airing branch
paginates too — it may exceed 60 s on Vercel, and Hobby's function ceiling is 300 s if it needs
raising. (b) A GET cron and a manual admin POST share one rate-limit bucket
(`sync:post:${pathname}:ip:${ip}`, limit 2/60 s), so a manual POST in the same minute as a cron run
would 429; the two crons run at different minutes so they do not collide with each other.
(c) `syncAiring`'s AniList failure fails open (`latestAired` stays `Number.MAX_SAFE_INTEGER`), which
is plausibly intentional but is not stated. None is in this phase's scope; each is a candidate for a
later one.

**Verified at Task 5's close** (`74ef3f1` + `8265118` + `3846399`): 91 files / **1,477** tests (node
85 files / 1,365 tests; dom 6 files / 112 tests); `tsc` exit 0; lint 0 errors / 14 warnings; build
succeeds with `/api/admin/ai-retention` (258 B) and `/api/sync` (258 B) in the route table;
`npm run test:eval` passes and still prints both measured numbers. `headerMatchesSecret` now exists
in exactly one place (`lib/cron-auth.ts`) with four importing routes. The nine in-flight files remain
staged and `components/chat/ChatWidget.tsx` is untouched.

### C32–C35 — corrections found while executing Task 6

**C32 — §6 Task 6 item 3's test list was incomplete.** The item says "no test executes SQL —
`lib/__tests__/ai-request-log-migration.test.ts` and the memory migration test read the files". The
repo has a **third** structural test, `lib/__tests__/ai-message-feedback-migration.test.ts`, which
reads `20260919140000` and asserts its shape. All three are now named in `SYSTEM_DOCS.md`.

**C33 — the "four `20260919*` migrations before it" count was not stale, and the item's premise was
wrong.** `20260919090000`, `20260919100000`, `20260919110000` and `20260919120000` are exactly four
before `20260919130000`, so the arithmetic was right. The real defect was that the paragraph never
mentioned `20260919140000` at all. The text now reads "the four `20260919*` migrations before them",
which is true of both.

**C34 — the retention response carries a seventh field.** `cutoff` (an ISO string restating
`cutoffMs`, for the cron log) plus `ok: true`, neither of which the brief listed. Documented from the
route rather than the brief. The general lesson: a response shape must be read off the route.

**C35 — C18's substance was already in the docs, and one sentence now closes it.** The agentic-pipeline
section already said "any evicted **document** sets `degraded: \"evidence_evicted\"`", which is the
precise distinction. What it did not say is that the list now reaches the reader, that
`PipelineResult.evicted` is never null, and that `ActivityPart.evicted` is optional so
`PROTOCOL_VERSION` stays `1`. Added in `e0ce400` — the place a reader forms the wrong belief is
exactly the sentence that states the rule.

**Verified at Task 6's close** (`71289ee` + `e0ce400`): the suite is **unchanged at 91 files / 1,477
tests** (node 85/1,365, dom 6/112) — a documentation-only change moved nothing, which is the check
that the file list was respected; `tsc` exit 0; lint 0 errors / 14 warnings. `SYSTEM_DOCS.md` gains a
106-line `### AI observability` subsection at line 718, at the end of the `## AI Chatbot (DCPH Bot)`
section and before the `---` preceding `## Profile & Rankings System`, plus an extended `Measured.`
paragraph and a rewritten `Migration status.` paragraph covering both migrations. `.env.example`
gains one `AI_LOG_RETENTION_DAYS` group, all existing entries byte-identical.

### C36 — the twelve completion criteria, checked against the tree

Checked against the repository, not against the task reports:

1. **Met.** `npm run test:eval` runs exactly the two eval files, prints
   `retrieval recall@5 0.9833 (59/60) ≥ 0.85` and `pipeline-level recall 1.0000 (60/60) ≥ 0.85`, and
   is the CI step `Eval gate (recall)` between Test and Build; `package.json`'s `test` is still
   exactly `vitest run`, so the suite keeps its own `RECALL_GATE` assertions.
2. **Met.** `lib/ai/observability/store.ts` answers `summary`, a bounded `recent` and
   `feedbackSummary`, plus the retention sweep; every bound is a module constant; 28+ tests assert
   the clamped window and capped limit reached the query.
3. **Met.** `GET /api/admin/ai-observability` answers both auth paths with one shape and rejects a
   non-admin session, a wrong secret, a query-string secret, a cross-origin caller and an
   unparseable edge. The window is clamped by the store, which is the only owner of the bound (C12).
4. **Met, with C16's recorded gap.** `/admin/ai` renders the summary and recent rows for an admin and
   the honest empty state when the log is absent. The *component* is tested in both states and the
   *route*'s failure path is tested; the page's own `requireAdmin()` and `try/catch` are executed by
   no test, because no vitest project can render an async server component.
5. **Met.** `PipelineResult.evicted` → optional `ActivityPart.evicted` → the trace's expanded lines,
   with `PROTOCOL_VERSION` still `1`; `degraded`'s behaviour unchanged and pinned by two tests (C18).
6. **Met.** `GET /api/admin/ai-retention` defaults to `dry_run=true`, requires `CRON_SECRET` with no
   session path, touches only `ai_request_log`, and reports `retentionDays`, `cutoffMs`, `cutoff`,
   `dryRun`, `removed`, `batches`, `exhausted`.
7. **Met.** `lib/cron-auth.ts` holds the only `headerMatchesSecret`; `app/api/sync/route.ts`,
   `ai-observability/route.ts`, `ai-retention/route.ts` and `ingest-corpus/route.ts` import it.
8. **Met.** `vercel.json` has four entries, the two `/api/sync` ones byte-identical to before;
   `/api/admin/ingest-corpus` answers GET behind `CRON_SECRET` with its POST path unchanged.
9. **Met.** `SYSTEM_DOCS.md` documents the nineteen columns, the five bounds, the operator surface and
   its two auth paths, retention with C27's dry-run semantics, the four crons with C28's tier limits,
   the eval gate, and the D6 cache decision; `.env.example` names `AI_LOG_RETENTION_DAYS`.
10. **Met.** `git diff --name-only f9504ba..HEAD | grep -c supabase/migrations` is **0** — this phase
    added no migration — and both migrations are described as committed and not applied.
11. **Met.** Every task's close was verified independently: full suite in both projects, `tsc` exit 0,
    lint 0 errors / 14 warnings, build succeeding with the four `/api/ai-chat*` routes plus the new
    ones.
12. **Met.** `git diff --quiet -- components/chat/ChatWidget.tsx` holds (worktree equals index) and
    all ten in-flight paths remain staged; no Plan 6 commit touched one.

**Plan 6's final state:** `f9fbd7f`, `a968048`, `7e4f7dc`, `f9504ba`…`e0ce400` — 91 files /
1,477 tests, `tsc` exit 0, lint 0 errors / 14 warnings, build green.

### C37 — the browser acceptance pass, and what it found

The unit suites pin the parts and the guards; they cannot see layout, hover, focus or a real
response. So a real browser (the in-app browser, 1280×900 and 390×844) was driven over a
**temporary, uncommitted harness** — `app/dev-preview/page.tsx` and its client sibling — which
mounted the shipped components with hand-built data and was deleted afterwards. The harness is
the point worth recording: it built AI SDK `UIMessage`s exactly as the route emits them and ran
them through the real `toMessageViews`, so the browser exercised the parts→view-model mapping and
the guards, not a lookalike renderer. An earlier draft that hand-built `ChatMessageView`s was
discarded for exactly this reason — it rendered a trace for a turn whose `protocol` was `99`,
which the real mapping discards, i.e. it would have "verified" behaviour the product does not have.

**Verified in the browser, with the real components.** Observability (Plan 6 T3): the exact count
beside the sampled row count with the `sampled` badge and its disclaimer, and the `complete` badge
under the cap; a zero-row window rendering "No requests were logged in this window." as a state
distinct from the unavailable card; buckets sorted descending with a null reason under `none`; a
stage that never ran reading "no data" rather than `0 ms`; and the two null-vs-empty distinctions
rendering as designed — `tools: []` as `none` against `tools: null` as `not recorded`, and
`citations_valid: null` as `unmeasured`. Chat (Plan 5 T5–T7): chips built from `citations.cited`
only (an admitted-but-uncited `E3` correctly has no chip), a fabricated `E7` rendering as a
distinct broken chip, the trace's reader-facing tool verbs, its total being retrieve + assemble
and **not** also adding `planMs` (the double-count `totalActivityMs` documents), the expanded
stage table and plan-source line, and the eviction list rendering as three separate honest lines —
`2 sources did not fit: entry:6, entry:5`, `4 earlier turns were trimmed`, `the earlier conversation
summary was dropped` — which is C20's whole point. Also: the synthetic badge, the stopped note with
no rating offered, typing dots with no copy button, an unknown `protocol` dropping the activity,
evidence and citations parts so the turn renders as text alone, an unknown reason surfacing as
`degraded: some_future_reason` rather than being hidden, a wholly malformed part set being ignored,
the user turn aligned right, and the legacy shape unchanged. Interactions: a chip opens the inline
panel with the highlight landing on the right ref (`aria-current="true"` on `E2`), the modal panel
reports the fabricated `E9` in words, a vote POSTs `{messageId, value:1}` and lights the thumb, and
a 500 rolls the thumb back and shows the fixed message with no raw failure text.

**Findings.** Two, both minor, neither a Plan 5/6 regression:

- **F1 (cosmetic, P3).** In the recent-requests table the `TOTAL` cell wraps — `1712 ms` breaks
  onto two lines — because `TIME` carries `whitespace-nowrap` and the latency cells do not. The
  fix is `whitespace-nowrap` on the latency cells in `RecentRow`.
- **F2 (hardening, P3, pre-existing).** `POST /api/ai-chat` checks its provider configuration
  (500) before the same-origin guard (403) and before auth (401), so an anonymous caller can learn
  "Chat is not configured on this server" on a misconfigured deployment. `git show f58e6f6^` shows
  the same order before the gateway rewire, so it is inherited, not introduced; on a configured
  server an anonymous caller still gets a clean 401, and the message is deliberately non-secret.

**Environment limits, recorded so the pass is not over-read.** The sandbox cannot reach Supabase
(`ECONNREFUSED`), so no session exists: `/admin/ai` redirects anonymous callers to `/?auth=signin`
(the gate working), and `/api/admin/ai-observability` answers 429 through the route's existing
`failClosed: true` convention rather than the 401 an unreachable log would otherwise produce.
Playwright's `locator.click()` times out on every element in this browser session — verified on a
plain, unique, visible button — and a coordinate click did not land either, so interactions were
driven by page-context `element.click()`, a real DOM click React handles. `cua.move` works for
hover; `cua.keypress` wants `keys: [...]`, not a string. `<html>` carries `scroll-smooth`, so
`window.scrollTo` animates and Playwright's auto-scroll never reports a stable element; scrolling
instantly first is required before any action.

**F3 — the P1 blocker's blast radius.** The frozen widget gates its own send path behind auth
(`!authLoading && !user` renders "Member Access Only"), so the widget→route incompatibility behind
precondition P1 — the frozen widget posts `{ message, history }` and concatenates raw response
bytes, while the route now emits an SSE UI-message stream — is **not reachable by an anonymous
visitor**: only a signed-in user can reach it. P1 is still real and still blocks Plan 5 T8–T11;
this narrows who it can bite.

**Close.** The harness was removed and the tree restored to its prior state: the ten in-flight
paths still staged, `components/chat/ChatWidget.tsx`'s worktree still equal to its index, `tsc`
exit 0, and the full suite green at 91 files / 1,477 tests.

## 6. Task index

| # | Task | Files | Commit |
| --- | --- | --- | --- |
| 1 | The named eval gate | `package.json`, `.github/workflows/ci.yml`, the two eval tests | `test(ai): give the golden evals their own CI gate` |
| 2 | The request-log read side | `lib/ai/observability/store.ts` + test | `feat(ai): read the request log` |
| 3 | The operator surface | `app/(app)/admin/ai/page.tsx`, `app/api/admin/ai-observability/route.ts`, `components/admin/AiObservabilityReport.tsx`, `components/admin/AdminNav.tsx` + tests | `feat(admin): surface the AI request log` |
| 4 | Surface `report.evicted` | `lib/ai/pipeline/index.ts`, `lib/ai/stream/protocol.ts`, `components/chat/ActivityTrace.tsx` + tests (C19: `assemble.ts` and `app/api/ai-chat/route.ts` needed no change) | `feat(ai): carry evicted evidence to the reader` |
| 5 | Cron wiring and retention | `lib/cron-auth.ts` + test, `lib/ai/observability/store.ts` + test (C26), `app/api/admin/ai-retention/route.ts` + test, `app/api/admin/ingest-corpus/route.ts` + test, `app/api/admin/ai-observability/route.ts`, `app/api/sync/route.ts` + test (C23), `vercel.json` | `feat(admin): wire the AI crons and log retention` |
| 6 | Documentation and the cache decision | `SYSTEM_DOCS.md`, `.env.example` | `docs(ai): document the observability surface` |

---

### Task 1 — The named eval gate

**Files:** `package.json`, `.github/workflows/ci.yml`, `lib/__tests__/retrieval-eval.test.ts`,
`lib/__tests__/pipeline-eval.test.ts`

1. `package.json` gains `"test:eval": "vitest run lib/__tests__/retrieval-eval.test.ts
   lib/__tests__/pipeline-eval.test.ts"`. It is a *narrowing* of `npm run test`, not a replacement:
   the suite still runs both files (constraint 6, D4).
2. Both eval files print their measured value as a single line a CI log shows —
   `retrieval recall@5 0.9833 (59/60) ≥ 0.85` and the pipeline equivalent — and keep the existing
   `expect(...).toBeGreaterThanOrEqual(RECALL_GATE)` assertion unchanged. The print must come from
   the test that already computes the number, never from a second computation.
3. `.github/workflows/ci.yml` gains a step named **"Eval gate (recall)"** running `npm run test:eval`
   after "Test", with a comment naming what it protects (the retrieval and pipeline evals are the
   quality gate; the step exists so their number is visible).
4. A guard test asserts the two eval files are the ones `test:eval` names, so renaming an eval file
   cannot silently leave the CI step running nothing.

**Rule:** the step must not need a database, a network or a secret. It runs with the workflow's
existing placeholder env vars and nothing else.

**Commit:** `test(ai): give the golden evals their own CI gate`
**Delta:** `package.json` + `ci.yml` + 2 eval files, +1 guard test.

---

### Task 2 — The request-log read side

**Files:** `lib/ai/observability/store.ts` (new) + `lib/__tests__/observability-store.test.ts`

1. A port + a Supabase adapter with an **injected structural client** + a policy layer, in the shape
   `lib/ai/feedback/store.ts` already establishes. The port is a faithful view of the table; the
   policy layer owns the bounds.
2. `summary({ sinceMs, untilMs })` answers the operator's questions from one window:
   request count, counts by `outcome`, counts by `degraded_reason` (null as its own bucket),
   counts by `plan_source`, `citations_valid` true/false/null counts, and latency from
   `retrieve_ms` / `ttft_ms` / `total_ms` (count, and the values needed for a p50/p95 — compute the
   percentile in the policy layer from a bounded sample rather than inventing a SQL percentile).
3. `recent({ limit })` returns the newest rows, bounded by a constant, with the fields the operator
   page shows. No unbounded read exists.
4. `feedbackSummary({ sinceMs, untilMs })` joins the quality signal: counts of up/down votes in the
   window, via `ai_message_feedback`. It reads the table directly (a `forMessages` round trip would
   need message ids this surface does not have); the read is bounded by the same window.
5. Every bound is a named constant in this module: the default window, the maximum window, the
   recent-row limit, the percentile sample cap. A caller cannot widen one.
6. A failure throws with the `[ai-observability] <method>: <message>` prefix, matching
   `lib/ai/feedback/store.ts`'s `[ai-feedback]` convention, so a log line names the query that failed.

**Rule:** no test constructs a real Supabase client; the injected fake records the calls so a test
can assert the bounds were applied.

**Commit:** `feat(ai): read the request log`
**Delta:** +1 module, +1 test file, ~14–18 tests.

---

### Task 3 — The operator surface

**Files:** `app/(app)/admin/ai/page.tsx` (new — see C13), `app/api/admin/ai-observability/route.ts`
(new), `components/admin/AiObservabilityReport.tsx` (new — see C16), `components/admin/AdminNav.tsx`
(one entry), plus `app/api/admin/ai-observability/route.test.ts` and
`components/admin/__tests__/ai-observability-report.test.tsx` (see C15)

1. **The route** (`GET /api/admin/ai-observability`) accepts a `since`/`until` window (ISO or epoch
   ms, validated and clamped to the store's maximum) and answers `{ summary, recent, feedback }`.
   Auth is **admin role or `CRON_SECRET`** (D2): `isSameOrigin` → rate limit → either a constant-time
   `Authorization: Bearer` match or a `profiles.role === "admin"` check → 401/403. The secret path
   and the session path return the same shape.
2. **The page** (`/admin/ai`) is a server component: it calls `requireAdmin()` (C14 — not a hand-rolled
   role query), renders the summary (counts, latency, citation rate, feedback split) and the
   recent-rows table, and returns the honest empty state when the log
   is empty — which is the deployed project's real state today, since none of the `20260919*`
   migrations are applied. **A missing table must render as "the log is not available yet", not as a
   crash**: the page catches the store's failure and says so.
3. Nothing on this surface is reachable by a signed-in non-admin, and the page says what it is
   showing in one sentence (the window, and that the numbers come from `ai_request_log`).
4. Reuse `components/ui/card.tsx`, `badge.tsx`, `separator.tsx`. No chart library (D7).

**Rule:** the operator page must not import a client component that fetches; it renders server-side
from the store (D1).

**Commit:** `feat(admin): surface the AI request log`
**Delta:** +1 page, +1 route, +1–2 test files, ~12–16 tests.

---

### Task 4 — Surface `report.evicted`

**Files:** `lib/ai/pipeline/assemble.ts`, `lib/ai/pipeline/index.ts`,
`lib/ai/stream/protocol.ts`, `app/api/ai-chat/route.ts`, `components/chat/ActivityTrace.tsx`, plus
their tests

1. `PipelineResult` gains `evicted: string[]` — the ids `assembleMessages`'s report already names,
   carried out unchanged (D5). Empty array when nothing was evicted, never `null`: "nothing was
   evicted" is a fact, not an absence.
2. `assembleMessages`'s existing report is the only source. No stage recomputes it, and
   `degraded: "evidence_evicted"` keeps its current meaning (a non-empty eviction sets it, as today).
3. `ActivityPart` gains an **optional** `evicted?: string[]`. `PROTOCOL_VERSION` stays `1`: an
   optional field is not a shape change (`protocol.ts`'s own rule), and an older client ignores it
   because it reads only the fields it knows. `buildActivityPart` includes it only when non-empty.
4. `ActivityTrace`'s **expanded** view lists the evicted ids in one line ("3 sources did not fit:
   …"), and the collapsed line is unchanged. An empty list renders nothing.
5. The route sends what the pipeline produced — no re-derivation, no new measurement.

**Rule:** this is a carry, not a feature. If any layer needs a second computation to produce the
list, the design is wrong and the task stops.

**Commit:** `feat(ai): carry evicted evidence to the reader`
**Delta:** 5 modified files, ~8–12 tests.

---

### Task 5 — Cron wiring and retention

**Files:** `lib/cron-auth.ts` (new) + `lib/__tests__/cron-auth.test.ts`,
`app/api/admin/ai-retention/route.ts` (new) + `app/api/admin/ai-retention/route.test.ts`,
`app/api/admin/ingest-corpus/route.ts`, `app/api/sync/route.ts`, `vercel.json`

1. `lib/cron-auth.ts` exports the constant-time `headerMatchesSecret(authorization, secret)` that
   `app/api/sync/route.ts` currently keeps private, plus a `cronSecret()` reader. `sync/route.ts`
   imports it instead of holding its own copy, and its existing tests are the regression proof that
   the extraction changed nothing. The digest comparison is preserved byte for byte: fixed-width
   SHA-256 digests, `crypto.timingSafeEqual`, and never a query-string read (constraint 3).
2. `GET /api/admin/ai-retention` deletes `ai_request_log` rows older than the retention age, in
   bounded batches, and **defaults to `dry_run=true`** — a caller must ask for the delete
   explicitly (`?dry_run=false`), and the response says which mode ran and how many rows it would
   or did remove. Auth is `CRON_SECRET` only; an admin session cannot delete log rows.
   `ai_message_feedback` is not touched (D3).
3. The retention age is a named constant with an env override read at request time
   (`AI_LOG_RETENTION_DAYS`, default 90), documented in `.env.example` by Task 6. An unparseable or
   out-of-range value falls back to the default rather than to zero.
4. `vercel.json` gains the cron entries: the retention sweep, and a corpus refresh. Both are GET-able
   by a cron, both read `CRON_SECRET` from the header, and the schedules are chosen off-peak and
   documented in `SYSTEM_DOCS.md`. **Do not change or remove the two existing `/api/sync` entries.**
5. **`/api/admin/ingest-corpus` is POST-only, and a Vercel cron issues GET** — so the corpus refresh
   needs a GET entry point. Add a `GET` handler to that same route file that reads `CRON_SECRET` and
   calls the same implementation the POST handler uses; do **not** change the POST handler's
   behaviour or its admin path, and do not turn the GET into an unauthenticated alias. The existing
   ingest tests stay green unchanged, and a new test pins that GET requires the secret and that POST
   still works as it did. This is an addition to an existing route, not a rewrite of it.
6. The retention route's own name and shape are the model: a `dry_run` default, a bounded batch, and
   a response that says what ran.

**Rule:** no test executes SQL or hits a route over HTTP. The retention route's tests inject the
store; `cron-auth`'s tests are pure.

**Commit:** `feat(admin): wire the AI crons and log retention`
**Delta:** +1 lib +1 route +2 test files, `sync/route.ts` reduced, `vercel.json` +2 entries.

---

### Task 6 — Documentation and the cache decision

**Files:** `SYSTEM_DOCS.md`, `.env.example`

1. A **"AI observability"** section in `SYSTEM_DOCS.md`: what `ai_request_log` carries (all
   nineteen columns — sixteen from `20260919090000`, plus the three Phase 4 added), what the store's
   queries answer and their bounds (C8's five constants, quoted with their values),
   the operator surface and its two auth paths, the retention policy and its default age, the cron
   entries and their schedules, and the eval gate with the measured numbers and the gate value.
2. `.env.example` gains `AI_LOG_RETENTION_DAYS` (default 90, meaning, and that an invalid value
   falls back to the default), and anything else this phase introduced — each with a comment naming
   its default and its meaning. Existing entries stay.
3. The **cache decision** (D6) recorded plainly: not implemented, why (no measured need; the
   correctness risk of stale and cross-user answers), and the trigger that would reopen it (the log
   showing repeated identical questions inside a short window). State that the log's `cache_hit`
   column **already exists and is always `false`**, so a future cache needs no migration — and that
   nothing in this phase writes it.
4. The migration status restated: `20260919130000` and `20260919140000` are committed and **not
   applied**; the manual verification SQL for both; and that no test executes SQL.
5. State what is **not** covered yet: Plan 5 Tasks 8–11 (the widget, drawer, memory panel, a11y) and
   Plan 5 Task 12 (the chat UI documentation) are pending precondition P1, so the chat surface's own
   documentation is not in this section.
6. No test count change.

**Commit:** `docs(ai): document the observability surface`
**Delta:** documentation only.

---

## 7. Risks recorded while planning

| Risk | Why it is real | Mitigation |
| --- | --- | --- |
| An unbounded log query tables-scans a growing table | `ai_request_log` gains a row per request and has no retention before Task 5 | Every bound is a constant in the store (Task 2); the window and row limit are clamped, never passed through |
| Retention deletes more than intended | A delete against a live table with a wrong age or no bound | `dry_run` default, bounded batches, `CRON_SECRET`-only, a named constant with a validated override, and `ai_message_feedback` explicitly out of scope |
| The operator surface leaks another user's data | The log carries `user_id`, and a non-admin who guesses the URL would read it | Admin-role-or-secret on both surfaces, with the same check `app/api/admin/route.ts` uses; the store is service-role only |
| Extracting `headerMatchesSecret` weakens the cron check | It is the only guard on the sync crons | The comparison is moved byte for byte, not rewritten; `sync/route.ts`'s existing tests are the regression proof |
| The eval gate becomes a second, weaker copy of the assertion | A CI-only check invites removing the in-test gate | The suite keeps its own `expect(...)` (D4); the CI step adds visibility, not the gate |
| Plumbing `report.evicted` drifts from the pipeline's report | Two computations of one fact | The carry is the only path; a task that needs a second computation stops (Task 4's Rule) |
| The admin page crashes where the migrations are not applied | The deployed project has no `ai_request_log` table today | The page catches the store's failure and renders "not available yet" (Task 3) |

## 8. Completion criteria

1. `npm run test:eval` exists, runs exactly the two golden evals, prints both measured numbers, and
   is a named CI step; the full suite still runs both files with their `RECALL_GATE` assertions.
2. `lib/ai/observability/store.ts` answers a summary, a bounded recent list and a feedback summary,
   with every bound a constant, proven by a test that asserts the bounds reached the query.
3. `/api/admin/ai-observability` answers both auth paths with the same shape, clamps the window, and
   rejects a non-admin session and a wrong secret.
4. `/admin/ai` renders the summary and the recent rows for an admin, and the honest empty state where
   the log is absent — never a crash.
5. `report.evicted` reaches the reader: `PipelineResult.evicted`, an optional `ActivityPart.evicted`,
   and the trace's expanded line, with `PROTOCOL_VERSION` still `1`.
6. `/api/admin/ai-retention` defaults to `dry_run`, requires `CRON_SECRET`, deletes only
   `ai_request_log`, and reports what it would do.
7. `lib/cron-auth.ts` holds the only `headerMatchesSecret`, and `sync/route.ts` imports it.
8. `vercel.json` has the two new entries and still has its two `/api/sync` entries unchanged; the
   corpus-refresh entry can actually be called by a cron, which means `/api/admin/ingest-corpus`
   answers GET behind `CRON_SECRET` while its POST path is unchanged.
9. `SYSTEM_DOCS.md` documents the log's columns, the queries and their bounds, the operator surface,
   retention, the crons, the eval gate and the cache decision; `.env.example` names every variable
   this phase added.
10. No migration is added by this phase; `20260919130000` and `20260919140000` are still described
    as committed and not applied.
11. Gates green at every task's close: full suite (both projects), `tsc` exit 0, lint 0 errors,
    build succeeds with the four `/api/ai-chat*` routes.
12. The in-flight workstream is untouched: `ChatWidget.tsx`'s worktree still matches its index, and
    the nine staged files are still staged.

## 9. What remains after this phase

- **Plan 5 Tasks 8–11** — the widget rebuilt on `useChatStream`, the conversation drawer, the memory
  panel, and the accessibility/keyboard/mobile pass. All blocked on precondition P1: the user must
  commit `components/chat/ChatWidget.tsx` before any of them can edit it.
- **Plan 5 Task 12** — the chat UI documentation (transport, view model, citation contract as the UI
  sees it, feedback ownership, the drawer and memory panel, the accessibility properties). It
  documents Tasks 8–11, so it follows them.
- **`AI_PIPELINE=v1`** stays the rollback, unchanged by this phase: the parts the UI receives change
  with it, and the UI needs no switch of its own.
