# DCPH Bot — Plan 2: Corpus and Retrieval (spec Phase 2)

**Date:** 2026-09-19
**Spec:** `docs/superpowers/specs/2026-09-19-dcph-bot-agentic-remaster-design.md` §5.4, §5.5, §6, §11
**Depends on:** Plan 1 (`2026-09-19-dcph-bot-provider-safety-and-gateway.md`), all 13 tasks committed
**Scope:** `supabase/migrations/`, new `lib/ai/corpus/*`, new `lib/ai/retrieval/*`, new `lib/ai/tools/*`, one new admin route, one new eval fixture

---

## 1. Goal

Move retrieval off `ILIKE '%term%'` scans over `content_entries` / `dcw_cases`, and make the
curated TypeScript knowledge (95 characters, 153 relationships, 7 arcs, 4 threads, canon
ranges, 29 movies, 8 gadgets) reachable from the bot for the first time.

Deliverable: an indexed corpus in `ai_documents`, a deterministic escalation ladder that
retrieves from it, seven tools including the table-lookup `classifyEpisode`, a cached
wiki fallback, and a CI gate that fails if retrieval recall@5 drops below 0.85.

**No LLM call is made anywhere in Phase 2.** Retrieval is deterministic code over an index.
This phase costs $0 in model budget by construction, and it cannot be blocked by a provider
outage.

### What this phase does *not* do

The route still calls `lib/chat/search.ts`. Nothing user-visible changes until Plan 4 wires
the orchestrator onto these modules. That is deliberate: Phase 2 is verifiable in isolation —
its tests exercise the ladder and the tools directly, with no route, no model, no network.

---

## 2. Global constraints (carry forward from Plan 1, unchanged)

1. **$0 model budget.** Free tiers only. (Phase 2 makes no model calls at all.)
2. **No embeddings, no pgvector.** Lexical retrieval only.
3. **Migrations are additive only.** New tables, columns, indexes, functions. No `drop table`,
   no `delete from`, no `truncate`, no destructive `alter`.
4. **RLS on for every new table**, with no policies, plus
   `revoke all on table ... from anon, authenticated` — only `service_role` reaches them.
5. **Never log a full API key.** Log a target id at most. (Nothing in Phase 2 handles keys.)
6. **Never run `supabase db push`.** Applying migrations to the linked remote project is a
   deliberate human step. Every migration in this plan is written to be applied by hand.
7. **Never sweep the user's in-flight work into a commit.** At session start these are staged
   or untracked and must stay that way: `components/characters/*`, `components/chat/ChatWidget.tsx`,
   `lib/character-chrome.ts`, `lib/security-headers.ts`, `lib/use-media-query.ts`,
   `middleware.ts`, `next.config.ts`, `utils/supabase/middleware.ts`, `.pi/`, `.pi-tasks/`,
   `lib/characters-graph-engine.ts`, `lib/__tests__/characters-graph-engine.test.ts`, `docs/characters-*.md`,
   `supabase/.temp/`.
8. **Commit procedure.** `git add -- <paths>` then `git commit --only -m "<msg>" -- <paths>`.
   Never `git commit -a`, never `--amend` without `--only`.
9. **Code style.** No semicolons, double quotes, 2-space indent, JSDoc that explains *why*.
10. **Verification gate for every task:** `npm test && npx tsc --noEmit && npm run lint`.

### 2.1 Phase 2 specific constraints

11. **Every test is offline.** No test may open a network connection or a database connection.
    `.env.local` holds a real `SUPABASE_SERVICE_ROLE_KEY`, so a test that constructs
    `createAdminClient()` would reach the live project. Inject fake clients instead.
12. **The SQL is not executed by any test.** CI has no Postgres. The migration and the three
    RPC functions are reviewed, structurally asserted (`Task 1`), and exercised by a manual
    checklist after the user applies the migration. Say this plainly in the task reports —
    "green tests" must never be read as "the SQL ran".
13. **No new runtime dependency.** No `tsx`, no `pg`, no `pg-mem`, no `@ai-sdk/*` yet (that is
    Plan 5). Node builtins only.
14. **`lib/chat/query.ts` is not modified.** It is the most-tested module in the repo (39 tests).
    It is *consumed* — `rankEntries` with a `fieldsOf` adapter, exactly as `search.ts:610-620`
    already does. If a task seems to need a change to `query.ts`, stop and report instead.

---

## 3. Execution protocol

Sequential subagent-driven execution, one task per subagent, **never in parallel**. Each task:

1. Subagent reads this plan file and the files its task names.
2. Writes the test file first, runs it, watches it fail.
3. Writes the implementation, runs it, watches it pass.
4. Runs the full gate: `npm test && npx tsc --noEmit && npm run lint`.
5. Commits with `git add -- <paths>` + `git commit --only -m "<task msg>" -- <paths>`.
6. Reports: what changed, the gate result verbatim, any deviation from the plan, anything
   discovered that the plan got wrong.

If a subagent finds the plan's test and implementation disagree, it **stops and reports**.
Editing a test to match an implementation (or the reverse) is the orchestrator's call, not
the subagent's.

---

## 4. Task index

| # | Task | Files |
| --- | --- | --- |
| 1 | Corpus schema migration + structural assertions | `supabase/migrations/20260919100000_ai_corpus.sql`, `lib/__tests__/ai-corpus-migration.test.ts` |
| 2 | Corpus document types, hashing, curated builders | `lib/ai/corpus/types.ts`, `hash.ts`, `curated.ts`, `lib/__tests__/corpus-curated.test.ts` |
| 3 | Tracker (catalog + case) builders and the scorer adapter | `lib/ai/corpus/tracker.ts`, `build.ts`, `lib/__tests__/corpus-tracker.test.ts` |
| 4 | Offline catalog fixture: the seed-SQL parser | `lib/ai/corpus/seed-sql.ts`, `lib/__tests__/corpus-seed-sql.test.ts` |
| 5 | Reciprocal rank fusion | `lib/ai/retrieval/rrf.ts`, `lib/__tests__/retrieval-rrf.test.ts` |
| 6 | Document source port: static + Supabase | `lib/ai/retrieval/source.ts`, `lib/__tests__/retrieval-source.test.ts` |
| 7 | Candidate re-ranking through the existing scorer | `lib/ai/retrieval/candidates.ts`, `lib/__tests__/retrieval-candidates.test.ts` |
| 8 | Escalation ladder (R1–R4, threshold, budget) | `lib/ai/retrieval/ladder.ts`, `lib/__tests__/retrieval-ladder.test.ts` |
| 9 | Deterministic tools: classifyEpisode, arcForRange, lookupCharacter | `lib/ai/tools/classify-episode.ts`, `arc-for-range.ts`, `lookup-character.ts`, `lib/__tests__/ai-tools-deterministic.test.ts` |
| 10 | Source-backed search tools | `lib/ai/tools/search-catalog.ts`, `search-cases.ts`, `lib/__tests__/ai-tools-search.test.ts` |
| 11 | Wiki cache with a time box | `lib/ai/wiki-cache.ts`, `lib/__tests__/ai-wiki-cache.test.ts` |
| 12 | wikiLookup, nextUnwatched, tool registry and runner | `lib/ai/tools/wiki-lookup.ts`, `next-unwatched.ts`, `index.ts`, `lib/__tests__/ai-tools-registry.test.ts` |
| 13 | Corpus ingestion over the database | `lib/ai/corpus/collect.ts`, `ingest.ts`, `lib/__tests__/corpus-ingest.test.ts` |
| 14 | The ingestion route | `app/api/admin/ingest-corpus/route.ts`, `app/api/admin/ingest-corpus/route.test.ts` |
| 15 | Golden eval set and the recall@5 gate | `lib/ai/retrieval/eval.ts`, `lib/__tests__/fixtures/golden-qa.json`, `lib/__tests__/retrieval-eval.test.ts`, `SYSTEM_DOCS.md` |

---

## 5. Deviations from the spec (decided here, recorded deliberately)

Each of these was decided while writing this plan, against the actual repo. A subagent must
not "fix" one back to the spec's wording.

**D1 — `case:<page_title>` is not a valid primary key.** `dcw_cases` has
`unique (page_title, case_index)` (`supabase/migration-case-files.sql:51`): one wiki page
routinely holds several cases. The spec's id scheme (§5.4) would collide. Case doc ids are
therefore `case:<page_title>#<case_index>`.

**D2 — `episode_number` and `movie_number` are real columns, not jsonb metadata.** The spec
puts them in `metadata`. R1 ("entity-precise: episode/movie numbers") is the hottest query in
the ladder, and `metadata->>'episode_number' = '500'` is a cast on every row. Two `integer`
columns with partial btree indexes make it an index lookup. `air_date`, `canon_type`, `arc_id`
and friends stay in `metadata`.

**D3 — `aliases` is a `text[]` column with a GIN index**, not `metadata.aliases[]`. Alias
resolution ("Shinichi" → Conan, "Sherry" → Haibara) is a query, not a payload.

**D4 — there is no `scripts/ingest-ai-corpus.mjs`.** The spec names one. Plain Node cannot
import `lib/characters-guide.ts`: the modules are TypeScript, and they import through the
`@/` alias. There is no `tsx`/`ts-node` in the repo and constraint 13 forbids adding one.
Ingestion therefore lives in a server module (`lib/ai/corpus/ingest.ts`) reached through a
guarded admin route (`Task 14`) — the same shape as `app/api/admin/sync-crimes/route.ts`,
which is already the repo's cron-driven ingestion pattern. The *test fixture* half of the
spec's intent is served by the seed parser (`Task 4`), which needs no database at all.

**D5 — the CI eval is offline and therefore approximates Postgres.** `StaticDocumentSource`
(`Task 6`) is an in-process lexical index used by every test. It implements the same three
branches (entity / full-text AND-over-tokens / trigram similarity) but not Postgres's exact
ranking. The recall@5 gate therefore measures the *pipeline* — ladder, fusion, scorer — over
real corpus data, not the SQL. The SQL's own quality is a manual check after migration
application. This is recorded in the eval test's header comment so nobody later mistakes the
number for a live measurement.

**D6 — entry docs absorb their linked case text.** `dcw_cases.entry_id` links a case to an
episode. Rather than emitting a third doc, an `entry:` doc carries its case text in
`metadata.case_text`, surfaced through `toRankable().extra` — the same injection the tested
`scoreEntry` path already rewards with weight 2 (`query.ts:242`).

---

## 6. Tasks

### Task 1 — Corpus schema migration

**Files:** `supabase/migrations/20260919100000_ai_corpus.sql`, `lib/__tests__/ai-corpus-migration.test.ts`

**Why the timestamp is `20260919100000`:** it sorts after `20260919090000_ai_gateway_infra.sql`,
which is what the runner requires.

Write the migration exactly as below.

