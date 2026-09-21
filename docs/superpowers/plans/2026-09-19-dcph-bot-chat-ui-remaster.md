# Plan 5 — Chat UI/UX remaster (Phase 5)

**Spec:** `docs/superpowers/specs/2026-09-19-dcph-bot-agentic-remaster-design.md` §12, Phase 5 —
"AI SDK transport, parts rendering, citations, activity, regenerate/stop/edit, feedback,
conversation drawer, memory panel, accessibility. Add a jsdom environment for component tests."

**Depends on:** Plan 1 (gateway), Plan 2 (corpus and retrieval), Plan 3 (transcripts and memory),
Plan 4 (agentic pipeline). Plan 4's §9 lists exactly what this phase consumes.

**Status:** planned, not started. Written 2026-09-20, after Plan 4's completion report.

---

## 1. What ships

The chat surface stops being a plain-text stream rendered into a bubble and becomes a *rendered
answer*: numbered citations that resolve against the evidence the server actually supplied, an
activity trace that shows what the pipeline did, sources a reader can open, stop/regenerate/edit,
thumbs feedback, a conversation drawer, a memory panel with delete, and a keyboard-and-screen-reader
path through all of it. The transport moves to the AI SDK's UI message stream so parts — not one
string — cross the wire, with Plan 1's gateway still the only model path.

Nothing in Phases 1–4 changes behaviour: the pipeline, its budgets, the screening, the citation
validator and the `AI_PIPELINE` rollback all stay. Phase 5 is a *rendering* phase with one new
storage table (feedback), one new route (feedback), and a wire-format change that both sides of the
deploy adopt together.

## 2. Global constraints

1. **Free tiers only, still.** `ai` and `@ai-sdk/react` are MIT libraries; they cost nothing and
   they talk to no provider. No `@ai-sdk/*` provider package, no second gateway, no new provider
   call. Total model calls per turn are unchanged from Plan 4's accounting.
2. **Plan 1's gateway stays the model path.** `streamChat`, the quota accounting, the circuit
   breaker, `generateStructured` and its repair ladder are untouched. The AI SDK frames the stream
   and drives the client hook; it never talks to a model.
3. **Always a whole answer.** Every failure mode still ends in text a reader can act on: the three
   synthetic strings (rate-limited, empty result, partial) keep their meaning on the new transport,
   and a stream that dies mid-answer keeps what arrived.
4. **The `[E#]` mapping is a contract, not a parsing job.** The client renders chips from the
   `EvidenceRef[]` the server sends. It must never regex the answer text — Plan 4 built the numbering
   so the two cannot drift, and the test suite pins it.
5. **`AI_PIPELINE=v1` keeps working and keeps its proof.** The route's v1 branch emits the same UI
   stream with only a text part; the UI renders that degraded shape without evidence, activity or
   chips. `app/api/ai-chat/route.integration.test.ts` stays the standing v1 regression test.
6. **Migrations are additive only.** The one new migration adds a table. No `drop`, no destructive
   `alter`, no policy or grant statement (RLS on, no policies, `service_role` only — the Plan 3
   pattern).
7. **Ownership is checked server-side on every transcript and memory read or write.** A conversation
   id from the client is a *claim*: the route resolves it against the signed-in user before a row is
   read, written or deleted, exactly as Plan 3 established.
8. **Never log a full API key; log a target id only.** Unchanged from Phases 1–4 and restated here
   because the activity UI is new surface for provider state.
9. **`NEXT_PUBLIC_*` ships to the browser.** The activity trace renders `planSource`, `toolNames` and
   timings — all non-secret — and nothing else. No provider names, no key material, no raw errors.
10. **Tests never touch a network, a database, a model or a real timer.** The jsdom project mocks
    `fetch`; component tests drive the transport with a scripted stream.
11. **The in-flight workstream is not swept.** `components/chat/ChatWidget.tsx` currently carries the
    user's uncommitted edits (with nine other files). *Precondition P1:* that file must be committed
    (or the plan rebased onto it) before any task below edits it. Tasks 1–7 do not touch it; Tasks
    8–11 do. Until P1 is satisfied, execute Tasks 1–7.
12. **No new design system.** Reuse `components/ui/*` (Radix wrappers, `cva`), the Tailwind tokens
    and `framer-motion`. No new colour palette, no new font.
13. **Motion respects `prefers-reduced-motion`.** Every animation has a reduced-motion branch.
14. **Git discipline.** `git add -- <paths>` then `git commit --only -m "..." -- <paths>`. Never
    `git add -A`, never `git commit -a`, never `--amend`.
15. **Style.** No semicolons, double quotes, 2-space indent.

## 3. Baseline at the start of this plan

Verified at Plan 4's completion (`2a8f05a`):

- **Tests:** 1,176 / 73 files committed; 1,194 / 75 in the working tree (the difference is the
  untracked `lib/__tests__/characters-graph-engine.test.ts` of another workstream, 7 tests).
- **Gates:** `npx tsc --noEmit` exit 0; `npm run lint` 0 errors / 14 pre-existing warnings;
  `npm run build` succeeds with `ƒ /api/ai-chat`, `ƒ /api/ai-chat/conversations`,
  `ƒ /api/ai-chat/memory`.
- **Evals:** retrieval 0.9833 (59/60) and pipeline-level 1.0000 (60/60), both ≥ `RECALL_GATE` 0.85.
- **The wire format is plain text** (`text/plain` stream) — Phase 4 kept it byte-compatible to this
  moment (its constraint 9).
- **The chat components:** `components/chat/ChatWidget.tsx` (13.5 KB, in flight),
  `ChatMessage.tsx`, `ChatInput.tsx`, `ChatWidgetLoader.tsx`. The widget streams with
  `response.body.getReader()` and a `TextDecoder`.
- **The test environment** is `node` only, with `include: ["**/*.test.ts"]` — no `.tsx`, no jsdom
  (`vitest.config.mts`).
