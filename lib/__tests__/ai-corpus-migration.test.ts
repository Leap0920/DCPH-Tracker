import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

// The URL form, not process.cwd(): vitest runs from the repo root today, but the
// URL cannot drift with the runner's working directory.
const migrationUrl = new URL(
  "../../supabase/migrations/20260919100000_ai_corpus.sql",
  import.meta.url
)

// A missing file must fail as an assertion, not as an import-time ENOENT: the
// suite has to survive a fresh checkout where the migration has not landed yet.
const sql = existsSync(migrationUrl) ? readFileSync(migrationUrl, "utf8") : ""

describe("ai_corpus migration", () => {
  it("exists and is non-empty", () => {
    expect(sql.length).toBeGreaterThan(0)
  })

  it("is additive only", () => {
    // Constraint 3: this file is applied to a live project by hand, so a
    // destructive statement here would be unrecoverable.
    expect(sql).not.toMatch(/^\s*drop\s+(table|type|schema|index)/im)
    expect(sql).not.toMatch(/^\s*delete\s+from\b/im)
    expect(sql).not.toMatch(/^\s*truncate\b/im)
  })

  it("creates pg_trgm in the extensions schema", () => {
    expect(sql).toContain("create extension if not exists pg_trgm with schema extensions")
  })

  it("enables row level security on both tables and nothing else", () => {
    expect(sql.match(/enable row level security/g)).toHaveLength(2)
    expect(sql).toMatch(/alter table public\.ai_documents enable row level security/)
    expect(sql).toMatch(/alter table public\.ai_wiki_cache enable row level security/)
  })

  it("revokes anon and authenticated access on both tables", () => {
    expect(sql).toMatch(/revoke all on table public\.ai_documents from anon, authenticated/)
    expect(sql).toMatch(/revoke all on table public\.ai_wiki_cache from anon, authenticated/)
  })

  it("gives the generated column its explicit regconfig in both places", () => {
    // Scoped to the column definition: these are the calls that must be immutable,
    // because the one-argument to_tsvector is STABLE and a generated column rejects
    // it. The two-argument form with 'english'::regconfig is the immutable one.
    const generated = sql.slice(sql.indexOf("fts tsvector"), sql.indexOf(") stored"))
    expect(generated.match(/'english'::regconfig/g)).toHaveLength(2)
    expect(sql).not.toMatch(/to_tsvector\(\s*coalesce/)
    // R2 passes the regconfig explicitly as well, so it does not depend on the
    // session's default_text_search_config -- that third occurrence is deliberate.
    expect(sql.match(/'english'::regconfig/g)).toHaveLength(3)
  })

  it("indexes full text, trigram titles and aliases", () => {
    expect(sql).toContain("using gin (fts)")
    expect(sql).toContain("extensions.gin_trgm_ops")
    expect(sql).toContain("using gin (aliases)")
  })

  it("declares the three RPCs as stable with a pinned search_path", () => {
    expect(sql).toContain("public.ai_docs_entity")
    expect(sql).toContain("public.ai_docs_fts")
    expect(sql).toContain("public.ai_docs_fuzzy")
    // `stable` lets the planner inline these into a single statement; the pinned
    // search_path keeps `similarity` resolvable from the extensions schema.
    expect(sql.match(/\bstable\b/g)).toHaveLength(3)
    expect(sql.match(/set search_path = public, extensions, pg_temp/g)).toHaveLength(3)
  })

  it("matches entity numbers by equality and guards empty names", () => {
    expect(sql).toMatch(/= any \(p_numbers\)/)
    // `like '%' || '' || '%'` matches every row, so the guard is what stops an
    // empty name list from turning R1 into a full-corpus scan.
    expect(sql).toContain("n <> ''")
  })

  it("uses websearch_to_tsquery rather than the raising to_tsquery", () => {
    expect(sql).toContain("websearch_to_tsquery")
    // `websearch_to_tsquery` itself contains the substring `to_tsquery`, so the
    // bare form is proven absent by counting: every occurrence of the suffix
    // must carry the websearch_ prefix.
    const suffix = (sql.match(/to_tsquery/g) ?? []).length
    const websearch = (sql.match(/websearch_to_tsquery/g) ?? []).length
    expect(websearch).toBeGreaterThanOrEqual(1)
    expect(suffix).toBe(websearch)
  })
})