```sql
-- supabase/migrations/20260919100000_ai_corpus.sql
--
-- The retrieval corpus. Three additions, all additive:
--   pg_trgm        - trigram index support for typo-tolerant title lookup
--   ai_documents   - one row per retrievable document, FTS + trigram indexed
--   ai_wiki_cache  - time-boxed cache in front of the live DCW/Wikipedia fetch
--
-- ai_documents is reachable only with the service-role key: RLS is enabled with
-- NO policies, mirroring public.rate_limits and ai_provider_state.

create extension if not exists pg_trgm with schema extensions;

create table if not exists public.ai_documents (
  id             text        primary key,
  source         text        not null,
  title          text        not null,
  body           text        not null default '',
  url            text,
  metadata       jsonb       not null default '{}'::jsonb,
  -- First-class rather than metadata jsonb: R1 of the ladder looks an episode
  -- number up by equality on every "what happened in episode N" question.
  episode_number integer,
  movie_number   integer,
  aliases        text[]      not null default '{}'::text[],
  content_hash   text        not null,
  updated_at     timestamptz not null default now(),
  -- to_tsvector must be given an explicit regconfig: the one-argument form is
  -- STABLE, not IMMUTABLE, and a generated column rejects it.
  fts tsvector generated always as (
    setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(body, '')), 'B')
  ) stored
);

create index if not exists ai_documents_fts_idx
  on public.ai_documents using gin (fts);

create index if not exists ai_documents_title_trgm_idx
  on public.ai_documents using gin (title extensions.gin_trgm_ops);

create index if not exists ai_documents_aliases_idx
  on public.ai_documents using gin (aliases);

create index if not exists ai_documents_source_idx
  on public.ai_documents (source);

create index if not exists ai_documents_episode_idx
  on public.ai_documents (episode_number)
  where episode_number is not null;

create index if not exists ai_documents_movie_idx
  on public.ai_documents (movie_number)
  where movie_number is not null;

alter table public.ai_documents enable row level security;
revoke all on table public.ai_documents from anon, authenticated;

create table if not exists public.ai_wiki_cache (
  cache_key  text        primary key,
  source     text        not null,
  title      text        not null,
  extract    text        not null,
  url        text,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists ai_wiki_cache_expires_at_idx
  on public.ai_wiki_cache (expires_at);

alter table public.ai_wiki_cache enable row level security;
revoke all on table public.ai_wiki_cache from anon, authenticated;

-- R1: entity-precise. Episode/movie number, exact title, alias, or title substring.
-- p_names must already be lowercase and non-empty; the caller normalises.
create or replace function public.ai_docs_entity(p_numbers int[], p_names text[], p_limit int)
returns table (id text, rank real)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select d.id,
         greatest(
           case when d.episode_number = any (p_numbers) or d.movie_number = any (p_numbers) then 3.0 else 0.0 end,
           case when lower(d.title) = any (p_names) then 2.0 else 0.0 end,
           case when d.aliases && p_names then 1.5 else 0.0 end,
           case when exists (
             select 1 from unnest(p_names) as n
             where n <> '' and lower(d.title) like '%' || n || '%'
           ) then 1.0 else 0.0 end
         )::real as rank
  from public.ai_documents as d
  where d.episode_number = any (p_numbers)
     or d.movie_number = any (p_numbers)
     or lower(d.title) = any (p_names)
     or d.aliases && p_names
     or exists (
       select 1 from unnest(p_names) as n
       where n <> '' and lower(d.title) like '%' || n || '%'
     )
  order by rank desc, d.id
  limit p_limit;
$$;

-- R2: full-text. websearch_to_tsquery never raises on malformed input - it
-- returns an empty tsquery, which matches nothing. That is the property that
-- makes it safe to hand a user's raw question to the database.
create or replace function public.ai_docs_fts(p_query text, p_limit int)
returns table (id text, rank real)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  with q as (select websearch_to_tsquery('english'::regconfig, p_query) as query)
  select d.id, ts_rank_cd(d.fts, q.query)::real as rank
  from public.ai_documents as d, q
  where d.fts @@ q.query
  order by rank desc, d.id
  limit p_limit;
$$;

-- R3: typo tolerance on titles. similarity() is qualified because pg_trgm lives
-- in the extensions schema; the % operator honours pg_trgm.similarity_threshold.
create or replace function public.ai_docs_fuzzy(p_query text, p_keywords text[], p_limit int)
returns table (id text, rank real)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select d.id,
         greatest(
           extensions.similarity(lower(d.title), lower(coalesce(p_query, ''))),
           coalesce((
             select max(extensions.similarity(lower(d.title), k))
             from unnest(p_keywords) as k
             where length(k) >= 3
           ), 0.0)
         )::real as rank
  from public.ai_documents as d
  where lower(d.title) % lower(coalesce(p_query, ''))
     or exists (
       select 1 from unnest(p_keywords) as k
       where length(k) >= 3 and lower(d.title) % k
     )
  order by rank desc, d.id
  limit p_limit;
$$;
```

**Test:** `lib/__tests__/ai-corpus-migration.test.ts`. Read the file with
`readFileSync(new URL("../../supabase/migrations/20260919100000_ai_corpus.sql", import.meta.url), "utf8")`
(no `process.cwd()` — vitest runs from the repo root today but the URL form cannot drift).
Assert:

- the file exists and is non-empty
- **additive only**: `expect(sql).not.toMatch(/^\s*drop\s+(table|type|schema|index)/im)`,
  `.not.toMatch(/^\s*delete\s+from\b/im)`, `.not.toMatch(/^\s*truncate\b/im)`
- `create extension if not exists pg_trgm with schema extensions`
- `enable row level security` appears exactly twice, and both tables are covered:
  `/alter table public\.ai_documents enable row level security/`,
  `/alter table public\.ai_wiki_cache enable row level security/`
- both `revoke all on table ... from anon, authenticated` statements are present
- the generated column uses the two-argument form in **both** of its branches. Scope the
  slice to the column definition — the same regconfig also appears in `ai_docs_fts`, so a
  whole-file count would be 3, not 2:
  ```ts
  const generated = sql.slice(sql.indexOf("fts tsvector"), sql.indexOf(") stored"))
  expect(generated.match(/'english'::regconfig/g)).toHaveLength(2)
  ```
  and `expect(sql).not.toMatch(/to_tsvector\(\s*coalesce/)` (that would be the one-argument,
  non-immutable form, which Postgres rejects inside a generated column)
- `websearch_to_tsquery` passes the regconfig explicitly, so R2 does not depend on the
  session's `default_text_search_config`: `expect(sql.match(/'english'::regconfig/g)).toHaveLength(3)`
- `using gin (fts)`, `extensions.gin_trgm_ops`, `using gin (aliases)`
- all three function names appear, each followed (within its body) by `stable`:
  `expect(sql.match(/\bstable\b/g)).toHaveLength(3)`
- `expect(sql.match(/set search_path = public, extensions, pg_temp/g)).toHaveLength(3)`
- `ai_docs_entity` compares numbers with `= any (p_numbers)` and guards empty names with
  `n <> ''` (the guard matters: `like '%' || '' || '%'` matches every row)
- `websearch_to_tsquery` is present — not `to_tsquery`, which raises on user input

**Commit:** `feat(ai): add the retrieval corpus schema`

**Manual verification (for the user, after applying the migration):**

```sql
-- The migration's first statement needs this schema to exist; Supabase creates it,
-- but check before running the file if the project was ever rebuilt by hand.
select 1 from pg_namespace where nspname = 'extensions';

select count(*) from public.ai_documents;
select id, rank from public.ai_docs_entity(array[500], array['haibara'], 5);
select id, rank from public.ai_docs_fts('ski lodge murder', 5);
select id, rank from public.ai_docs_fuzzy('haibarra', array['haibarra'], 5);
```

---

### Task 2 — Corpus types, hashing, curated builders

**Files:** `lib/ai/corpus/types.ts`, `lib/ai/corpus/hash.ts`, `lib/ai/corpus/curated.ts`,
`lib/__tests__/corpus-curated.test.ts`

This is the module every later task imports. Write the interfaces exactly as given.

**`lib/ai/corpus/types.ts`**

```ts
import type { RankableEntry } from "@/lib/chat/query"

/**
 * Which source a document came from. Kept as a column so the retrieval ladder can
 * ask for "catalog only" or "characters only" without a second table.
 */
export type CorpusSource =
  | "content_entries"
  | "dcw_cases"
  | "characters"
  | "relationships"
  | "arcs"
  | "threads"
  | "canon"
  | "movies"
  | "gadgets"

/**
 * Everything else a document wants to expose. Only the fields the scorer can use
 * are named; the index signature keeps the rest JSON-serialisable into the
 * metadata column without a second type.
 */
export interface DocMetadata {
  kind?: string
  slug?: string
  dcw_title?: string
  synopsis?: string
  air_date?: string
  canon_order?: number
  release_order?: number
  type?: string
  arc_slug?: string
  episode_start?: number
  episode_end?: number
  eras?: string
  years?: string
  status?: string
  canon_type?: string
  max_episode?: number
  case_index?: number
  case_text?: string
  page_title?: string
  crime_type?: string
  victim?: string
  suspects?: string
  location?: string
  cause_death?: string
  description?: string
  japanese?: string
  year?: number
  role?: string
  affiliation?: string
  debut_episode?: number | null
  debut_movie?: number | null
  reveal_episode?: number | null
  spoiler?: string
  [key: string]: unknown
}

export interface CorpusDocument {
  /** Stable across rebuilds: `entry:<slug>`, `character:<id>`, `arc:<slug>`, ... */
  id: string
  source: CorpusSource
  title: string
  body: string
  url: string | null
  metadata: DocMetadata
  /**
   * Set ONLY when the document *is* that numbered entry (an episode row, a
   * movie row). A character whose debut is episode 129 deliberately leaves it
   * unset: R1 treats a number hit as near-certain, and answering "what happens
   * in episode 129" with 40 character documents would bury the episode.
   */
  episodeNumber?: number | null
  movieNumber?: number | null
  /** Lowercase. Matched with the `&&` overlap operator, so tokens beat phrases. */
  aliases?: string[]
}

/**
 * The scorer's view of a document. `lib/chat/query.ts` scores flat fields, so the
 * document's metadata has to be projected onto `RankableEntry` before ranking --
 * the same adapter pattern `search.ts:610-620` uses for linked case text.
 */
export function toRankable(doc: CorpusDocument): RankableEntry {
  const meta = doc.metadata
  return {
    title: doc.title,
    dcw_title: meta.dcw_title ?? null,
    page_title: meta.page_title ?? null,
    synopsis: meta.synopsis ?? null,
    description: meta.description ?? null,
    victim: meta.victim ?? null,
    suspects: meta.suspects ?? null,
    crime_type: meta.crime_type ?? null,
    location: meta.location ?? null,
    cause_death: meta.cause_death ?? null,
    extra: meta.case_text ?? null,
    episode_number: doc.episodeNumber ?? null,
    movie_number: doc.movieNumber ?? null,
    air_date: meta.air_date ?? null,
  }
}
```

**`lib/ai/corpus/hash.ts`**

```ts
import { createHash } from "node:crypto"
import type { CorpusDocument } from "@/lib/ai/corpus/types"

/**
 * JSON with object keys sorted, so a metadata object assembled in a different
 * insertion order hashes identically. Without this every ingestion run would
 * rewrite every row and `content_hash` would buy nothing.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null"
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`
}

const HASHED_FIELDS = ["title", "body", "url", "metadata", "episodeNumber", "movieNumber", "aliases"] as const