- **Server contracts available to the UI** (Plan 4 §9): `PipelineResult.evidence` (`EvidenceRef[]`),
  `PipelineResult.screening`, `PipelineResult.timings` / `planSource` / `toolNames`,
  `PipelineResult.degraded`; `lib/ai/citations.ts`'s grammar and report; `assembleMessages`'s
  `report.evicted` (Phase 6's).
- **Plan 3's endpoints:** `GET`/`DELETE /api/ai-chat/conversations`, `GET`/`DELETE
  /api/ai-chat/memory`.

## 4. Architecture of the new path

```text
POST /api/ai-chat                                   app/api/ai-chat/route.ts
  guards → auth → rate limit → intent refusal → persistence → pipeline → refusal gate
  → createUIMessageStream                                lib/ai/stream/protocol.ts
        data-evidence   { refs: EvidenceRef[] }          plan 4's numbering, verbatim
        data-activity   { planSource, tools, timings }   non-secret only
        data-degraded   { reasons: string[] }            plan 4's degrade vocabulary
        text-delta      the answer, as Plan 1 streams it
        data-citations  { report: CitationReport }       after the stream (D3)
  → createUIMessageStreamResponse()

client                                              components/chat/
  useChatStream (useChat + view-model mapping)        useChatStream.ts
    ├─ ChatMessage      text + CitationChips + SourcesPanel
    ├─ ActivityTrace    stage timeline, degrade badges
    ├─ FeedbackControls POST /api/ai-chat/feedback
    ├─ ConversationDrawer  GET/DELETE /api/ai-chat/conversations
    └─ MemoryPanel         GET/DELETE /api/ai-chat/memory
```

Three properties this shape exists to keep:

1. **One stream, two audiences.** The text deltas a reader sees and the data parts the UI needs
   travel in the same response, so there is no second request, no polling, and no client-side
   parsing of prose.
2. **The server decides, the client renders.** Every fact the UI shows is a part the server chose to
   send: evidence, activity, degrade reasons, the citation report. A part the server did not send is
   not shown, so a v1 turn renders as a v1 turn.
3. **The reduced-motion and keyboard paths are structure, not polish.** The trace and the chips are
   ordinary semantic HTML with `aria` attributes; motion is decoration over working markup.

## 5. Deviations and decisions taken here

**D1 — The AI SDK frames; Plan 1's gateway answers.** `ai`'s `createUIMessageStream` /
`createUIMessageStreamResponse` (server) and `@ai-sdk/react`'s `useChat` (client) are used for framing
and transport only. The model call stays `streamChat` from `lib/ai/gateway.ts`, so quota accounting,
the breaker and the repair ladder keep working exactly as Phases 1–4 built them. The alternative —
adopting a provider package and letting the SDK drive the model call — would create a second path to
a provider that bypasses the daily budget: rejected on the free-tier constraint.

**D2 — Parts, not a custom protocol.** The data parts are the minimum the UI needs
(`evidence`, `activity`, `degraded`, `citations`) with the SDK's own `text` part carrying the answer.
A bespoke SSE dialect was the alternative; it would be a second protocol to maintain, and the spec
names the SDK's transport outright.

**D3 — Feedback is its own table.** A vote is (message, user, value, when, optional note) — a
many-per-message fact with its own ownership rule, not a column on `ai_messages` that a later
`update` could overwrite. One additive migration creates `ai_message_feedback`; the route checks
ownership against the conversation, and the row is written with the service-role client.

**D4 — jsdom is a second vitest project, not a global change.** `lib/**` and `app/**` tests keep
`environment: "node"` (with the `server-only` stub), and `components/**` tests run under jsdom with
a setup file. Making the whole suite jsdom would slow every existing test and put React's DOM in the
way of modules that must not have it.

**D5 — The three synthetic strings render as ordinary text with a state badge.** They are already
honest sentences; the remaster shows *which* state produced them (rate-limited, no result, partial)
as a badge beside the message rather than a new message shape. Their text is unchanged — the tests
that pin them stay green.

**D6 — No `?format=text` escape hatch.** The client and the route deploy together, and the SDK's
stream is the only format either side speaks. Keeping a second format alive would be a second code
path to test forever. `AI_PIPELINE=v1` is the rollback that matters, and it changes the *pipeline*,
not the transport.

**D7 — Edit resends, it does not fork.** Editing a user turn truncates the visible transcript from
that point and resends; the server already owns the transcript (Plan 3), so the fork/rollback
semantics of a client-owned history do not apply. Streaming is aborted first (the stop path).

**D8 — The activity trace is opt-in per deployment by default-on.** It is rendered collapsed: a
one-line "3 steps · 1.2 s · searched the catalog" summary that expands. The spec asks for activity;
a reader who does not care should not have to scroll past it.

**D9 — Precondition P1 is a hard gate for the UI tasks.** `ChatWidget.tsx` carries the user's
uncommitted work. Tasks 1–7 leave it alone; Tasks 8–11 may not begin until the user's edits are
committed, because "remaster the widget" and "preserve someone's uncommitted edits to the widget"
cannot both be true of the same commit.

### C1–C6 — corrections found while executing this plan

Recorded as each task completed, in the Plan 4 pattern. A correction here overrides the task text
above it.

**C1 — The SDK's response helper is `createUIMessageStreamResponse`, not
`toUIMessageStreamResponse`.** `ai@7.0.107` exports the former and not the latter; §4's diagram and
D1 have been corrected in place (commit `3ebf538`). The server side is
`createUIMessageStream({ execute })` → `createUIMessageStreamResponse({ stream, headers })`.

**C2 — Task 2's file list is incomplete: `route.memory.test.ts` is a third route test.** It reads
the streamed body as the answer, so the transport change breaks ten of its seventeen tests, while
the task also requires the whole suite to pass. Adapted (test-only, mechanical, meaning-preserving)
and committed with Task 2 as a sixth path. The in-flight workstream's ten files are untouched and
still staged.

**C3 — `PipelineResult.degraded` has eight values, not four.** Task 2's brief said "the four
`PipelineResult` reasons"; the field can carry `pipeline_failed`, `corpus_unavailable`,
`execute_budget`, `ladder_failed`, `tool_failed`, `retrieval_budget`, `evidence_evicted` and
`corpus_static`. `lib/ai/stream/protocol.ts` exports all eight, plus the three route reasons and the
three synthetic tokens — `DEGRADED_REASONS` is fourteen strings, and it is the vocabulary Task 6's
wording table is checked against and Phase 6's queries filter on.

**C4 — The stated part order cannot hold: `degraded` is sent up to twice.** `uncited` is a verdict
on the finished answer and a synthetic token is a verdict on how the stream ended, so both are known
only after the text. The order is `activity → evidence → [degraded] → text → [degraded] →
[citations]`. Task 4 must merge reasons across **all** `data-degraded` parts rather than taking the
first, and must not assume the part precedes the text it describes.

**C5 — A synthetic state displaces `uncited` rather than joining it.** With evidence supplied and no
answer, `validateCitations` reports `uncited: true` on the empty accumulator, so the naive union
badged a rate-limited turn as an uncited one. `lateDegradedReasons` now returns the synthetic token
alone when there is one (commit `1c9c630`); the log is unaffected, because its `outcome` column
already names that state. Task 6's wording table needs no suppression rule of its own.

**C6 — `readUIMessageStream` does not take the SSE response body.** It takes a
`ReadableStream<UIMessageChunk>`; the bytes go through
`parseJsonEventStream({ stream, schema: uiMessageChunkSchema })` first (all three exported from
`ai`). The route tests' `readStream` helper does the full chain, and Tasks 4–7 should reuse that
shape rather than re-derive it.

**Verified at Task 2's close** (`c10f78f` + `1c9c630`): 77 files / 1,219 tests (node 76/1,218,
dom 1/1); `tsc` exit 0; lint 0 errors / 14 pre-existing warnings; build succeeds with the three
`/api/ai-chat*` route bundles emitted. `lib/ai/stream/protocol.ts` bundles for `platform=browser`
with zero `import`/`require` statements, so Tasks 4–7 may import it from `components/**`.

**C7 — Task 3's commit message was executed as `feat(ai): store per-message feedback`**, not §6's
`feat(chat): record answer feedback`; the §6 line has been corrected to what history holds. Task 3's
work is the store, the table and the route — none of it is chat UI — so the `ai` scope is the honest
one, and Tasks 4–7 take the `chat` scope for the rendering work.

**C8 — Task 3 item 3 undercounts the route's answers.** It lists 404/400/401; the route also needs
the non-assistant **400** (you do not rate your own question, and the caller does own that message,
so it is not a 404) and the missing-service-role **500** that every route in this repo answers with
when `createAdminClient()` returns null. Both are implemented and tested. The plan's own constraint 6
implies the 500 but item 3 never says so.

**C9 — `lib/ai/feedback/store.ts` is one file where `lib/ai/memory` uses three.** Task 3's file list
names a single file, so the port interface, the Supabase adapter and the policy layer all live in
`store.ts`. No behavioural difference; noted because a reader looking for `feedback/port.ts` will
not find one.

**C10 — `forMessages(ids)` is deliberately not user-scoped.** Phase 6's reporting is a service-role
read across users, so the port reads by message-id set only, and an empty set short-circuits in both
the port and the store without a round trip. A per-user breakdown must join `user_id`, which every
vote row carries.

**C11 — `ai_messages.feedback` and `feedback_note` already exist and are dead.** They were added by
`20260919110000_ai_memory.sql` and nothing reads or writes them; only
`lib/__tests__/ai-memory-migration.test.ts` pins their presence. D3 chose a separate table for the
reasons it gives, and the new migration's header records that the old columns are left in place,
unread and unwritten, because migrations are additive only.

**Verified at Task 3's close** (`498b74e`): 80 files / 1,251 tests (node 79/1,250, dom 1/1);
`tsc` exit 0; lint 0 errors / 14 warnings; build succeeds with the four `/api/ai-chat*` route
bundles emitted, including the new `feedback`. The migration is committed and **not applied**
anywhere; no test executes SQL.

**C12 — Task 4's signature has no transport test seam.** The task's own Rule says a test drives the
hook with a scripted stream, but `useChatStream({ conversationId })` gives a test nowhere to put
one. The hook takes an optional `transport?: ChatTransport<UIMessage>`, documented as a test seam;
production callers still pass only `conversationId`.

**C13 — Task 4 item 4 is not implementable as written.** `ai@7.0.107`'s `ChatInit` has no response
or fetch callback, so `X-Conversation-Id` can only be read by wrapping `DefaultChatTransport`'s
`fetch` option. The wrapper returns the response unchanged so the transport still parses the SSE
body. The hook also holds no top-level `api` option to pass: in this version the URL lives on the
transport.

**C14 — Task 4 item 3's five endings are not disjoint.** Every synthetic token is also a member of
`DEGRADED_REASONS`, so "ended in a synthetic string" and "ended with a degrade" overlap by
construction. `MessageState` is a precedence — streaming > stopped > synthetic > degraded >
complete — not a partition, and `degraded` still carries every merged reason so a renderer may badge
from it directly.

**C15 — Task 4 item 1's field list omits `id` and `role`.** Without `id`, Task 8 cannot call
`editAndResend`; without `role`, Task 7 cannot render a turn. Both are on `ChatMessageView`.

**C16 — Task 4 does not define the absent-`activity` case.** The protocol version travels only in
the activity part, so its absence is ambiguous. The rule: an activity part carrying a version the
client does not know means the whole turn renders as text alone; **no** activity part at all is not
a version claim, so shape-valid data parts are accepted (the `protocol.ts` guards remain the safety
net). This keeps a hand-built or partial stream testable without inventing a version.

**Verified at Task 4's close** (`7d95757`): 81 files / 1,276 tests (node 79/1,250, dom 2/26);
`tsc` exit 0; lint 0 errors / 14 warnings; build succeeds with the four `/api/ai-chat*` bundles, and
`/community/chat`'s first load is unchanged at 110 kB because nothing imports the hook yet.

**C17 — Task 1's `matchMedia` stub did not answer framer-motion.** The stub matched only
`"(prefers-reduced-motion: reduce)"` by equality, but framer-motion's `useReducedMotion()` asks the
boolean form `"(prefers-reduced-motion)"` (verified in
`node_modules/framer-motion/dist/es/utils/reduced-motion/index.mjs`). So framer-motion saw *no*
preference under jsdom and every reduced-motion assertion would have tested the animated branch
while looking green — including all of Task 11's. Fixed in `cc082a7`: the stub now matches any query
naming `prefers-reduced-motion` that is not `no-preference`, and Task 5's local workaround was
removed with it. The framer-motion dev warning now fires in the dom project, which is the visible
proof the hook reads `reduce`.

**C18 — Task 6 item 1's "summed" duration double-counts the plan stage.** The pipeline measures
`retrieveMs` over a window that *contains* the planner (`lib/ai/pipeline/index.ts`'s
`retrieveStartedAt` block: "resolve + plan + execute: `retrieveMs` covers all three"), so
`planMs + retrieveMs + assembleMs` reports a duration longer than the request took. `totalActivityMs`
now takes the wider window (`retrieveMs ?? planMs`) plus `assembleMs` and never adds the two
(commit `70ffdfe`); the expanded list labels the stage "Retrieve (includes plan)" so the containment
is visible to the reader, and `planMs` remains a breakdown rather than a sibling. The server's
`PipelineTimings` shape is unchanged — the fix is in the renderer, and the containment is now
documented on both sides.

**C19 — Task 6 item 2's reason list is stale: it names 11 and omits the three synthetic tokens.** The
authority is `DEGRADED_REASONS` (14). The wording table is typed
`Record<DegradedReason, string>`, so adding a 15th reason to the vocabulary fails `tsc` until it is
worded, and the test iterates the imported constant rather than a hand-written list.

**C20 — `activity === null` also means no degrade badges, and that is safe.** The view model clears
`degraded` whenever it discards an unknown-version activity part, and v1 always writes an activity
part (the route writes it unconditionally), so the only activity-null turns carry no reasons either.
Recorded so a later reader does not think a degrade can be silently dropped.

**C21 — Task 6 item 4's "name that says what it does" needs more than the summary.** The trace's
toggle is a `button` whose accessible name is the visible summary plus an `sr-only`
"Show details"/"Hide details", so it says both what happened and what the control does.

**C22 — Item 5's banned tier variants leave one variant for degrade badges.** Task 5 uses
`default`/`secondary`/`gold` for `[RET]`/`[WIKI]`/`[CONV]`, so every degrade badge is `outline`,
known and unknown alike; the wording, not the tone, is what distinguishes them. A second tone would
need a palette change, which constraint 12 forbids.

**C23 — Task 7 must be strictly additive to `ChatMessage.tsx`, and the plan's Task 7 file list
misses the feedback controls' home.** `ChatMessage` is imported by `ChatWidget.tsx`
(`{ message: ChatMessageData, isStreaming }`) and that file is frozen until the user commits, so
changing `ChatMessage`'s props would break the build. The parts rendering therefore layers onto the
existing component as optional props, and today's caller renders byte-identically. §4's architecture
diagram already lists `FeedbackControls` under `components/chat/`, so it gets its own file even
though §6's Task 7 line names only `ChatMessage.tsx`.

**C24 — Task 7 and Task 6 would both badge a synthetic ending.** `degraded` carries the synthetic
tokens and `ActivityTrace` renders a badge per reason, so a rate-limited turn would show "the bot was
rate-limited" from the trace *and* Task 7's D5 state badge. Task 7 owns the D5 badge and filters
`SYNTHETIC_STATE_REASONS` out of the `degraded` list it hands the trace, so each state is said once.

**Verified at Tasks 5 and 6's close** (`8d2ece4`, `cc082a7`, `d03bd6d`, `70ffdfe`): 83 files /
1,325 tests (node 79/1,250, dom 4/75); `tsc` exit 0; lint 0 errors / 14 warnings; build succeeds with
the four `/api/ai-chat*` bundles and `/community/chat` unchanged at 110 kB.

**C25 — Task 7 item 1's "CitationChips when refs exist" is imprecise.** `CitationChips` returns
`null` without a `CitationReport`, so refs alone render no chips. `ChatMessage` keys both the chips
and its parts guard off `citations !== null`. A refs-without-report turn is still fully described by
the trace and the panel.

**C26 — Task 7 item 1 never defines the `stopped` case for feedback.** `MessageState` is a precedence
(C14), not a partition, so "complete" does not name every non-streaming ending. The rule:
feedback is offered for `complete`, `degraded` and `synthetic` endings; a `stopped` turn is a partial
the reader chose to end and offers none. Both cases are pinned by tests.

**C27 — Task 7's delta of "~12 tests" undercounts**; the task's own required coverage exceeds it and
the file has 20.

**C28 — The gate's "unless the widget now imports something new" can never trigger.**
`ChatWidget` is never in a route's first-load JS: `components/chat/ChatWidgetLoader.tsx` imports it
dynamically with `ssr: false` from `app/layout.tsx`, so `ChatMessage`'s four new static imports land
in the lazy widget chunk. `/community/chat`'s first load stays 110 kB and cannot observe them; a
change there would be a different regression.

**Verified at Task 7's close** (`5146632`) — **Tasks 1–7 complete**: 84 files / 1,345 tests (node
79/1,250, dom 5/95); `tsc` exit 0 (the C23 proof — `ChatWidget.tsx` was not edited, and its worktree
still matches the index); lint 0 errors / 14 warnings; build succeeds with the four `/api/ai-chat*`
bundles. The only removals in `ChatMessage.tsx` are the old non-exported props interface and the old
function body, whose classNames moved into shared constants unchanged — so the legacy caller renders
byte-identically, asserted by a test that pins the exact className strings.

**C29 — Task 9 item 2's "undo affordance" cannot be built, and the task's own file list says why.**
The route it names, `app/api/ai-chat/conversations/route.ts`, exports only `GET` and `DELETE`, and the
`DELETE` sets `archived_at` rather than removing the row (D4). Nothing in the API clears that column,
so a "restore" button would promise a write that does not exist. The repo also has no toast system
(no sonner, no `useToast`, nothing under `components/ui/`), so item 2's "a toast, not a modal, unless
the repo's convention says otherwise" resolves to no convention to match. `ConversationDrawer.tsx`
therefore guards a mis-tap with an inline confirmation in the row — before the request — and
optimistic removal with rollback on failure after it. The missing undo is stated in the component's
own header comment so a later reader does not add one. Adding a real undo would need a `PATCH`
clearing `archived_at`; that is a route change nobody has asked for, and it is not in this plan.

**C30 — Task 10 items 2 and 3 are both wrong about the memory endpoint.** Item 2 claims a "clear all"
is among "both shapes the route already supports": it is not. `app/api/ai-chat/memory/route.ts`'s
`DELETE` accepts exactly one shape, `?id=<uuid>`, and rejects anything else with a 400; the
`MemoryStore` interface it delegates to exposes `list`, `loadActive`, `countActive` and `delete` and no
bulk method. So the panel deletes one fact at a time and the "clear all" is dropped. Item 3 claims the
endpoint's answer can be "rendered as the honest empty state (memory is disabled for this
deployment)": it cannot, and deliberately so — the route's own header comment says `AI_MEMORY` is not
consulted because "D6 stops extraction and injection, not transparency", and `route.test.ts` pins that
behaviour in two named tests ("lists facts even when AI_MEMORY is off", "still deletes when AI_MEMORY
is off"). An off switch therefore produces the *same* `200 { facts, cap }` an on switch produces, and
no client can tell the two apart from that response alone. Completion criterion 7 nevertheless
requires "the disabled-memory empty state", so item 3 is implemented by **adding the signal rather
than dropping the requirement**: the `GET` response gains `memoryEnabled: boolean`, read from the
`isMemoryEnabled()` helper `lib/chat/persistence.ts` already exports and tests, which is additive,
touches no schema, and keeps D6 intact — it reports the switch, it does not consult it. The panel
treats a missing field as unknown and makes no claim, so it stays honest against an older response.

## 6. Task index

| # | Task | Files | Commit |
| --- | --- | --- | --- |
| 1 | Dependencies, jsdom project, smoke test | `package.json`, `vitest.config.mts`, `vitest.setup.dom.ts`, `components/chat/__tests__/smoke.test.tsx` | `test(ui): add a jsdom project for component tests` |
| 2 | The UI message stream and its parts | `lib/ai/stream/protocol.ts` + test, `app/api/ai-chat/route.ts`, route tests (additive) | `feat(ai): stream the answer as message parts` |
| 3 | Feedback: table, store, route | migration, `lib/ai/feedback/store.ts` + test, `app/api/ai-chat/feedback/route.ts` + test, migration test | `feat(ai): store per-message feedback` |
| 4 | The client transport and view model | `components/chat/useChatStream.ts` + test | `feat(chat): read the stream as parts` |
| 5 | Citation chips and the sources panel | `CitationChips.tsx`, `SourcesPanel.tsx` + tests | `feat(chat): render citations against the evidence` |
| 6 | Activity trace and degrade badges | `ActivityTrace.tsx` + test | `feat(chat): show what the pipeline did` |
| 7 | Message parts rendering | `ChatMessage.tsx` + test | `feat(chat): render an answer as parts` |
| 8 | Send, stop, regenerate, edit | `ChatWidget.tsx`, `ChatInput.tsx` + tests (**P1**) | `feat(chat): stop, regenerate and edit a turn` |
| 9 | Conversation drawer | `ConversationDrawer.tsx` + test, wiring (**P1**) | `feat(chat): list and reopen conversations` |
| 10 | Memory panel | `MemoryPanel.tsx` + test, wiring (**P1**) | `feat(chat): show and delete a memory` |
| 11 | Accessibility, keyboard and mobile | the chat components + tests (**P1**) | `feat(chat): keyboard and screen-reader paths` |
| 12 | Documentation and phase verification | `SYSTEM_DOCS.md`, `.env.example` | `docs(chat): document the remastered surface` |

**Execution status.** Every task whose work lies outside the frozen `ChatWidget.tsx` has shipped, and each
was verified independently before its commit (scope check, the diff read, `npx tsc --noEmit`, the full
suite). Tasks 8–12 as written each bundle one frozen-file requirement, which C31 and C32 name.

| Task | Shipped | Commit |
| --- | --- | --- |
| 8 | Escape stops a streaming answer in `ChatInput.tsx` | `6a3ba04` |
| 9 | `ConversationDrawer.tsx` + 14 tests | `c86781b` |
| 10 | `memoryEnabled` on `GET /api/ai-chat/memory` + test | `5712989` |
| 10 | `MemoryPanel.tsx` + 14 tests | `9ae7606` |
| 11 | `a11y.test.tsx` + 13 tests, and the focus-restore fix it found | `bf6c5ea` |
| 11 | `responsive.test.tsx` + 11 tests, sheet sizing and touch targets | `4ec7126` |
| 12 | The Chat UI section and `.env.example` | `eb9a489` |

The remainder shipped once P1 was satisfied — the repo owner committed `ChatWidget.tsx` with the
`lib/character-chrome.ts` it imports, as one commit, so the tree stayed buildable (`f2dd4cd`). Each of the
four following commits was verified independently before it landed: scope check, the diff read,
`npx tsc --noEmit`, the full suite, and `npx eslint` on the changed files.

| Task | Shipped | Commit |
| --- | --- | --- |
| 8 | `ChatWidget.tsx` rebuilt on `useChatStream` + 18 tests; the first Escape conflict fixed (C39) | `14edc54` |
| 9 | The drawer wired in, and `loadConversation` added to the hook to receive a selection (C38) | `297f80c` |
| 10 | The memory panel wired in | `e491569` |
| 11 | The live-region transition, the regenerate path and the composer's viewport placement (C31, C32, C40) | `f4607eb` |

The drawer and the memory panel are reachable from the UI as of `297f80c` and `e491569`; nothing in this
plan is outstanding. The browser acceptance pass that closes it is recorded in C39 and C40.

Two product defects were found by writing the tests, not by reading the code, and both are fixed:
Radix restores focus only to a `DialogTrigger`, so closing any of these panels left focus on `<body>`
(`bf6c5ea`); and the `DialogContent` centring pair `top-[50%]` / `translate-y-[-50%]` does not cancel for
a full-height element, because `top` resolves against the containing block while `translateY` resolves
against the element's own height — a sheet relying on the coincidence would sit off the top edge
(`4ec7126`).

**C31 — Task 11 item 1's live region is inside the frozen file, so item 1 is gated.** The message
container's `aria-live="polite"` / `aria-atomic="false"` lives in `components/chat/ChatWidget.tsx`
(around line 331), not in `ChatMessage.tsx`, and no component the task's file list names as editable
carries it. It also does not switch to `off` or `role="log"` when a turn completes. The attribute
transition is therefore part of the pending widget rebuild. Recorded so it is not mistaken for shipped
work: the a11y tests assert the keyboard, focus and reduced-motion properties that *do* ship, and say
nothing about the live region.

**C32 — Task 11 items 2 and 5 each carry one requirement that is also inside the frozen file.** Item 2's
keyboard list includes "regenerate", which is a widget control; item 5's "the composer stays above the
keyboard" is the panel's `fixed bottom-5 right-5` placement, also the widget's. `responsive.test.tsx`
asserts only what the editable components own — that `ChatInput`'s form carries no `fixed`, `absolute` or
`sticky` token, so the composer does not position itself — and labels that as the ownership boundary
rather than as evidence that the composer clears a soft keyboard. The claim is deliberately not made.

**C33 — Task 12's brief filed the null-versus-empty wordings under the wrong surface.** `none` and
`not recorded` are `formatTools` and `unmeasured` is `formatCitations`, both in
`components/admin/AiObservabilityReport.tsx`. The chat view model has no such wording: `ActivityTrace`'s
`activitySummary` renders "no steps" for an empty tool list, and `ChatMessage` renders no tools line at
all. C37 already attributed these to Observability (Plan 6 T3) correctly; the error was in the Task 12
dispatch brief, and the documentation states the real location rather than repeating it. This is the
second time a claim about these wordings has drifted toward the chat surface, which is why the Chat UI
section now names the admin file explicitly.

**C34 — "`toUIMessageStreamResponse` does not exist" is too strong, and the precise version matters.**
It exists as a deprecated method on a `streamText` result; it is absent from `ai`'s standalone exports,
which is the fact that matters here — `createUIMessageStreamResponse` is the standalone export
`app/api/ai-chat/route.ts` uses. The documentation carries the precise form, so a reader looking for the
name is not told it is nowhere.

**C35 — two files were touched that no task's file list names, both deliberately.** The first is
`components/ui/dialog.tsx`, whose close control had a 16 px hit area — under the 24 px minimum of
WCAG 2.2 SC 2.5.8 — on a control every dialog in the app renders. Task 11 item 6 asks for touch targets
and this is the most-tapped one in a panel, so it was raised to 24 px with `p-1` and the offsets dropped
to `3`, which leaves the glyph's position and the control's visual weight unchanged. The edit is confined
to the close button; `DialogContent`'s layout classes, `DialogOverlay`, header, footer, title and
description are untouched, so no other dialog's layout moves. The second is `lib/ai/memory/flag.ts`
plus the re-export in `lib/chat/persistence.ts`, which is C30's signal: Task 10's file list named only
the panel, and completion criterion 7 requires a disabled-memory state the endpoint could not express, so
the flag moved to an import-free module the transparency route can read without the provider graph.
Both are recorded here because criterion 12 asks for every deviation, and a silent edit to a shared
primitive is exactly the kind a later reader would not expect.

**C38 — Task 9 item 1 was unimplementable as written: the hook had no way to replace the transcript.**
The item says that selecting a conversation in the drawer "replaces the in-place transcript". It could
not: `useChatStream` owns `messages` and exposes only `send`, `stop`, `regenerate` and `editAndResend`,
so the rows the drawer loads had nowhere to go. The capability was added rather than worked around —
`loadConversation(id, messages)` on the hook's return, and `transcriptToUIMessages` to map the route's
`{ id, role, content }` rows to `UIMessage[]`. `loadConversation` also adopts the conversation id, so the
next turn appends to the reopened conversation instead of opening a new one, which is the whole point of
reopening it. This is why Task 9's delta is a hook change and a widget change, not the drawer alone.

**C39 — two Escape conflicts, both real product defects, both found only by wiring the overlays in.**
The widget listens for Escape on `window` to close the panel. (a) While an answer was streaming, that
listener and the one `ChatInput` installed (`6a3ba04`) both fired on one keypress, so Escape stopped the
answer *and* closed the panel. Fixed with a `streamingRef` the panel's listener reads: Escape during a
stream belongs to the stream. (b) Radix's dismissable layer calls `preventDefault()` but never
`stopPropagation()`, so the same window listener fired underneath an open drawer or memory panel and
closed the panel beneath the overlay. Fixed by gating that listener on `!overlayOpen`. Both fixes were
mutation-tested — removing either guard fails exactly the tests that pin it and no others. Verified in a
browser at 360×740: with the drawer open the first Escape closes only the drawer (the panel stays, the
launcher still reads "Close DCPH Bot") and the second closes the panel; the same holds for the memory
panel; and Escape during a stream stops the stream, leaves the panel open, restores `role="log"` and
offers "Regenerate".

**C40 — `100vh` became `100dvh` in the widget panel, and `60vh` became `60dvh` in the two overlays.**
`app/layout.tsx` sets `interactiveWidget: "resizes-content"`, which is the mechanism that keeps a
bottom-anchored composer above the on-screen keyboard: the layout viewport shrinks rather than scrolling.
`vh` does not follow that shrink, so the panel could compute a height taller than the visible area and
push the composer off it. `dvh` tracks the dynamic viewport, so the claim no longer rests on the meta tag
alone. Measured in a browser at 360×320: the panel computes `min(34rem, 100dvh - 6rem)` = 224 px — the
`dvh` branch, not the `34rem` cap — its bottom sits 20 px above the viewport bottom, the composer stays
inside it and in view, and the transcript area genuinely overflows (client 76 px against scroll 324 px)
where at 360×740 it does not.

---

### Task 1 — Dependencies, jsdom project, smoke test

**Files:** `package.json`, `vitest.config.mts`, `vitest.setup.dom.ts` (new),
`components/chat/__tests__/smoke.test.tsx` (new)

1. Add the dev dependencies the component tests need — `jsdom`, `@testing-library/react`,
   `@testing-library/dom`, `@testing-library/user-event`, and whatever the JSX transform requires
   for vitest to compile `.tsx` — and the two runtime libraries the transport uses: `ai` and
   `@ai-sdk/react`. Pin nothing exotic; use the latest versions the lockfile resolves, and commit
   `package-lock.json` in the same commit.
2. **Only `components/**` becomes jsdom.** `vitest.config.mts` gains a second project (`test.projects`
   in vitest 3) or an equivalent split: the existing node project keeps `**/*.test.ts` with the
   `server-only` stub, and a new project owns `components/**/*.test.tsx` (and `.ts` tests under
   `components/`) with `environment: "jsdom"`, a setup file, and the same `@/` alias.
3. `vitest.setup.dom.ts` — `@testing-library/jest-dom` matchers if added, `afterEach(cleanup)`, and
   deterministic stubs for what jsdom lacks and the chat UI touches (`window.matchMedia` with a
   `prefers-reduced-motion` default of "reduce", `Element.prototype.scrollIntoView`, `ResizeObserver`).
   Each stub exists because a named component reads it — no speculative stubs.
4. The smoke test renders a trivial component and asserts one matcher, so the project is proven to
   run rather than assumed.

**Rule:** the node project's behaviour is unchanged — 1,176 tests, same files, same environment.
A component test may not import `lib/ai/gateway`, `lib/env` or anything that reads a secret.

**Commit:** `test(ui): add a jsdom project for component tests`
**Delta:** +1 test file, +1 test; `package.json` and `package-lock.json` change.

---

### Task 2 — The UI message stream and its parts

**Files:** `lib/ai/stream/protocol.ts` (new) + `lib/__tests__/stream-protocol.test.ts`,
`app/api/ai-chat/route.ts`, `app/api/ai-chat/route.pipeline.test.ts` and
`app/api/ai-chat/route.integration.test.ts` (additive)

1. `protocol.ts` is the one place that names the parts, so the server and the client cannot drift:
   `PARTS = { evidence: "data-evidence", activity: "data-activity", degraded: "data-degraded",
   citations: "data-citations" }`, the payload types (`EvidencePart { refs }`, `ActivityPart
   { planSource, tools, timings }`, `DegradedPart { reasons }`, `CitationsPart { report }`), and a
   pure builder per part. Version the envelope (`PROTOCOL_VERSION = 1`) and send it once in an
   `activity` part's `protocol` field — a client that sees a version it does not know renders text
   only rather than guessing.
2. The route wraps Plan 4's pipeline result into those parts and streams Plan 1's text deltas
   through the same response. Order: activity (with the pipeline's plan facts) → evidence →
   degraded, then text, then citations after the stream settles. Every part is built from the
   `PipelineResult` — no re-derivation, no new measurement.
3. **`degraded` is the union of what Plan 4 already computes**: the pipeline's reason, the
   `screened`/`uncited` reasons the route already derives, and `retrieval_failed`. The part carries
   strings, not sentences; the client owns the wording (Task 6).
4. **v1 emits `activity` + text only** (no evidence, no citations), and the route's existing tests
   keep proving v1. `route.pipeline.test.ts` gains assertions for each part on v2 and their absence
   on v1.
5. The three synthetic strings are unchanged in text, and a turn that ends in one sends a `degraded`
   part naming its state (D5).

**Rule:** the route may not import a client component; `protocol.ts` is isomorphic and dependency-free
(types + pure functions), so both sides may import it. The answer text is never re-encoded: the
`text` part carries exactly the delta Plan 1 produced.

**Commit:** `feat(ai): stream the answer as message parts`
**Delta:** +1 module +1 test file, additive route tests.

---

### Task 3 — Feedback: table, store, route

**Files:** `supabase/migrations/20260919140000_ai_message_feedback.sql` (new),
`lib/ai/feedback/store.ts` (new) + `lib/__tests__/feedback-store.test.ts`,
`app/api/ai-chat/feedback/route.ts` (new) + `app/api/ai-chat/feedback/route.test.ts`,
`lib/__tests__/ai-message-feedback-migration.test.ts`

1. The table: `ai_message_feedback` with `id`, `message_id` (FK to `ai_messages`), `user_id`, `value`
   (a small integer restricted to `1` / `-1` by a `check`), `note text` nullable, `created_at`. RLS
   enabled, **no policies**, `revoke all from anon, authenticated` — the `20260919090000` pattern.
   Additive only. One index on `(message_id)`; one unique index on `(message_id, user_id)` so a
   second vote replaces the first rather than stacking.
2. `store.ts` is a port + a Supabase implementation with injected client, in the shape of
   `lib/ai/memory`'s stores: `record({ messageId, userId, value, note })` upserting on
   `(message_id, user_id)`, and `forMessages(ids)` for Phase 6's reporting. Ownership is checked by
   resolving the message's conversation through the caller's own rows — a message id that is not
   theirs is a 404, never a write.
3. The route accepts `POST { messageId, value, note? }`, validates the body with Zod (the Plan 1
   habit), resolves auth, checks ownership, writes, and returns `{ recorded: true, value }`. A
   missing or unowned message is `404`; a bad value is `400`; an unauthenticated caller is `401`.
4. No client code in this task: the UI arrives in Task 7.

**Rule:** no test constructs a real Supabase store or executes the migration; the migration test
reads the SQL and asserts its structure (additive, nullable-where-appropriate, RLS enabled, no
policies), exactly as `ai-request-log-migration.test.ts` does.

**Commit:** `feat(chat): record answer feedback`
**Delta:** +1 migration, +1 store, +1 route, +3 test files.

---

### Task 4 — The client transport and view model

**Files:** `components/chat/useChatStream.ts` (new) + `components/chat/__tests__/useChatStream.test.tsx`

1. One hook, one shape. `useChatStream({ conversationId })` wraps `useChat` with the route's URL and
   returns a view model: `messages` (each with `text`, `refs`, `activity`, `degraded`, `citations`,
   `state`), `status` (`idle | streaming | stopped | error`), `stop()`, `regenerate()`, `send(text)`,
   `editAndResend(messageId, text)`, and `error`. Components consume the view model, never the raw
   parts.
2. The mapping is a pure function exported for its own test: parts in, view model out. Unknown part
   types and unknown `PROTOCOL_VERSION` values are ignored, not thrown on (forward compatibility,
   Task 2's rule).
3. Each message's `state` distinguishes: streaming, complete, stopped by the reader, ended in a
   synthetic string (D5), ended with a degrade.
4. Conversation id: the hook sends the id it was given and adopts the id the server returns (Plan 3's
   behaviour — the server owns conversation resolution), so a first message creates a conversation
   and the second one continues it.

**Rule:** the hook holds no provider knowledge and no secrets; a test drives it with a scripted
stream (a `ReadableStream` of frames built by `protocol.ts`) and asserts the view model. No network.

**Commit:** `feat(chat): read the stream as parts`
**Delta:** +1 module, +1 test file, ~10–14 tests.

---

### Task 5 — Citation chips and the sources panel

**Files:** `components/chat/CitationChips.tsx`, `components/chat/SourcesPanel.tsx` (both new) +
`components/chat/__tests__/citations.test.tsx`

1. `CitationChips` renders the numbered references an answer used, from `EvidenceRef[]` and the
   citation report: a chip per cited number, the tag as its tier label (`[RET]` / `[WIKI]` /
   `[CONV]`), the document title as its accessible name, and a `title`/tooltip with the label. A
   citation the report marked `unknown` renders as a broken reference and is never silently dropped
   — the validator's honesty is visible to the reader.
2. `SourcesPanel` lists every admitted reference with its number, tag and title, and can be opened
   from a chip (the same document, highlighted) — one list, two entry points, so there is one source
   of truth for "what the model was given".
3. **The chips never parse the answer text.** A test asserts a chip set built only from the server's
   refs (the message text deliberately contains a number that no ref matches) — the contract from
   Plan 4 §9.
4. Screening stays invisible: an excluded document has no ref, so it cannot appear. A `screened`
   degrade (Task 6) is the only trace the reader sees, and it says so in words.
5. Semantic markup: a chip is a `button` inside an `ol`/`ul` of references; the panel is a
   `dialog`/`aside` with a heading and a focus trap only while modal. Keyboard reachable, Escape
   closes.

**Commit:** `feat(chat): render citations against the evidence`
**Delta:** +2 components, +1 test file, ~12–16 tests.

---

### Task 6 — Activity trace and degrade badges

**Files:** `components/chat/ActivityTrace.tsx` (new) + `components/chat/__tests__/activity.test.tsx`

1. Collapsed by default (D8): one line, e.g. "2 steps · 1.4 s · searched the catalog, looked up a
   character", where the step names come from `toolNames` and the duration from `timings`. Expanded,
   it lists each stage's measurement the server sent — never a value the client computed from
   wall-clock.
2. The wording for each degrade reason lives here as one table:
   `pipeline_failed`, `corpus_unavailable`, `corpus_static`, `execute_budget`, `ladder_failed`,
   `tool_failed`, `retrieval_budget`, `evidence_evicted`, `screened`, `uncited`, `retrieval_failed`.
   A reason with no table entry renders a neutral "degraded" badge and is *reported by name* rather
   than hidden — a new server reason must be visible before it is explained.
3. `planSource` renders as the planning path (`router` / `model` / `fallback`), with the fallback case
   worded so it does not read as an error.
4. No provider name, no key, no raw error text (constraint 9).

**Commit:** `feat(chat): show what the pipeline did`
**Delta:** +1 component, +1 test file, ~10–12 tests.

---

### Task 7 — Message parts rendering

**Files:** `components/chat/ChatMessage.tsx` + `components/chat/__tests__/chat-message.test.tsx`

1. `ChatMessage` renders the view model: the answer text (with the existing markdown treatment, if
   any, preserved), `CitationChips` under it when refs exist, `ActivityTrace` when activity exists,
   `SourcesPanel` on demand, and the feedback controls (thumbs against Task 3's route) once the
   message is complete — never while streaming.
2. A stopped message says so; a message that ended in a synthetic string shows its state badge (D5)
   with the text unchanged; a `degraded` message shows the badge from Task 6.
3. Feedback is optimistic with a rollback on failure, and a second vote replaces the first (the
   unique index in Task 3 is the server's guarantee; the client must not need a reload to show it).
4. **The v1 shape renders**: a message with text and nothing else must look finished, not broken — an
   explicit test, because that is what `AI_PIPELINE=v1` produces.

**Commit:** `feat(chat): render an answer as parts`
**Delta:** 1 modified component (additive), +1 test file, ~12 tests.

---

### Task 8 — Send, stop, regenerate, edit (**P1**)

**Files:** `components/chat/ChatWidget.tsx`, `components/chat/ChatInput.tsx` + their tests

1. The widget is rebuilt around `useChatStream` (Task 4) — this is the task that satisfies the
   remaster for the send path, and the one that cannot start before P1 (D9).
2. Stop: aborts the stream, keeps the partial answer, marks the message stopped, and offers
   regenerate. The server-side abort already exists (Plan 4's shared request budget).
3. Regenerate: resends the last user turn, replacing the last assistant message. The transcript
   consequence is Plan 3's concern; the client sends the same request shape it always did, with the
   conversation id.
4. Edit: truncates from the edited turn in the UI, then sends; the server's transcript is rewritten
   by the normal write path, not by a client-supplied history (D7).
5. `ChatInput` keeps its Web Speech input and gains: Enter to send, Shift+Enter for a newline, an
   Escape-to-stop while streaming, and a disabled send while the input is empty.
6. The optimistic user message appears immediately; the assistant message appears as a streaming
   placeholder rather than after the first delta.

**Commit:** `feat(chat): stop, regenerate and edit a turn`
**Delta:** 2 modified components, 2 test files, ~14 tests. Requires P1.

---

### Task 9 — Conversation drawer (**P1**)

**Files:** `components/chat/ConversationDrawer.tsx` (new) + test, wiring in `ChatWidget.tsx`

1. A drawer listing the signed-in user's conversations from `GET /api/ai-chat/conversations` (no
   query string; the store's own 30-newest ordering, archived rows excluded), with the title the
   server stores, a relative time, and the active one marked. Selecting one loads its transcript
   through `GET /api/ai-chat/conversations?id=<uuid>` — the same endpoint, whose scoped read is the
   ownership check — and replaces the in-place transcript. That read is capped at 200 messages and
   ordered oldest-first, so the drawer must render what it gets rather than assume a full history.
2. Archive through `DELETE /api/ai-chat/conversations` with a confirmation step, optimistic removal,
   and the undo affordance the existing UI language uses (a toast, not a modal, unless the repo's
   convention says otherwise — the executing agent checks and matches).
3. An empty state, a loading state, and an error state that keeps the previous list on screen.
4. Radix `dialog` (already a dependency) for the drawer, with focus restoration on close; the
   Drawer is keyboard-reachable from the header and from the message list.

**Commit:** `feat(chat): list and reopen conversations`
**Delta:** +1 component +1 test file, wiring in `ChatWidget.tsx`. Requires P1.

---

### Task 10 — Memory panel (**P1**)

**Files:** `components/chat/MemoryPanel.tsx` (new) + test, wiring in `ChatWidget.tsx`

1. A panel that shows what the bot remembers about the signed-in user, from
   `GET /api/ai-chat/memory`: each fact with its text, its kind, its confidence and its age — the same
   facts the assembler injects, which is the point of showing them (transparency).
2. Delete one fact and clear all (`DELETE /api/ai-chat/memory`, both shapes the route already
   supports), with optimistic removal and a rollback on failure. A delete is a real delete: the panel
   says so in one sentence.
3. When memory is off (`AI_MEMORY=off`), the endpoint's answer is rendered as the honest empty state
   ("memory is disabled for this deployment"), not as an error.
4. Nothing in the panel claims to be complete: the panel lists what is stored, and a note says that
   the tracker's own data always outranks it (Plan 3's precedence rule, stated to the reader).

**Commit:** `feat(chat): show and delete a memory`
**Delta:** +1 component +1 test file, wiring in `ChatWidget.tsx`. Requires P1.

---

### Task 11 — Accessibility, keyboard and mobile (**P1**)

**Files:** the chat components + `components/chat/__tests__/a11y.test.tsx` and
`components/chat/__tests__/responsive.test.tsx`

1. **Streaming is announced, not shouted:** the message container is `aria-live="polite"` while
   streaming and switches to `aria-live="off"`/`role="log"` semantics when complete, so a screen
   reader reads the answer once, not per-token. A test asserts the attribute transition.
2. **The keyboard path is complete:** send, stop, regenerate, open a chip, open the sources panel,
   close it, open the drawer, open the memory panel, delete a fact — each reachable with Tab/Enter/
   Escape and each asserted by a keyboard-only test (`user-event`).
3. **Focus management:** opening a panel moves focus into it and closing restores it to the control
   that opened it; the streaming placeholder never steals focus.
4. **Reduced motion:** every `framer-motion` transition has a reduced-motion branch, and the test
   setup's `matchMedia` stub (Task 1) is used to assert the branch is taken.
5. **Mobile:** the widget is usable at 360 px — the drawer and panels become full-height sheets, the
   composer stays above the keyboard, and the trace collapses to its one-line form. Asserted by
   rendered-structure tests, not by pixel snapshots.
6. Contrast and touch targets: any value the agent changes is reported with the pair it came from
   (token names), not eyeballed.

**Commit:** `feat(chat): keyboard and screen-reader paths`
**Delta:** component edits + 2 test files, ~14–18 tests. Requires P1.

---

### Task 12 — Documentation and phase verification

**Files:** `SYSTEM_DOCS.md`, `.env.example`

1. A **"Chat UI"** section: the transport (Task 2's parts and `PROTOCOL_VERSION`), the view model,
   the citation contract as the UI sees it, the activity/degrade vocabulary, feedback storage and its
   ownership rule, the drawer and memory panel and what each calls, and the accessibility properties
   (live region, focus order, reduced motion).
2. `.env.example` gains anything new, each with a comment naming its default and meaning.
3. The migration's manual verification SQL (`information_schema.columns` and
   `pg_indexes` for `ai_message_feedback`), the statement that it is committed and **not applied**,
   and that no test executes it.
4. State the rollback plainly: `AI_PIPELINE=v1` changes the pipeline and the parts the UI receives;
   the UI itself has no v1 switch and must not need one.
5. No test count change.

**Commit:** `docs(chat): document the remastered surface`

---

## 7. Risks recorded while planning

| Risk | Mitigation |
| --- | --- |
| The AI SDK pulls in a provider path that bypasses the quota | D1: the SDK frames only; `streamChat` remains the model call, and a test asserts the route imports no provider package |
| A UI rewrite loses the user's in-flight widget edits | D9/P1: Tasks 1–7 do not touch `ChatWidget.tsx`, and Tasks 8–11 wait for the user's commit |
| Chip numbers drifting from the evidence | Plan 4's `EvidenceRef[]` is the single mapping; a test renders chips from refs against a text that contains a decoy number |
| jsdom slowing or breaking the node suite | D4: a second project, node untouched, and the 1,176-test baseline re-verified in Task 1 |
| Accessibility claimed but not tested | Task 11 asserts the live-region transition, the keyboard path and the reduced-motion branch by test, and reports the token pairs it changed |
| A new degrade reason reaching the UI unrecognised | Task 6 renders an unknown reason by name with a neutral badge |
| Streaming partial text being quoted as a complete answer | Task 4's `state` distinguishes stopped/partial, and Task 7 renders it |

## 8. Completion criteria

**Phase 5 is complete** when all of the following hold and are reported verbatim:

1. `npm test` passes with the jsdom project in place; report the final test and file counts against
   the **1,176 / 73** committed baseline, and state whether the node project's own count moved at all
   (it must not).
2. `npx tsc --noEmit` exits 0, `npm run lint` reports 0 errors, `npm run build` succeeds with the
   three `/api/ai-chat*` routes plus the new `/api/ai-chat/feedback` route listed.
3. The transport ships parts: a test proves the route emits `evidence`, `activity` and `citations` on
   v2 and only text on v1, and that the answer text crosses the wire unmodified.
4. Citation chips resolve against `EvidenceRef[]` and never parse the answer text — named test.
5. Stop, regenerate and edit each work, each with a named test; a stopped answer keeps its partial
   text.
6. Feedback round-trips: a vote writes a row, a second vote replaces it, and a message that is not
   the caller's is refused — named tests for all three.
7. The drawer and the memory panel work against Plan 3's endpoints, including archive/delete and the
   disabled-memory empty state — named tests.
8. Accessibility: the live-region transition, the keyboard-only path, focus restoration and the
   reduced-motion branch each have a named test; the contrast/touch-target values changed are
   reported with their token names.
9. Every degrade reason Plan 4 can emit has a rendered wording or a neutral badge, and the list is
   quoted in the report.
10. The in-flight workstream's ten files are untouched except `components/chat/ChatWidget.tsx` (and
    `ChatMessage.tsx`/`ChatInput.tsx`), which were edited only after the user committed them — with
    the confirming commit hash quoted.
11. Feedback's migration is committed and **not** applied; the report says so, lists the manual
    verification SQL, and states that no test executed it.
12. Every deviation a subagent had to make, and every plan bug found during execution, is listed
    here as it was done for Plan 4 (a `D1–Dn` block appended to §5).

## 9. What Phase 6 consumes

- **`ActivityPart`'s degrade vocabulary and `planSource`** — Phase 6's log queries group by them, so
  the strings the UI renders and the strings the log stores must stay one list (`protocol.ts` re-exports
  Plan 4's vocabulary rather than inventing a second one).
- **`ai_message_feedback`** — the quality signal Phase 6 reports alongside `ai_request_log`.
- **`report.evicted` from `assembleMessages`** — still unrendered; Phase 6 surfaces it.
- **The jsdom project** — Phase 6's CI wiring runs both projects.