export function contentHash(doc: Pick<CorpusDocument, (typeof HASHED_FIELDS)[number]>): string {
  const material = stableStringify({
    title: doc.title,
    body: doc.body,
    url: doc.url,
    metadata: doc.metadata,
    episodeNumber: doc.episodeNumber ?? null,
    movieNumber: doc.movieNumber ?? null,
    aliases: [...(doc.aliases ?? [])].sort(),
  })
  return createHash("sha256").update(material).digest("hex")
}
```

**`lib/ai/corpus/curated.ts`** — the TypeScript half of the corpus. Import
`CHARACTERS`, `RELATIONSHIPS`, `RELATIONSHIP_META`, `getSpoilerMeta` and the types
`Character` / `Relationship` from `@/lib/characters-guide`; `STORY_ARCS`,
`RECURRING_THREADS`, `type StoryArc`, `type RecurringThread` from `@/lib/arcs-guide`;
`MAINLINE_MOVIES`, `type MainlineMovie` from `@/lib/movies-guide`; `CANON_TYPES`,
`CANON_TYPE_LABELS`, `CANON_TYPE_DESCRIPTIONS`, `canonRangeTotal`, `MAX_EPISODE`,
`CANON_GUIDE_SOURCE` from `@/lib/canon-guide`.

Every builder takes its data as an optional parameter defaulting to the imported array —
that is what lets a test prove the builder is a pure function of its input.

```ts
export interface CorpusDocumentSeed { /* the builders' common output; re-export CorpusDocument */ }
```

Signatures to implement, all returning `CorpusDocument[]`:

- `buildCharacterDocs(characters: Character[] = CHARACTERS): CorpusDocument[]`
- `buildRelationshipDocs(relationships: Relationship[] = RELATIONSHIPS, characters: Character[] = CHARACTERS): CorpusDocument[]`
- `buildArcDocs(arcs: StoryArc[] = STORY_ARCS): CorpusDocument[]`
- `buildThreadDocs(threads: RecurringThread[] = RECURRING_THREADS): CorpusDocument[]`
- `buildCanonDoc(): CorpusDocument[]`
- `buildMovieDocs(movies: MainlineMovie[] = MAINLINE_MOVIES): CorpusDocument[]`
- `buildGadgetDocs(gadgets: readonly Gadget[] = GADGETS): CorpusDocument[]`

and `export const GADGETS: readonly Gadget[]`, `export interface Gadget { name: string; aliases: readonly string[]; description: string }`.

Per-builder rules:

| Builder | id | title | url | notes |
| --- | --- | --- | --- | --- |
| characters | `character:<id>` | `character.name` | `/characters` | body: role, affiliation, bio, aliases, debut/reveal. `aliases`: each `character.aliases` entry lowercased **plus every token of length ≥ 3 in it**, so "Shinichi Kudo" also matches the token `shinichi` and `kudo`. Never sets `episodeNumber`. |
| relationships | `relationship:<id>` | `"<source name> and <target name>"` | `/characters` | body: `RELATIONSHIP_META[type].label`, then `detail`. `aliases: []`. A relationship whose endpoints are missing from `characters` is **skipped** (not emitted with a `undefined` name). |
| arcs | `arc:<slug>` | `arc.title` | `/arcs/<slug>` | body: tagline, era/years/status line, `formatEpisodeRange`-style range, summary, key characters as `name — role`, highlights as `episodes — title: note`. metadata: `arc_slug`, `episode_start`, `episode_end`, `years`, `status`. |
| threads | `thread:<slug>` | `thread.title` | `/arcs` | body: tagline, description, `Starter episodes: ...`. metadata: `kind: "thread"`. |
| canon | `guide:canon` (one doc) | `"Canon, filler and anime-original episodes"` | `/tracker` | body: what each of the three `CANON_TYPES` means (`CANON_TYPE_LABELS` + `CANON_TYPE_DESCRIPTIONS`), the episode count per type from `canonRangeTotal`, `MAX_EPISODE`, and the guide source `CANON_GUIDE_SOURCE`. metadata: `kind: "canon_guide"`, `max_episode`. |
| movies | `movie:<n>` | `MainlineMovie.english` | `/tracker` | body: `Movie <n> (<year>): <english> / <japanese>.` metadata: `movie_number`, `japanese`, `year`. `movieNumber: <n>`. `aliases`: lowercased japanese title, its tokens of length ≥ 3, and `movie <n>`. |
| gadgets | `gadget:<n>` where n is 1-based index | `gadget.name` | `null` | body: name, aliases, description. `aliases`: lowercased alias strings + their tokens ≥ 3. |

`GADGETS` holds the eight gadgets currently hardcoded in the system prompt
(`lib/chat/prompt.ts:155-164`): Voice-Changing Bowtie, Stun-Gun Wristwatch,
Power-Enhancing Kick Shoes, Solar-Powered Skateboard, Criminal Tracking Glasses,
Super Elastic Suspenders, Detective Boys Badge, Anywhere Soccer Ball Belt. Write each
one's `description` as one sentence in the same terms the prompt uses; the prompt block
itself is deleted in Plan 4, so the corpus text is what the bot will answer from.

**Test:** `lib/__tests__/corpus-curated.test.ts`. Assert:

- every builder is a pure function of its argument: `buildCharacterDocs([])` is `[]`,
  `buildCharacterDocs([character])` has length 1
- the assembled id set is unique across all seven builders (one `Set` over all ids —
  this is the invariant that matters, more than any single count)
- `buildCharacterDocs()` length is `CHARACTERS.length` and `>= 90`;
  `buildRelationshipDocs()` length is `<= RELATIONSHIPS.length` (skips are allowed) and `>= 150`;
  `buildArcDocs().length === STORY_ARCS.length`; `buildThreadDocs().length === RECURRING_THREADS.length`;
  `buildMovieDocs().length === MAINLINE_MOVIES.length`; `buildGadgetDocs()` length is exactly 8;
  `buildCanonDoc()` returns exactly one doc
- determinism: calling each builder twice yields `toEqual` identical arrays
- `contentHash`: identical for two docs whose metadata was built with different key
  insertion order; different when `body` changes; **identical** when `aliases` are
  reordered (they are sorted before hashing)
- `stableStringify` drops `undefined` values and sorts nested keys
- `toRankable`: given a doc whose metadata carries `victim`, `location`, `case_text` and
  `air_date`, the result exposes them as `victim`, `location`, `extra`, `air_date`, and
  maps `episodeNumber`/`movieNumber` onto `episode_number`/`movie_number`
- the Haibara character doc (`character:ai-haibara`) exists, its body mentions
  `Affiliation:`, and its `aliases` include `sherry` and the tokens `shiho`, `miyano`
- no character doc sets `episodeNumber` (the deliberate non-pollution rule from `types.ts`)
- at least one character doc's body contains `First appearance:` — proving debut metadata
  is folded in
- **the relationship skip branch**: call `buildRelationshipDocs(relationships, [])` with a
  two-character/two-relationship fixture — an empty character list means both endpoints are
  missing, so it returns `[]`; and with a list containing the first relationship's endpoints
  but not the second's, only `relationship:<first>` is emitted. (The real curated data has no
  dangling edges — verified: every `source`/`target` resolves to a character id — so this
  branch can only be covered from a fixture.)
- **implementation notes that must not be "fixed" back**: `CorpusDocumentSeed` is a
  `type` alias of `CorpusDocument` (an interface cannot re-export); arc metadata omits
  `episode_end` when `StoryArc.episodeEnd` is null, because `DocMetadata.episode_end` is
  `number | undefined` and undefined already means "ongoing" — the body carries `Ep 784+`;
  `formatEpisodeRange` takes a `StoryArc`, so call it directly.
- the movie doc for number 19 has `movieNumber === 19` and its title equals the
  `MAINLINE_MOVIES` entry's `english` (look it up, do not hardcode a title string)
- every doc has a non-empty `title`, and every id matches `/^[a-z_]+:[^\s]+$/`
- arc docs all have `url` starting with `/arcs/`; gadget docs have `url === null`

**Commit:** `feat(ai): build the curated half of the retrieval corpus`

---

### Task 3 — Tracker builders and corpus assembly

**Files:** `lib/ai/corpus/tracker.ts`, `lib/ai/corpus/build.ts`, `lib/__tests__/corpus-tracker.test.ts`

The database half. The row types below are **structural**, not `Database["public"]["Tables"][...]`,
for the same reason `lib/rate-limit-db.ts` declares its own client: the builders must be
testable without generated types, and `content_entries` rows carry more columns than the
corpus cares about.

```ts
// lib/ai/corpus/tracker.ts
export interface ContentEntryRow {
  id: string
  slug: string
  title: string
  type: string
  episode_number: number | null
  movie_number: number | null
  air_date: string | null
  canon_order: number | null
  release_order: number | null
  arc_id: string | null
  synopsis: string | null
  dcw_title: string | null
}

export interface CaseRow {
  id: string
  page_title: string
  case_index: number
  crime_type: string | null
  cause_death: string | null
  victim: string | null
  suspects: string | null
  location: string | null
  description: string | null
  entry_id: string | null
}

export function buildEntryDocs(
  entries: ContentEntryRow[],
  cases: CaseRow[] = [],
  options: { arcTitleById?: Map<string, string> } = {}
): CorpusDocument[]

export function buildCaseDocs(cases: CaseRow[]): CorpusDocument[]
```

Rules:

- Entry doc id `entry:<slug>`. `title` is `entry.title`. `url` `/tracker/<slug>`.
  `episodeNumber`/`movieNumber` set from the row (this IS that entry). `metadata` carries
  `slug`, `type`, `air_date`, `canon_order`, `release_order`, `synopsis`, `dcw_title`,
  `arc_slug` (the arc's title when `arcTitleById` has it, else null), and the entry's
  `crime_types` array if the row has one (`text[]`, optional on the structural type).
- `body` joins: synopsis, `dcw_title` (the DCW wiki title — a real alternate name the
  user may type), the type label, `Episode <n>`/`Movie <n>`, the air date, and the arc
  title. Keep it one readable sentence per line; the FTS index is over `title || body`.
- **`metadata.case_text`** (constraint D6): every case with this `entry_id` contributes
  `"<crime_type> case in <location>: victim <victim>; suspects <suspects>; <description>"`.
  Several cases join with `\n`. This is what `toRankable().extra` scores at weight 2 —
  the same signal the old `search.ts` injected.
- Case doc id `case:<page_title>#<case_index>` (constraint D1). `title` is
  `"<page_title> — case <case_index>"`. `url` `/cases`. `metadata` carries `page_title`,
  `case_index`, `crime_type`, `victim`, `suspects`, `location`, `cause_death`,
  `description`. `body` concatenates all of those with labels, so FTS can find
  "the case where the victim was strangled in a locked room".
- An entry with no cases still gets a doc. A case with no `entry_id` still gets a doc
  (it is retrievable in its own right). Neither builder sets `aliases`.

```ts
// lib/ai/corpus/build.ts
export interface CorpusInput {
  entries?: ContentEntryRow[]
  cases?: CaseRow[]
  characters?: Character[]
  relationships?: Relationship[]
  arcs?: StoryArc[]
  threads?: RecurringThread[]
  movies?: MainlineMovie[]
}

/** Every document the corpus holds, from every source. */
export function buildCorpusDocuments(input: CorpusInput = {}): CorpusDocument[]
```

`buildCorpusDocuments` concatenates, in a fixed order (catalog, cases, characters,
relationships, arcs, threads, canon, movies, gadgets), and **de-duplicates by id**, keeping
the first occurrence. Duplicate ids are a real hazard here — `entry:mov-19` and
`movie:19` are different ids by design, but a future source could collide — so the
de-duplication is the invariant, not a nicety. It also returns docs sorted by id within
each source group so the output is stable.

**Test:** `lib/__tests__/corpus-tracker.test.ts`. Build small fixtures by hand (one episode
with two linked cases, one case with no entry, one movie entry). Assert:

- `buildEntryDocs` on an empty array returns `[]`
- the episode's `extra` text through `toRankable` contains the victim's name, and
  `scoreEntry(toRankable(doc), ["<victim surname>"])` is greater than 0 — i.e. the D6
  injection actually reaches the scorer (mirror the existing test at
  `lib/__tests__/chat-query.test.ts:133-140`)
- `content_entries.episode_number = 500` produces `episodeNumber === 500` but
  `movie_number` stays null
- a movie row sets `movieNumber`, an episode row does not
- the case doc id is `case:<page_title>#<case_index>` and two cases on the same page
  produce two distinct ids
- `arc_title` metadata is resolved when `arcTitleById` provides it and is null otherwise
- `buildCorpusDocuments({ entries, cases })` starts with the concatenation of the two
  builders' outputs (the curated groups always follow), has unique ids, and is stable across
  two calls. Note that `buildCorpusDocuments` sorts each group by id while the two tracker
  builders preserve row order, so the identity holds on the result's head with an
  already-id-ordered fixture.
- `buildCorpusDocuments()` with no input returns only the curated docs (length
  `> 250`), which proves the default path cannot silently produce an empty corpus
- `buildCorpusDocuments({ entries: [dupA, dupB] })` where both rows share a slug keeps
  exactly one `entry:<slug>` doc
- **`crime_types` is part of the structural row type** (`crime_types?: string[]`) even
  though the plan's verbatim interface omits it, because the metadata rule requires reading
  it. And `metadata.arc_slug` may be a literal `null`: `DocMetadata.arc_slug` is
  `string | undefined`, so writing null goes through the metadata index signature via a
  small documented helper. Both are shipped behaviour — do not "fix" either back.

**Commit:** `feat(ai): build the tracker half of the retrieval corpus`

---

### Task 4 — Offline catalog fixture: the seed-SQL parser

**Files:** `lib/ai/corpus/seed-sql.ts`, `lib/__tests__/corpus-seed-sql.test.ts`

The eval gate in Task 15 must run in CI with no database (constraint 12). The catalog it
needs is already in the repo: `supabase/seed-content.sql` holds ~1,300 real rows of
`content_entries` (slug, title, type, episode/movie number, air date, canon order,
synopsis). Parsing it gives the eval real episode titles without a single network call.

```ts
export interface SeedEntry {
  slug: string
  title: string
  type: string
  episodeNumber: number | null
  movieNumber: number | null
  airDate: string | null
  canonOrder: number | null
  synopsis: string | null
}

export interface SeedParseResult {
  rows: SeedEntry[]
  /** Lines that began with "(" but did not yield a usable row. Must be 0 on the real file. */
  skipped: number
}

export function parseSeedEntries(sql: string): SeedParseResult
```

Implementation notes that matter:

- The file contains **two** insert statements with different shapes: a plain
  `insert into ... values (...)` block and, at the end, an
  `insert into ... select ... from (values (...))` block. Both put the same nine values
  in the same leading positions (`slug, title, type, episode_number, movie_number,
  air_date, ... , synopsis` at index 8), and the second block indents its rows. So: take
  any line whose `trimStart()` starts with `('` — **the quote matters**, because the second
  statement's column list and computation lines (`  (slug, title, ...`, `  (last.m + n) as
  canon_order, ...`, `  (last.m + n) as release_order`) also begin with `(` and are not
  rows; matching on a bare `(` makes `skipped` 3 instead of 0. Accept arity `>= 9`.
  A tuple that terminates with 9+ values but whose slug and title are not quoted strings is
  also counted as skipped — "did not yield a usable row" is what keeps the counter honest.
  Verified counts for the real file: 1,331 rows (1,317 + 14) and `skipped === 0`.
- `canonOrder` on the second statement's 14 rows is the block's local `n`, not the stored
  `canon_order` (SQL computes `last.m + n`). Inherent to a static parse. Do not write an
  eval expectation against `canonOrder` for those rows.
- Split the tuple with a character scanner, not a regex: values are single-quoted with
  `''` as the escape (`'President''s Daughter Kidnapping Case'`), and unquoted values are
  `NULL` or bare numbers. Track whether each value was quoted so `'NULL'` (the string)
  stays distinct from `NULL` (the null). A line with an unterminated quote is skipped and
  counted, never thrown.
- `episodeNumber`/`movieNumber`/`canonOrder` come from unquoted numeric values
  (`Number.parseInt`, `NaN` → null). `airDate` is a quoted ISO date.
- Do not attempt to handle arbitrary SQL. This parses one known, generated file; the
  arity guard and the `skipped` counter are what keep that honest.

**Test:** `lib/__tests__/corpus-seed-sql.test.ts`. Read the real file with
`readFileSync(new URL("../../supabase/seed-content.sql", import.meta.url), "utf8")` and assert:

- `rows.length >= 1300` and `skipped === 0`
- the `ep-001` row: slug `ep-001`, title `Roller Coaster Murder Case`, type `episode`,
  `episodeNumber === 1`, `movieNumber === null`, `airDate === "1996-01-08"`
- the `ep-002` row's title is `President's Daughter Kidnapping Case` — the `''` escape
- slugs are unique
- at least one row of `type === "movie"` with a non-null `movieNumber`, and at least one
  `type === "special"`
- the second insert statement is covered: a row for `special-lupin-vs-conan-2009` exists
  and its `synopsis` is non-null (that block is the only place those rows live)
- determinism: parsing twice deep-equals

Then, on hand-written SQL strings:

- a two-value tuple stays unparsed (arity guard) and increments `skipped`
- `('a','b','c',NULL,NULL,'1996-01-08',1,NULL,'NULL',...)` gives `synopsis === "NULL"`
  (the string), not null
- an unterminated quote (`('x', 'unterminated, ...`) is skipped, and the function does
  not throw
- empty input returns `{ rows: [], skipped: 0 }`
- a line with a trailing comma and one without both parse

**Commit:** `test(ai): parse the catalog seed into an offline fixture`

---

### Task 5 — Reciprocal rank fusion

**Files:** `lib/ai/retrieval/rrf.ts`, `lib/__tests__/retrieval-rrf.test.ts`

R1/R2/R3 produce ranked lists whose scores are not comparable (`ts_rank_cd` is not
`similarity`). RRF needs no normalisation, which is why the spec chose it.

```ts
export interface RankedList {
  /** Where this ranking came from: "entity" | "fts" | "fuzzy". */
  source: string
  ids: string[]
}

export interface FusedCandidate {
  id: string
  rrf: number
  /** Best rank this id achieved per source, 1-based. */
  ranks: Record<string, number>
}

/** The standard k from the RRF literature. */
export const DEFAULT_RRF_K = 50

export function reciprocalRankFusion(
  lists: RankedList[],
  options: { k?: number; limit?: number } = {}
): FusedCandidate[]
```

Rules:

- Contribution is `1 / (k + rank)` with **rank 1 for the first element**.
- An id repeated inside one list counts once (a ranking, not a ballot box).
- Sort by `rrf` desc, then by best rank asc, then by id asc — the last two make the
  output deterministic when scores tie, which they often do with small k.
- `limit` defaults to "everything".
- If the same `source` name appears in two lists, the **best** rank is kept in `ranks`
  while `rrf` still accumulates both contributions. Sources are expected to be distinct;
  this only stops a duplicate from corrupting the reported ranks.

**Test:** `lib/__tests__/retrieval-rrf.test.ts`. Assert:

- one list preserves its order and reports `ranks` of 1, 2, 3 …; the top id's `rrf` is
  `1 / (50 + 1)`
- **consensus beats a lone winner**: `[{source:"fts", ids:["a","b"]}, {source:"fuzzy", ids:["c","b"]}]`
  ranks `b` first, then `a`, then `c`; and `b.rrf > a.rrf`
- an id repeated in one list contributes once: `[{source:"fts", ids:["a","a","b"]}]` gives
  `a.rrf === 1 / 51` and `b.ranks.fts === 3`
- `ranks` carries an entry per source the id appeared in
- `limit: 1` returns only the first candidate
- an empty list array returns `[]`; a list with no ids contributes nothing
- a perfect tie is broken by id: `[{ids:["a","b"]}, {ids:["b","a"]}]` orders `a` before `b`
- `k: 0` changes the order relative to `k: 50` for a case where a lone rank-1 hit ties a
  rank-2-in-two-lists hit (assert the two orderings differ, and say why in a comment)

**Commit:** `feat(ai): fuse ranked retrieval lists with RRF`

---

### Task 6 — Document source port: static and Supabase

**Files:** `lib/ai/retrieval/source.ts`, `lib/__tests__/retrieval-source.test.ts`

One port, two adapters. Production uses Postgres through three RPCs; every test and the
eval gate use the in-process index (constraint D5). Keeping them behind one interface is
what makes the ladder testable at all.

```ts
export interface SearchHit {
  id: string
  score: number
}

export interface DocumentSource {
  /** R1. `names` are lowercase; a hit is an exact title, an alias, or a title substring. */
  entity(input: { numbers: number[]; names: string[]; limit: number }): Promise<SearchHit[]>
  /** R2. Token AND, like websearch_to_tsquery. A query with no usable tokens matches nothing. */
  fullText(query: string, limit: number): Promise<SearchHit[]>
  /** R3. Approximate trigram similarity on titles, threshold ~0.3. */
  fuzzy(query: string, keywords: string[], limit: number): Promise<SearchHit[]>
  /** Hydration by id. Unknown ids are omitted. */
  fetch(ids: string[]): Promise<CorpusDocument[]>
}

export function createStaticSource(docs: CorpusDocument[]): DocumentSource
export function createSupabaseSource(client: DocsRpcClient): DocumentSource
export function rowToDocument(row: Record<string, unknown>): CorpusDocument
export function trigrams(value: string): Set<string>
export function trigramSimilarity(a: string, b: string): number
```

**Static source** behaviour, all three branches over `tokenize`/`normalizeText` from
`lib/chat/query.ts`:

- `entity`: score 3 for a number match on `episodeNumber`/`movieNumber`, 2 for an exact
  normalized title, 1.5 for an alias overlap, 1 for a normalized-title substring; a doc
  keeps its **best** score. Sort by score desc, id asc.
- `fullText`: tokenize the query; a doc qualifies only if **every** token appears in its
  title-or-body token set (this is the AND semantics of `websearch_to_tsquery`). Score is
  2 per token found in the normalized title plus 1 per token found only in the body.
  No tokens → empty result, never "return everything".
- `fuzzy`: `max(trigramSimilarity(title, query), max over keywords of length >= 3)`,
  keeping hits `>= 0.3` — the same threshold as Postgres's `pg_trgm.similarity_threshold`
  default, so the offline approximation agrees with production on what counts as a hit.
- `trigrams` pads with two leading and one trailing space (what `show_trgm` does) and
  returns 3-character grams; `trigramSimilarity` is `|A ∩ B| / |A ∪ B|`.

**Supabase source**: `entity` → `rpc("ai_docs_entity", { p_numbers, p_names, p_limit })`,
`fullText` → `rpc("ai_docs_fts", { p_query, p_limit })`,
`fuzzy` → `rpc("ai_docs_fuzzy", { p_query, p_keywords, p_limit })`,
`fetch` → `from("ai_documents").select("*").in("id", ids)`. Every method **catches its own
error**, logs one line (`console.error("[ai-retrieval] <branch> failed", message)`), and
returns `[]` — a broken retrieval branch must degrade, never fail the request. Never throw.

```ts
export interface DocsRpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): Promise<{ data: SearchHit[] | null; error: { message: string } | null }>
  from(table: string): {
    select(columns: string): {
      in(
        column: string,
        values: string[]
      ): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
    }
  }
}
```

`rowToDocument` maps the row's snake_case columns to `CorpusDocument` (`episode_number` →
`episodeNumber`, `movie_number` → `movieNumber`, `content_hash` and `fts` dropped,
`metadata` defaulted to `{}`, `aliases` defaulted to `[]`). It must tolerate a `metadata`
value that arrives as a JSON string rather than an object.

**Test:** `lib/__tests__/retrieval-source.test.ts`. Build a five-document fixture: one
episode doc (`entry:ep-001`, `episodeNumber: 1`, title `Roller Coaster Murder Case`), one
character doc (`character:ai-haibara`, aliases `["sherry","shiho","miyano"]`), one
relationship doc, one movie doc (`movie:19`, `movieNumber: 19`), one gadget doc. Assert:

- `entity({ numbers: [1], names: [], limit: 10 })` returns `entry:ep-001` first;
  `entity({ numbers: [], names: ["ai haibara"], limit: 10 })` finds the character;
  `entity({ numbers: [], names: ["sherry"], limit: 10 })` finds it via alias;
  `entity({ numbers: [999], names: [], limit: 10 })` returns `[]`
- `fullText("roller coaster murder", 10)` returns `entry:ep-001`; `fullText("coaster
  helicopter", 10)` returns `[]` (AND, not OR); `fullText("the of and", 10)` returns `[]`
  (all stopwords)
- `fullText` never returns a doc that only partially matches a two-token query
- `fuzzy("haibarra", ["haibarra"], 10)` finds the Haibara doc (typo tolerance), while
  `fullText("haibarra", 10)` does not — the point of having both branches
- `fuzzy` respects the 0.3 threshold: a nonsense query returns `[]`
- `trigramSimilarity("haibara","haibara") === 1` and `trigramSimilarity("haibara","xyzzy") < 0.3`
- `fetch(["movie:19","nope"])` returns one doc; `fetch([])` returns `[]`
- the static source returns `[]` for an empty corpus
- **Supabase adapter**: a fake client records calls; assert `entity` calls
  `ai_docs_entity` with `p_numbers`/`p_names`/`p_limit`, `fullText` calls `ai_docs_fts`
  with the raw query, `fuzzy` passes the keyword array, and `fetch` uses `.in("id", ids)`
- **Supabase adapter failure isolation**: with a client whose `rpc` returns
  `{ data: null, error: { message: "boom" } }`, all three search methods resolve to `[]`
  and do not reject. Same for `fetch` when `.in()` returns an error.
- `rowToDocument` converts a snake_case row, tolerates a string `metadata`, and defaults
  missing `aliases` to `[]`

**Commit:** `feat(ai): add a document source port with static and Supabase adapters`

---

### Task 7 — Candidate re-ranking through the existing scorer

**Files:** `lib/ai/retrieval/candidates.ts`, `lib/__tests__/retrieval-candidates.test.ts`

The spec's §6.3 decision: FTS generates candidates, then **the existing scorer decides**.
`rankEntries` is called with `fieldsOf: toRankable`, exactly as `search.ts` already does for
linked case text.

```ts
export interface ScoredDoc {
  doc: CorpusDocument
  score: number
  rrf: number
  origins: string[]
}

export function rankCandidates(
  candidates: FusedCandidate[],
  docs: CorpusDocument[],
  keywords: string[],
  options: {
    limit?: number
    numbers?: number[]
    preferRecent?: boolean
    preferEarliest?: boolean
  } = {}
): ScoredDoc[]
```

Ordering rule, and the one non-obvious part of this task:

1. Documents whose scorer result is `> 0`, in `rankEntries` order (score desc, then the
   chronological preference, then air date), each carrying its `rrf` and `origins`.
2. **Then** the candidates the scorer gave 0 — ordered by `rrf` desc — because a document
   retrieved by the fuzzy branch is a *typo tolerance* hit: the query says "haibarra", the
   document says "haibara", `scoreEntry` scores 0, and filtering it out here would throw
   away the only reason R3 exists. They stay, ranked below everything that scored.
3. Truncate to `limit` (default 12) after both groups are concatenated.

Candidates whose id is not in `docs` are ignored (hydration can legitimately miss).

**Test:** `lib/__tests__/retrieval-candidates.test.ts`. Assert:

- **the fuzzy-survivor rule**: a candidate that scores 0 survives with `score === 0` and
  appears after every scored doc
- order within the scored group follows `rankEntries` (a doc matching two keywords beats a
  doc matching one)
- a doc matching an exact episode number outranks a title-only match (`numbers` option)
- `preferEarliest: true` puts the earlier-air-date doc first when both have score > 0
- `rrf` breaks ties between two identical scores (higher `rrf` first)
- `origins` lists both sources for an id that came from `fts` and `fuzzy`
- unknown candidate ids are ignored rather than throwing
- `limit: 1` returns the single best
- an empty candidate list returns `[]`, and an empty `docs` list returns `[]`

**Commit:** `feat(ai): re-rank fused candidates with the tracker scorer`

---

### Task 8 — The escalation ladder

**Files:** `lib/ai/retrieval/ladder.ts`, `lib/__tests__/retrieval-ladder.test.ts`

Cheapest-first, stop at the evidence threshold, hard wall-clock budget, every round
recorded. This is the module Plan 4's orchestrator calls.

```ts
export const EVIDENCE_THRESHOLD = 6
export const LADDER_BUDGET_MS = 1500

export interface RetrievalRequest {
  query: string
  /** Defaults to tokenize(query, 8) when omitted. */
  keywords?: string[]
  /** Defaults to extractNumbers(query). */
  numbers?: number[]
  /** Defaults to prefersRecent(query) / prefersEarliest(query). */
  preferRecent?: boolean
  preferEarliest?: boolean
  /** True when the question needs lore the corpus cannot hold, which is the only
   *  reason to spend a wiki call. */
  needsLore?: boolean
  limit?: number
}

export interface LadderStep {
  round: 1 | 2 | 3 | 4
  branch: "entity" | "fts" | "fuzzy" | "wiki"
  hits: number
  ms: number
  /** null when the round ran; a reason when it did not. */
  skipped: string | null
}

export interface WikiEvidence {
  title: string
  url: string
  extract: string
  source: "dcw" | "wikipedia"
}

export interface LadderResult {
  docs: ScoredDoc[]
  wiki: WikiEvidence[]
  steps: LadderStep[]
  /** "retrieval_budget" when a round was skipped for time; null otherwise. */
  degraded: string | null
}

export interface LadderDeps {
  source: DocumentSource
  wiki?: (query: string) => Promise<WikiEvidence[]>
  now?: () => number
  budgetMs?: number
  threshold?: number
}

export async function runLadder(
  request: RetrievalRequest,
  deps: LadderDeps
): Promise<LadderResult>
```

Behaviour, in order:

1. Derive `keywords` / `numbers` / `preferRecent` / `preferEarliest` from the query with
   `lib/chat/query.ts` helpers when the caller did not supply them.
2. `names` for R1 is `[normalizeText(query), ...keywords]`.
3. **R1 and R2 run in parallel** (`Promise.all`), each timed, each wrapped so a rejecting
   branch becomes `hits: 0` plus a recorded step, never a thrown error. This is defect 2's
   fix: "retrieval broke" stops being indistinguishable from "nothing matched".
4. Fuse with `reciprocalRankFusion([{source:"entity",...},{source:"fts",...}])`.
5. If the fused candidate count is `< threshold` and the budget is not spent → R3, then
   re-fuse all three lists. Skipped for budget → step `skipped: "budget"`, and `degraded`
   becomes `"retrieval_budget"`.
6. If still `< threshold` **and** `needsLore` is true and the budget is not spent, and a
   `wiki` dependency was provided → R4. Otherwise the R4 step records why it was skipped —
   one of `"no_lore_needed"`, `"budget"`, or `"no_wiki_source"`.
7. Hydrate the fused ids via `source.fetch`, then `rankCandidates` with the request's
   `keywords` / `numbers` / chronological flags, capped at `limit` (default 12).
8. Return `docs`, `wiki`, `steps`, `degraded`.

**`steps` is the contiguous prefix of rounds the ladder engaged with**, not always four
entries: R1 and R2 are always present; R3 appears only when the threshold was unmet after
them (either having run, or with `skipped: "budget"`); R4 appears only when the threshold
was still unmet after R3. So "evidence was already sufficient" is not a step — there is no
`"enough_evidence"` reason, because in that case the round is simply absent. A round that
was skipped reports `hits: 0` and `ms: 0`. `hits` is the branch's raw hit count (the number
of extracts for R4). "Budget spent" means `elapsed >= budgetMs`. Rejection isolation
(`hits: 0`, `skipped: "error"`, ladder still resolves) applies to R3, R4 and hydration as
well as R1/R2, and never sets `degraded` — only a budget skip does that.

The threshold counts **distinct candidate ids**, not documents: that is what R1+R2
produced, and re-counting after hydration would let a hydration miss silently re-run the
ladder.

**Test:** `lib/__tests__/retrieval-ladder.test.ts`, with a fake source that records calls
and a controllable `now()`:

- R1+R2 produce ≥ 6 candidates → `steps` has exactly two entries, `fuzzy`/`wiki` are never
  called, `degraded` is null
- R1+R2 produce 2, R3 pushes it to 6 → three steps, no wiki call
- R1+R2 produce 2, R3 produces nothing, `needsLore: false` → the R4 step exists with
  `skipped: "no_lore_needed"`
- same but `needsLore: true` with a wiki dep → R4 runs, `wiki` evidence is returned, and
  the step's `hits` is the number of extracts
- `needsLore: true` with no wiki dep → R4 step `skipped: "no_wiki_source"`
- **budget**: a `now()` that jumps past `budgetMs` between rounds → R3 skipped with
  `skipped: "budget"` and `degraded === "retrieval_budget"`
- **error isolation**: a source whose `entity` rejects → the ladder still resolves, the
  entity step records 0 hits, the fts results are returned, and `degraded` stays null
- every branch failure is visible in `steps` (assert the entity step exists even when it failed)
- the final `docs` length never exceeds `limit`, and `limit: 2` is honoured
- keywords are derived from the query when omitted (`"who is Ai Haibara"` → R3 receives a
  keyword array containing `haibara`), and a supplied `keywords` array wins verbatim
- `steps` always covers rounds 1…N in ascending order with `ms >= 0`

**Commit:** `feat(ai): add the retrieval escalation ladder`

---

### Task 9 — Deterministic tools

**Files:** `lib/ai/tools/classify-episode.ts`, `lib/ai/tools/arc-for-range.ts`,
`lib/ai/tools/lookup-character.ts`, `lib/__tests__/ai-tools-deterministic.test.ts`

Three tools answer from tables, not from a model. The spec singles out `classifyEpisode`:
"is episode 500 filler?" is currently model guesswork and becomes a lookup, so the answer
is correct by construction.

```ts
// lib/ai/tools/classify-episode.ts
import { CANON_TYPE_LABELS, MAX_EPISODE, canonTypeForEpisode, type CanonType } from "@/lib/canon-guide"
import { STORY_ARCS, type StoryArc } from "@/lib/arcs-guide"

export interface EpisodeClassification {
  episode: number
  /** False when the number is outside 1..MAX_EPISODE or not an integer. */
  valid: boolean
  canonType: CanonType | null
  canonLabel: string | null
  arcs: Array<{ slug: string; title: string }>
  /** One sentence, already correct: "Episode 500 is Manga Canon." */
  sentence: string
}

export function classifyEpisode(episode: number, arcs: StoryArc[] = STORY_ARCS): EpisodeClassification
```

```ts
// lib/ai/tools/arc-for-range.ts
export interface ArcOverlap {
  slug: string
  title: string
  episodeStart: number
  episodeEnd: number
  overlapStart: number
  overlapEnd: number
}

/** Arcs overlapping [start, end], in arc order. Swaps a reversed range. */
export function arcForRange(
  start: number,
  end: number = start,
  arcs: StoryArc[] = STORY_ARCS
): ArcOverlap[]
```

An arc with `episodeEnd: null` is ongoing and extends to `MAX_EPISODE`
(`ARC_DB_ROWS` in `lib/arcs-guide.ts:267` uses the stale literal `1209`; do not copy it —
`canon-guide.ts` is the authority at 1212). The returned `episodeEnd` is the resolved end,
not the null.

```ts
// lib/ai/tools/lookup-character.ts
import { CHARACTERS, RELATIONSHIPS, RELATIONSHIP_META, type Character, type Relationship, type RelationshipType } from "@/lib/characters-guide"

export interface CharacterRelationshipView {
  id: string
  type: RelationshipType
  /** RELATIONSHIP_META[type].label */
  label: string
  direction: "outgoing" | "incoming"
  otherId: string
  otherName: string
  detail: string | null
}

export interface CharacterLookup {
  character: Character
  docId: string
  aliases: string[]
  debut: { episode: number | null; movie: number | null; label: string | null; spoiler: string }
  relationships: CharacterRelationshipView[]
}

/** Resolution order: exact id, exact normalized name, exact alias, then a unique
 *  substring of a name. Returns null rather than guessing between two candidates. */
export function lookupCharacter(
  query: string,
  characters: Character[] = CHARACTERS,
  relationships: Relationship[] = RELATIONSHIPS
): CharacterLookup | null
```

Substring resolution must be **unambiguous**: "kudo" matches both Yusaku Kudo and
"Conan Edogawa / Shinichi Kudo", so it returns null rather than picking one. Resolution is
case- and punctuation-insensitive via `normalizeText`.

**Test:** `lib/__tests__/ai-tools-deterministic.test.ts`. Assert:

- `classifyEpisode(1).canonType === "manga_canon"`, `classifyEpisode(6).canonType === "filler"`,
  `classifyEpisode(1187).canonType === "anime_canon"` — these three come from the ranges'
  own definitions: assert them against `canonTypeForEpisode` rather than literals where the
  number is not structurally obvious, but keep at least one literal anchor per type
- every integer from 1 to `MAX_EPISODE` yields a non-null `canonType` and `valid: true`
  (a 1,212-iteration loop — this is the same partition invariant `validateCanonPartition()`
  guards, checked from the tool's side)
- `classifyEpisode(0)`, `classifyEpisode(-1)`, `classifyEpisode(MAX_EPISODE + 1)`,
  `classifyEpisode(1.5)` and `classifyEpisode(NaN)` each give `valid: false`,
  `canonType: null`, and a `sentence` that says the number is outside the tracked range
- `sentence` contains the label for a valid episode (`"Manga Canon"`, `"Filler"`,
  `"Anime Canon"`)
- arc membership is consistent with `STORY_ARCS`: for an arc with a known
  `episodeStart`, `classifyEpisode(arc.episodeStart).arcs` contains that slug; for a number
  no arc covers, `arcs` is `[]`
- `arcForRange(1, 50)` returns exactly the arcs whose range overlaps, computed from
  `STORY_ARCS` in the test (no hardcoded slug)
- `arcForRange(500, 100)` equals `arcForRange(100, 500)`
- an arc with `episodeEnd: null` is reported with `episodeEnd === MAX_EPISODE`
- `arcForRange` on a range no arc covers returns `[]`
- `lookupCharacter("ai-haibara")`, `lookupCharacter("Ai Haibara")` and
  `lookupCharacter("ai haibara")` all resolve to the same character, with
  `docId === "character:ai-haibara"`
- aliases are lowercased in the result, and `debut` carries the `SPOILER_DATA` values
- relationships include both directions: for a character that is a `target` in
  `RELATIONSHIPS`, at least one entry has `direction: "incoming"` and `otherName` is the
  source character's name
- an unknown name returns null; an ambiguous substring (`"kudo"`) returns null
- purity: a one-character, one-relationship fixture array is the only data consulted

**Commit:** `feat(ai): add the deterministic retrieval tools`

---

### Task 10 — Source-backed search tools

**Files:** `lib/ai/tools/search-catalog.ts`, `lib/ai/tools/search-cases.ts`,
`lib/__tests__/ai-tools-search.test.ts`

```ts
import type { DocumentSource } from "@/lib/ai/retrieval/source"
import type { ScoredDoc } from "@/lib/ai/retrieval/candidates"

export interface SearchToolOptions {
  /** Default 12. */
  limit?: number
  /** Candidate pool pulled from the source before filtering. Default 80. */
  candidates?: number
}

export async function searchCatalog(
  query: string,
  source: DocumentSource,
  options?: SearchToolOptions
): Promise<ScoredDoc[]>

export async function searchCases(
  query: string,
  source: DocumentSource,
  options?: SearchToolOptions
): Promise<ScoredDoc[]>
```

Both: derive `keywords = tokenize(query, 8)`, `numbers = extractNumbers(query)`,
`preferRecent` / `preferEarliest` from the query helpers; run `entity` (only when
`numbers.length > 0`), `fullText`, **and `fuzzy`** against the source with the candidate
limit; fuse all three lists with RRF; hydrate; `rankCandidates`; then keep only documents
whose `source` matches (`content_entries` for catalog, `dcw_cases` for cases) and truncate
to `limit`.

**Fuzzy belongs here even though the ladder only reaches R3 when the threshold is unmet.**
A tool call is a *narrow lookup*, not the whole ladder: without the fuzzy list, the typo
test ("roller coaser" must find "Roller Coaster Murder Case") cannot pass at all, because
strict token-AND matches nothing and the query has no number for the entity branch. The
cost is one extra RPC per tool invocation; the alternative is a tool that cannot tolerate a
misspelling the ladder tolerates.

**Do not let `rankCandidates` truncate before the filter.** Pass it the candidate pool size
as its `limit` and apply the caller's `limit` only after the source filter — otherwise the
mixed corpus's top 12 can be entirely characters and arcs, and a catalog query would return
`[]` while the matching episode sits at rank 13. The filter-then-truncate order is the
behaviour the tests pin.

The typo test asserts the retrievable fact — the hit's `origins` contains `"fuzzy"` — rather
than the zero-score survival rule: `roller` is a substring of that title, so `scoreEntry`
scores it above 0 and it lands in the scored group. The zero-score rule keeps its coverage in
`lib/__tests__/retrieval-candidates.test.ts` (Task 7).

The source filter is applied **after** ranking, because the Phase 2 RPCs have no source
parameter (Task 1's signature) and the corpus is one index. Record the limitation in a
comment: with 80 candidates the mixed-corpus dilution is small, and adding a `p_source`
argument to the three RPCs is a later, additive change (Plan 4) if measurements call for it.

**Test:** `lib/__tests__/ai-tools-search.test.ts`, over a static source built from a mixed
fixture (at least two episode docs, two case docs, one character doc, one arc doc):

- `searchCatalog("roller coaster murder")` returns only `entry:` docs, with the matching
  episode first
- `searchCases("<a victim name from the fixture>")` returns only `case:` docs
- a query whose only match is a character doc returns `[]` from `searchCatalog` — the
  filter is real, not incidental
- `searchCatalog` with a typo (`"roller coaser"`) still finds the episode — the fuzzy
  branch survives `rankCandidates` (this is the regression test for the zero-score rule)
- `searchCatalog("episode 1", source)` ranks the `episodeNumber: 1` doc first (entity
  branch + `BONUS_EXACT_NUMBER`)
- `limit: 1` returns one doc; an unmatched query returns `[]`
- neither tool throws when the source rejects: wrap a rejecting source and assert `[]`
  is returned (retrieval failure must not become a 500)

**Commit:** `feat(ai): add catalog and case search tools`

---

### Task 11 — Wiki cache with a time box

**Files:** `lib/ai/wiki-cache.ts`, `lib/__tests__/ai-wiki-cache.test.ts`

The live MediaWiki call stops being an always-on blocking dependency: it moves behind a
cache and a wall-clock box, and it is only reached when the ladder says the question needs
lore the corpus cannot hold.

`WikiEvidence` is declared in `lib/ai/retrieval/ladder.ts` (Task 8). Import the **type**
from there — a type-only import, and the ladder never imports this module, so there is no
runtime cycle.

```ts
import type { WikiEvidence } from "@/lib/ai/retrieval/ladder"

export interface WikiCacheRow {
  cacheKey: string
  source: string
  title: string
  extract: string
  url: string | null
  fetchedAt: number
  /** Epoch ms; null means "never expires". */
  expiresAt: number | null
}

export interface WikiCacheClient {
  from(table: string): {
    select(columns: string): {
      in(
        column: string,
        values: string[]
      ): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
    }
    upsert(
      values: Record<string, unknown>[],
      options?: { onConflict?: string }
    ): Promise<{ error: { message: string } | null }>
  }
}

export interface WikiCacheDeps {
  client?: WikiCacheClient | null
  /** Injected so tests never touch the network. Production passes searchDcwWiki. */
  fetcher?: ((query: string) => Promise<WikiEvidence[]>) | null
  now?: () => number
  /** Default 7 days. */
  ttlMs?: number
  /** Default 1200ms — the spec's per-round wiki ceiling. */
  timeoutMs?: number
}

export interface WikiCache {
  lookup(query: string): Promise<WikiEvidence[]>
  put(query: string, evidence: WikiEvidence[]): Promise<void>
}

export function wikiCacheKey(query: string, source: string): string
export function createWikiCache(deps?: WikiCacheDeps): WikiCache
```

Rules:

- `wikiCacheKey(query, source)` is `wiki:<source>:<normalizeText(query)>` — punctuation and
  case must not produce a second entry for the same question.
- `lookup`: read this query's rows for both sources; serve unexpired rows without calling
  the fetcher. Otherwise call the fetcher inside `Promise.race` against a `timeoutMs`
  timer. On timeout, rejection, or a missing fetcher: return whatever **stale** rows exist,
  else `[]`. Then write the fresh evidence back (`put`), ignoring write errors after logging
  them.
- Every path resolves. Nothing in this module throws — a wiki outage degrades an answer, it
  does not fail a request.
- `createWikiCache()` with no client and no fetcher is legal and returns `[]`.

**Test:** `lib/__tests__/ai-wiki-cache.test.ts` with a fake client, a fake fetcher and a
controllable `now()`:

- a miss calls the fetcher, returns its evidence, and issues an upsert whose row has
  `cache_key`, `source`, `extract`, and an `expires_at` of `now + ttlMs`
- a fresh hit does **not** call the fetcher and returns the cached extract
- an expired row (`expires_at < now`) calls the fetcher again
- a fetcher that never resolves, with `timeoutMs: 10`, resolves to `[]` in roughly that
  time (assert `Date.now() - started < 500` so the test cannot hang CI on a missing timeout)
- a rejecting fetcher resolves to `[]`; with a **stale** row present it resolves to that row
- a client whose read errors still calls the fetcher and returns its evidence
- a client whose upsert errors still returns the evidence
- no client at all: fetch-only, still no throw
- `wikiCacheKey("Who is Haibara?", "dcw") === wikiCacheKey("who is haibara", "dcw")`
- evidence with a blank extract is still cached as returned (filtering is the tool's job,
  not the cache's)

**Commit:** `feat(ai): cache wiki lookups behind a time box`

---

### Task 12 — wikiLookup, nextUnwatched, and the tool registry

**Files:** `lib/ai/tools/wiki-lookup.ts`, `lib/ai/tools/next-unwatched.ts`,
`lib/ai/tools/index.ts`, `lib/__tests__/ai-tools-registry.test.ts`

```ts
// lib/ai/tools/wiki-lookup.ts
import type { WikiCache } from "@/lib/ai/wiki-cache"
import type { WikiEvidence } from "@/lib/ai/retrieval/ladder"

/** Cached wiki extracts for a topic, tidiest first. Never throws. */
export async function wikiLookup(topic: string, cache: WikiCache, limit = 3): Promise<WikiEvidence[]>
```

Rules: drop extracts shorter than 40 characters (a stub is worse than nothing), de-duplicate
by `url`, keep the first `limit`. An empty topic returns `[]` without touching the cache.

```ts
// lib/ai/tools/next-unwatched.ts
export interface WatchClient {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string
      ): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
      order(
        column: string,
        options: { ascending: boolean }
      ): {
        limit(count: number): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
      }
    }
  }
}

export interface NextUnwatchedItem {
  id: string
  slug: string
  title: string
  episodeNumber: number | null
  airDate: string | null
}

/** The user's next episodes in canon order, skipping what they have watched. */
export async function nextUnwatched(
  client: WatchClient,
  userId: string,
  limit = 5
): Promise<NextUnwatchedItem[]>
```

Implementation: read `watch_status.content_id` for the user (paged, cap 2,000 ids) and
`content_entries` rows of `type = "episode"` ordered by `canon_order` ascending, paged until
`limit` unwatched rows have been collected or 3 pages of 500 are exhausted. Filtering in
SQL would need a `not.in` filter whose URL grows with the watch history; the client-side
filter with a page cap is bounded and predictable. Document that trade-off. Errors on either
read resolve to `[]`.

```ts
// lib/ai/tools/index.ts
export const TOOL_NAMES = [
  "search_catalog",
  "search_cases",
  "lookup_character",
  "classify_episode",
  "arc_for_range",
  "next_unwatched",
  "wiki_lookup",
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

export interface ToolContext {
  source: DocumentSource
  wiki: WikiCache
  /** Required by next_unwatched only. */
  watch?: { client: WatchClient; userId: string }
}

export interface ToolRequest {
  name: ToolName
  args: Record<string, unknown>
}

export interface ToolResult {
  name: ToolName
  ok: boolean
  ms: number
  /** Corpus documents the tool used, for the citation contract. */
  docs: CorpusDocument[]
  /** Structured payload for the assembler; never handed to the model raw. */
  data: unknown
  error: string | null
}

export async function runTools(requests: ToolRequest[], ctx: ToolContext): Promise<ToolResult[]>
```

Dispatch rules:

| Tool | args | docs returned | `data` |
| --- | --- | --- | --- |
| `search_catalog` | `query: string`, `limit?: number` | the hits | hit ids with scores |
| `search_cases` | `query: string`, `limit?: number` | the hits | hit ids with scores |
| `lookup_character` | `name: string` | the fetched `character:<id>` doc (plus each other character's doc, capped at 6) | the `CharacterLookup` |
| `classify_episode` | `episode: number` | the fetched `guide:canon` doc, plus the overlapping arcs' docs | the `EpisodeClassification` |
| `arc_for_range` | `start: number`, `end?: number` | the fetched `arc:<slug>` docs | the `ArcOverlap[]` |
| `next_unwatched` | `limit?: number` | `[]` | the `NextUnwatchedItem[]` |
| `wiki_lookup` | `topic: string`, `limit?: number` | `[]` | the `WikiEvidence[]` |

`runTools` runs every request in parallel, preserves the request order in its result array,
and never rejects: a tool that throws becomes `{ ok: false, error: message }`, and an
unknown name or a missing/mistyped argument becomes `ok: false` with a message naming the
tool and the argument. A deterministic tool whose answer needs no documents still succeeds
with `docs: []`. `next_unwatched` without `ctx.watch` fails with a clear message.

**Shipped refinements to record (do not "fix" them back):**

- `WatchClient.eq` returns a thenable that also chains (`WatchQuery extends Promise<WatchResult>`),
  because the real chain is `.eq("type","episode").order("canon_order", { ascending: true }).limit(n)`
  and PostgREST's builder is thenable. Since the interface has no `.range()`, the "3 pages of
  500" rule is implemented as a **widening window** — `limit(500)` → `limit(1000)` → `limit(1500)`,
  stopping on a short page or once enough unwatched rows exist.
- `lookup_character` with no match returns `ok: true, data: null, docs: []` — the tool ran and
  found nobody. `ok: false` is reserved for the failures named above. **Plan 4's assembler must
  treat `data: null` as a miss.**
- `lookup_character` returns the character's own doc plus at most six neighbour docs (max 7).
- `search_catalog` / `search_cases` swallow retrieval failures by their own contract, so they
  never produce `ok: false`; the rejecting-source test therefore exercises `lookup_character`
  and `arc_for_range`.

**Test:** `lib/__tests__/ai-tools-registry.test.ts`. Assert:

- `TOOL_NAMES` has exactly 7 entries and every name dispatches without "unknown tool"
- each tool's happy path returns the expected `data` shape (assert `classify_episode`
  returns a `canonLabel`, `lookup_character` returns a `CharacterLookup`, `arc_for_range`
  returns an array)
- `lookup_character` puts the `character:<id>` doc in `docs` (fetched from the source, so
  the citation contract has something to cite)
- `classify_episode` includes `guide:canon` in `docs`
- `wiki_lookup` returns `data` from a fake cache and `docs: []`
- `next_unwatched` without `ctx.watch` → `ok: false` with a message mentioning the tool
- `next_unwatched` with a fake watch client returns the fixture's unwatched episodes
- an unknown tool name → `ok: false`, `error` mentions the name, and the other results in
  the same batch are unaffected
- a tool whose source rejects → `ok: false` with the message, `ms >= 0`, and no rejection
- results keep request order even when the second call resolves before the first
- a mistyped argument (`classify_episode` with `{ episode: "five" }`) → `ok: false`

**Commit:** `feat(ai): add the retrieval tool registry and runner`

---

### Task 13 — Corpus ingestion over the database

**Files:** `lib/ai/corpus/collect.ts`, `lib/ai/corpus/ingest.ts`,
`lib/__tests__/corpus-ingest.test.ts`

Two halves: read the tracker rows (`collect`), and write the documents (`ingest`). Both take
a structural client so both are testable with a fake — constraint 11.

```ts
// lib/ai/corpus/collect.ts
export interface CollectClient {
  from(table: string): {
    select(columns: string): {
      range(
        from: number,
        to: number
      ): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
    }
  }
}

export interface CollectOptions {
  /** Default 500. PostgREST caps a response at 1,000 rows. */
  pageSize?: number
  /** Default 20_000 — a runaway guard, not an expectation. */
  maxRows?: number
}

export async function collectTrackerRows(
  client: CollectClient,
  options?: CollectOptions
): Promise<{ entries: ContentEntryRow[]; cases: CaseRow[] }>

export async function collectCorpus(
  client: CollectClient,
  options?: CollectOptions
): Promise<CorpusDocument[]>
```

`collectTrackerRows` pages `content_entries` and `dcw_cases` with `.range(from, to)` until a
short page arrives or `maxRows` is reached, and maps each row onto the structural types
(`Number(...)` for numbers, `null` for missing, `String(...)` for text). **A read error
throws** — an ingestion run that silently drops the 1,300-entry catalog and reports success
is worse than a failed run. `collectCorpus` calls `collectTrackerRows` and then
`buildCorpusDocuments`.

```ts
// lib/ai/corpus/ingest.ts
export interface IngestClient {
  from(table: string): {
    select(columns: string): {
      range(
        from: number,
        to: number
      ): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
    }
    upsert(
      values: Record<string, unknown>[],
      options?: { onConflict?: string }
    ): Promise<{ error: { message: string } | null }>
  }
}

export interface IngestReport {
  total: number
  inserted: number
  updated: number
  unchanged: number
  /** Rows actually sent to Postgres. 0 for a dry run. */
  upserted: number
  ms: number
}

export async function ingestCorpus(deps: {
  client: IngestClient
  documents: CorpusDocument[]
  now?: () => number
  /** Default 200. */
  chunkSize?: number
  dryRun?: boolean
}): Promise<IngestReport>
```

Rules:

- Read the existing `(id, content_hash)` pairs first, paged, into a `Map`.
- `contentHash(doc)` decides: absent → inserted, different → updated, equal → unchanged.
- Upsert the changed docs in `chunkSize` batches with `onConflict: "id"`, mapping each
  document to a row: `id, source, title, body, url, metadata, episode_number,
  movie_number, aliases, content_hash, updated_at`. Never write `fts` — it is a generated
  column and Postgres rejects it.
- `updated_at` comes from the injected `now()` as an ISO string.
- An upsert error **throws** (the route turns it into a 500). A half-written corpus that
  reports success would be discovered as stale answers weeks later.
- `dryRun` computes every count and sends nothing.
- Re-running over an unchanged corpus performs zero writes and reports
  `unchanged === total`. That is the property that makes a cron schedule safe.

**Test:** `lib/__tests__/corpus-ingest.test.ts`, all with fake clients:

- a fake client with 1,200 existing rows and pages of 500 → exactly 3 `select` calls
  (asserting the paging loop, not just the result)
- all-new documents: `inserted === total`, `upserted === total`, and the number of upsert
  calls is `ceil(total / chunkSize)` — check with `chunkSize: 1` on three docs
- unchanged documents: `upserted === 0`, `unchanged === total`, and **no** upsert call
- a document whose `body` changed → `updated === 1`, the others unchanged, and the sent row
  carries the new `content_hash`
- `dryRun: true` → counts still computed and no upsert call
- row mapping: the sent row has snake_case keys, `metadata` as an object, `aliases` as an
  array, and **no** `fts` key
- `now` injected → every sent row's `updated_at` equals the injected time
- a read error rejects, and an upsert error rejects (both must surface, not be swallowed)
- `documents: []` → `{ total: 0, upserted: 0 }` and no upsert call
- `collectTrackerRows` with a fake returning one page → mapped rows with numbers coerced
  and missing fields nulled; a read error rejects
- `collectCorpus` on a fake with no rows still returns the curated documents (length `> 250`)

**Commit:** `feat(ai): ingest the corpus with idempotent hashing`

---

### Task 14 — The ingestion route

**Files:** `app/api/admin/ingest-corpus/route.ts`, `app/api/admin/ingest-corpus/route.test.ts`

The cron/manual entry point. It mirrors `app/api/admin/sync-crimes/route.ts`: same secret
header, same `createAdminClient()` helper, same JSON shape.

```ts
// app/api/admin/ingest-corpus/route.ts
import { NextResponse } from "next/server"
import { createAdminClient } from "@/utils/supabase/admin"
import { collectCorpus, type CollectClient } from "@/lib/ai/corpus/collect"
import { ingestCorpus, type IngestClient } from "@/lib/ai/corpus/ingest"

export const maxDuration = 300

export async function POST(request: Request) {
  const secret = process.env.ADMIN_TASK_SECRET || process.env.CRON_SECRET
  if (!secret || request.headers.get("x-admin-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1"
  const startedAt = Date.now()

  try {
    const client = createAdminClient()
    const documents = await collectCorpus(client as unknown as CollectClient)
    const report = await ingestCorpus({
      client: client as unknown as IngestClient,
      documents,
      dryRun,
    })
    return NextResponse.json({ ok: true, docs: documents.length, dryRun, report, ms: Date.now() - startedAt })
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 })
  }
}
```

`createAdminClient()` returns `null` when the service-role env is missing (that is what
`lib/ai/provider-health.ts` relies on), so `collectCorpus` receives `null` in that case.
Add an explicit guard before it: if the client is null, return
`{ ok: false, error: "Missing Supabase service role env vars" }` with status 500 — the same
message `sync-crimes` throws.

**Test:** `app/api/admin/ingest-corpus/route.test.ts`. Mock `@/utils/supabase/admin`,
`@/lib/ai/corpus/collect` and `@/lib/ai/corpus/ingest` with `vi.mock` (Plan 1's
`route.integration.test.ts` is the pattern to copy). Set and restore `process.env.CRON_SECRET`
in `beforeEach`/`afterEach`. Assert:

- no header → 401, and neither `collectCorpus` nor `ingestCorpus` was called
- wrong secret → 401
- a correct `x-admin-secret` with `CRON_SECRET` set → 200, `ok: true`, `docs` and `report`
  in the body
- `?dryRun=1` → `ingestCorpus` received `dryRun: true`
- `createAdminClient` returning null → 500 with the missing-env message
- `collectCorpus` rejecting → 500 whose body carries the error message
- `ingestCorpus` rejecting → 500
- the module exports `maxDuration` equal to 300
- the test never constructs a real admin client (assert the mock was called, which is the
  negative control for constraint 11)

**Commit:** `feat(ai): add the guarded corpus ingestion route`

---

### Task 15 — Golden eval set and the recall@5 gate

**Files:** `lib/ai/retrieval/eval.ts`, `lib/__tests__/fixtures/golden-qa.json`,
`lib/__tests__/retrieval-eval.test.ts`, `SYSTEM_DOCS.md`

```ts
// lib/ai/retrieval/eval.ts
import type { ScoredDoc } from "@/lib/ai/retrieval/candidates"

export interface GoldenCase {
  q: string
  /** Any one of these in the top 5 counts as a hit. */
  expected: string[]
  needsLore?: boolean
  note?: string
}

export interface EvalCaseResult {
  q: string
  hits: string[]
  /** 1 or 0 for a single case. */
  recall: number
  passed: boolean
}

export interface EvalReport {
  total: number
  passed: number
  recallAt5: number
  misses: EvalCaseResult[]
}

export const RECALL_GATE = 0.85
export const EVAL_K = 5

export function recallAtK(docs: ScoredDoc[], expected: string[], k?: number): number
export async function evaluateRetrieval(
  cases: GoldenCase[],
  run: (query: string) => Promise<ScoredDoc[]>
): Promise<EvalReport>
```

`run` is a closure over `runLadder` with a fixed source — keeping the harness ignorant of
how retrieval works is what lets Plan 4's orchestrator be evaluated by the same harness.

**The fixture.** `lib/__tests__/fixtures/golden-qa.json` — an array of 60 `GoldenCase`
objects, authored from real corpus data. Enumerate the ids to author against:

```bash
grep -o '^    id: "[a-z0-9-]*"' lib/characters-guide.ts | sed 's/.*"\(.*\)"/\1/' | sort -u
grep -o 'slug: "[a-z0-9-]*"' lib/arcs-guide.ts | sed 's/.*"\(.*\)"/\1/' | sort -u
grep -o "^('ep-0[0-9]*', '[^']*'" supabase/seed-content.sql | head -40
```

Coverage to aim for across the 60 cases:

| Kind | Example question | Expected id shape |
| --- | --- | --- |
| character by name | "Who is Ai Haibara?" | `character:ai-haibara` |
| character by alias | "Tell me about Sherry" | `character:ai-haibara` |
| relationship | "What is the relationship between Conan and Ran?" | `relationship:conan-ran-romance` |
| arc by name | "What happens in the Vermouth arc?" | `arc:vermouth-arc` |
| arc by episode range | "Which arc covers episodes 500 to 550?" | `arc:*` for the real overlapping arc |
| canon / filler | "Is episode 6 filler?" | `guide:canon` |
| movie | "Which movie is Sunflowers of Inferno?" | `movie:19` |
| gadget | "What does the voice-changing bowtie do?" | `gadget:1` |
| episode by title | "What happens in Roller Coaster Murder Case?" | `entry:ep-001` |
| episode by number | "What is episode 1 about?" | `entry:ep-001` |
| typo tolerance | "Roller Coaser Murder Case" | `entry:ep-001` |

Every `expected` id must exist in the corpus — the test asserts this, so a typo in the
fixture fails loudly instead of silently lowering recall.

**The gate test.** `lib/__tests__/retrieval-eval.test.ts`:

1. reads `supabase/seed-content.sql` and parses it (`parseSeedEntries`)
2. builds the corpus with `buildCorpusDocuments({ entries })` from the parsed rows —
   `cases` stays empty (no offline source for crime data, see the risks table) and the
   curated builders run on their defaults, so characters, relationships, arcs, threads,
   canon, movies and gadgets are all present
3. creates `createStaticSource(docs)`
4. defines `run` as `runLadder({ query, limit: 5 }, { source, wiki: async () => [] })`
   — the wiki dep returns nothing, so the eval is offline by construction
5. asserts `new Set(docs.map(d => d.id))` contains every expected id (fixture integrity)
6. asserts the fixture has `>= 50` cases and each has at least one `expected` id
7. asserts `report.recallAt5 >= RECALL_GATE`, with the failing questions in the assertion
   message (`JSON.stringify(report.misses.map(m => m.q))`) so a regression is diagnosable
   from CI output alone
8. asserts determinism: a second full pass produces the same `recallAt5`

A header comment must state plainly what this number is and is not (constraint D5): it
measures ladder + fusion + scorer over an in-process approximation of the SQL search, on
real catalog and curated data, with no database and no network. It is not a live recall
measurement; that is the manual check after the migration is applied.

If recall lands below 0.85, the fix is retrieval (weights, thresholds, the RRF k, alias
coverage), not the fixture. Removing a case requires a recorded reason in its `note` field,
and the fixture must keep at least 50 cases.

**Documentation.** Update `SYSTEM_DOCS.md`:

- new section **AI retrieval corpus**: what `ai_documents` and `ai_wiki_cache` hold, the
  three RPCs and what each branch is for, the escalation ladder (threshold 6, 1.5s budget)
  and its degradation contract, the ingestion route
  (`POST /api/admin/ingest-corpus` with `x-admin-secret`, `?dryRun=1`) and how to run it
  locally, the golden eval and the offline caveat, and the manual verification SQL from
  Task 1
- **fix the stale provider numbers** in the AI section so they match `lib/ai/targets.ts`
  (Gemini's daily budget, Groq's, and Cerebras's where it is missing)
- add `ai_provider_state`, `ai_request_log`, `ai_documents`, `ai_wiki_cache` to the Database
  section's table list
- note that `supabase/migrations/20260919100000_ai_corpus.sql` is committed but **not**
  applied to the remote project

**Commit:** `test(ai): gate retrieval on a golden recall@5 eval` (plus
`lib/ai/retrieval/ladder.ts` and `lib/ai/corpus/curated.ts`, see below)

**Execution notes (recorded after the task, per §8 criterion 9).**

The first full pass scored 49/59 = 0.831, below the gate. Classifying every miss
showed two classes worth a principled change, and both stayed inside Phase 2's
scope:

- `ENTITY_CANDIDATES` 20 → 100. R1's weakest tier — title substring, rank 1.0 —
  matches a short keyword anywhere in a title ("ran" inside "strange"), so the
  whole tier ties and is ordered by id, and it can run past a hundred rows. At 20
  slots a document whose title contains two of the query's names never reached
  the scorer that would have ranked it first. Fixed seven cases; 80 slots gave
  54/59, 100 gave 56/59.
- Arc episode-range aliases in `buildArcDocs`. An arc owns no `episode_number`,
  so only the alias branch can match "179"/"345" in "which arc covers episodes
  179 to 345". Without them the question was decided by an id tie-break among
  seven arcs that all matched the word "arc".

Result: **58/60 = 0.967**, verified a second time by an independent probe that
rebuilt the corpus, re-ran all 60 cases and confirmed the fixture contains zero
unknown ids.

Two cases still miss, both ranking weaknesses with their cause identified, and
both left failing rather than papered over:

- "Who is Heiji Hattori?" returns five episode entries titled after him and
  ranks `character:heiji-hattori` seventh. Episode titles collect the phrase
  bonus while the character document does not, because `tokenize` sorts keywords
  by length. **The fix belongs in `lib/chat/query.ts`, which this plan freezes** —
  so it is queued for Plan 4, not worked around here.
- "Tell me about the Kaitou Kid thread" ranks `thread:kaitou-kid` behind a
  character document and four relationship documents.

Plan bugs and gaps found while executing this task:

1. **The commit list contradicts the task's own authority to adjust retrieval.**
   This section names four paths, but the adjustments it authorizes live in
   `ladder.ts` and `curated.ts`. Committing four paths would leave HEAD failing
   the gate test the same commit adds, so the commit carries six. A reviewer who
   wants the literal four-path commit should split the retrieval changes into
   their own commit rather than revert them.
2. **"Removing a case requires a recorded reason in its `note` field" is
   impossible** — a removed case has no `note` to carry it. The record belongs in
   the test file's header. No case was removed here, so this stayed moot.
3. **The `needsLore` guidance contradicts itself**: "add a `needsLore` case or two
   which the empty wiki dep will simply not answer" versus "do not build a
   lore-dependent expectation". The second wins — all 11 `needsLore` cases have
   corpus-reachable expectations, so none is designed to fail.
4. **The corpus-assembly step omits an adapter**: `parseSeedEntries` returns
   camelCase `SeedEntry` while `buildCorpusDocuments` wants snake_case
   `ContentEntryRow`. The test carries the twelve-field projection explicitly.

---

## 7. Risks recorded while planning

| Risk | Why it is acceptable |
| --- | --- |
| The CI eval measures an in-process approximation of Postgres FTS | The alternative is no gate at all in CI. D5 records the boundary; the production path is exercised by the manual SQL checks in Task 1 and, from Plan 4 on, by `ai_request_log`'s `doc_count` and `degraded_reason` in production. |
| Case retrieval has no eval coverage | `dcw_cases` has no offline source: the repo contains the catalog seed but not the crime data (it is scraped live). `searchCases` is unit-tested against fixtures; its production quality is visible in `ai_request_log`. |
| Two implementations of "search" (SQL and static) can drift | Both branches are specified from the same three rules (entity / token-AND / trigram ≥ 0.3), the static one is separately tested, and the drift surface is three small functions, not the pipeline. |
| `rankCandidates` keeping zero-score fuzzy hits could inject noise | The hits are ordered below every scored document and capped by the same `limit`. The alternative — dropping them — deletes R3's entire purpose. There is an explicit test for the behaviour. |
| Ingestion paging caps could silently truncate a grown catalog | `maxRows` (20,000) is 8× the current corpus, and `collectTrackerRows` throws rather than truncating on a read error. The report's `total` makes a shrinking corpus visible on every run. |

---

## 8. Completion criteria

A task is complete when its own test passes and the gate is green. **Phase 2 is complete**
when all of the following hold and are reported verbatim:

1. `npm test` passes — baseline 394 tests / 31 files, expected ≤ ~500 tests / ~46 files.
   No existing test may be modified to accommodate this plan (except the ones this plan
   names).
2. `npx tsc --noEmit` exits 0.
3. `npm run lint` reports 0 errors (the pre-existing warnings may remain).
4. `npm run build` succeeds.
5. The eval gate passes at `recallAt5 >= 0.85` over at least 50 golden cases, and the
   reported number is quoted in the final report.
6. `lib/chat/query.ts` is unchanged: `git log --oneline <plan-start>..HEAD -- lib/chat/query.ts`
   is empty.
7. `git status --short` shows the same 10 staged files and the same untracked paths as at
   the start of the phase — the user's in-flight characters work is untouched.
8. The migration is committed and **not** applied remotely; the report says so explicitly,
   lists the manual verification SQL, and states that no test executed it.
9. The report lists every deviation from this plan that a subagent had to make, and every
   plan bug found during execution.

## 9. What Plan 3 and Plan 4 will consume

- `lib/ai/retrieval/ladder.ts` — Plan 4's orchestrator calls `runLadder` after planning.
- `lib/ai/tools/index.ts` — Plan 4 executes a `QueryPlan` as `ToolRequest[]` here.
- `lib/ai/corpus/*` — Plan 4's prompt assembly cites `CorpusDocument.id`s; the citation
  contract's `[E1]` ids are these ids.
- `lib/ai/corpus/ingest.ts` — Plan 6 (observability) adds the cron wiring for the route.
- Deferred deliberately: the response cache (Plan 3, where conversation identity exists),
  a `p_source` argument on the three RPCs (only if mixed-corpus dilution shows up in
  measurements), the live wiki fetcher wiring (`searchDcwWiki` injected into
  `createWikiCache` where the route lives, Plan 4), and **`collectTrackerRows` reading the
  `arcs` table to feed `buildEntryDocs`'s `arcTitleById`** — without it, ingested entry
  documents carry `metadata.arc_slug: null`, so "which episodes are in the Vermouth arc"
  is answered only by the arc document, not by the episode documents. Add it when an arc
  question is seen to miss in `ai_request_log`.




