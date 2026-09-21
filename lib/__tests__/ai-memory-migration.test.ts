import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

// The URL form, not process.cwd(): vitest runs from the repo root today, but the
// URL cannot drift with the runner's working directory.
const migrationUrl = new URL(
  "../../supabase/migrations/20260919110000_ai_memory.sql",
  import.meta.url
)

// A missing file must fail as an assertion, not as an import-time ENOENT: the
// suite has to survive a fresh checkout where the migration has not landed yet.
// Nothing here executes SQL -- the migration is applied by hand, so its shape is
// the only thing a test in this repo can honestly assert.
const sql = existsSync(migrationUrl) ? readFileSync(migrationUrl, "utf8") : ""

describe("ai_memory migration", () => {
  it("exists and is non-empty", () => {
    expect(sql.length).toBeGreaterThan(0)
  })

  it("creates all three tables additively", () => {
    expect(sql).toMatch(/create table if not exists public\.ai_conversations\b/)
    expect(sql).toMatch(/create table if not exists public\.ai_messages\b/)
    expect(sql).toMatch(/create table if not exists public\.ai_user_memories\b/)
    // Counting the bare form proves `if not exists` was not dropped from one
    // table: a partial re-apply of a hand-run migration is the normal case, not
    // the exceptional one.
    expect(sql.match(/create table/g)).toHaveLength(3)
  })

  it("declares every column the port and the store read", () => {
    // The column list, not the types: a renamed or missing column is a runtime
    // PostgREST 400 at the first recall, which no test in this repo would
    // otherwise reach, because nothing here talks to a database.
    const columns: Record<string, string[]> = {
      ai_conversations: [
        "id",
        "user_id",
        "title",
        "summary",
        "summarized_through",
        "message_count",
        "last_message_at",
        "created_at",
        "archived_at",
      ],
      ai_messages: [
        "id",
        "conversation_id",
        "role",
        "content",
        "metadata",
        "model",
        "prompt_tokens",
        "completion_tokens",
        "feedback",
        "feedback_note",
        "created_at",
        "fts",
      ],
      ai_user_memories: [
        "id",
        "user_id",
        "kind",
        "key",
        "value",
        "confidence",
        "status",
        "superseded_by",
        "source_message_id",
        "evidence_count",
        "last_confirmed_at",
        "expires_at",
        "created_at",
        "updated_at",
      ],
    }

    for (const [table, names] of Object.entries(columns)) {
      const header = `create table if not exists public.${table}`
      const start = sql.indexOf(header)
      const end = sql.indexOf(");", start + header.length)
      expect(start, table).toBeGreaterThanOrEqual(0)
      expect(end, table).toBeGreaterThan(start)
      const block = sql.slice(start, end)
      for (const name of names) {
        expect(block, `${table}.${name}`).toMatch(new RegExp(`^\\s+${name}\\s`, "m"))
      }
    }
  })

  it("enables row level security on every table", () => {
    // Constraint 5: RLS on with NO policies. These tables hold a user's private
    // transcript, so the only client allowed near them is service_role.
    expect(sql.match(/enable row level security/g)).toHaveLength(3)
    expect(sql).toMatch(/alter table public\.ai_conversations enable row level security/)
    expect(sql).toMatch(/alter table public\.ai_messages enable row level security/)
    expect(sql).toMatch(/alter table public\.ai_user_memories enable row level security/)
  })

  it("revokes anon and authenticated access on every table", () => {
    expect(sql.match(/revoke all/g)).toHaveLength(3)
    expect(sql).toMatch(/revoke all on table public\.ai_conversations from anon, authenticated/)
    expect(sql).toMatch(/revoke all on table public\.ai_messages from anon, authenticated/)
    expect(sql).toMatch(/revoke all on table public\.ai_user_memories from anon, authenticated/)
  })

  it("pins every check constraint", () => {
    // The checks are the only thing between a model output and a row whose role
    // or kind the rest of the plan cannot interpret.
    expect(sql).toContain("check (role in ('user','assistant','system'))")
    expect(sql).toContain(
      "check (kind in ('preference','progress','identity','interest','constraint'))"
    )
    expect(sql).toContain("check (status in ('active','superseded','expired'))")
    expect(sql).toContain("check (confidence >= 0 and confidence <= 1)")
    expect(sql).toContain("check (feedback in ('up','down'))")
  })

  it("wires exactly five foreign keys with the right delete action", () => {
    expect(sql.match(/\breferences\b/g)).toHaveLength(5)
    // Deleting a user must take their whole transcript and memory with them, so
    // both ownership columns cascade from auth.users.
    expect(sql).toMatch(
      /user_id\s+uuid\s+not null references auth\.users \(id\) on delete cascade/g
    )
    expect((sql.match(/references auth\.users \(id\) on delete cascade/g) ?? []).length).toBe(2)
    expect(sql).toMatch(
      /conversation_id\s+uuid\s+not null references public\.ai_conversations \(id\) on delete cascade/
    )
    // set null, not cascade: a superseded fact and a deleted source message are
    // provenance, and losing the trail is worse than a dangling pointer.
    expect(sql).toMatch(
      /superseded_by\s+uuid\s+references public\.ai_user_memories \(id\) on delete set null/
    )
    expect(sql).toMatch(
      /source_message_id\s+uuid\s+references public\.ai_messages \(id\) on delete set null/
    )
  })

  it("declares the fts column as stored-generated with an explicit regconfig", () => {
    const start = sql.indexOf("fts tsvector")
    const end = sql.indexOf(") stored")
    // A missing generated column must fail here with a readable message rather
    // than by slicing to an empty string.
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const definition = sql.slice(start, end)
    expect(definition).toContain("generated always as")
    // Exactly one: the one-argument to_tsvector is only STABLE and a generated
    // column rejects it, so the two-argument form is the only one that parses.
    expect(definition.match(/'english'::regconfig/g)).toHaveLength(1)
    expect(sql.match(/'english'::regconfig/g)).toHaveLength(1)
    // Every call in the file carries the regconfig -- the count, not a substring,
    // so a second bare call added later cannot slip through.
    const calls = (sql.match(/to_tsvector\(/g) ?? []).length
    const withRegconfig = (sql.match(/to_tsvector\('english'::regconfig,/g) ?? []).length
    expect(calls).toBeGreaterThanOrEqual(1)
    expect(withRegconfig).toBe(calls)
  })

  it("enforces one active memory per slot with a partial unique index", () => {
    expect(sql).toMatch(
      /create unique index if not exists ai_user_memories_active_slot_idx\s+on public\.ai_user_memories \(user_id, kind, key\)\s+where status = 'active'/
    )
    // Exactly that predicate, once: a superseded row must be free to keep its
    // slot, and widening the predicate would silently permit two active facts.
    expect(sql.match(/where status = 'active'/g)).toHaveLength(1)
  })

  it("indexes the four hot reads", () => {
    // The attach query, the verbatim window, episodic search, and the prompt read.
    expect(sql).toMatch(
      /on public\.ai_conversations \(user_id, last_message_at desc\)/
    )
    expect(sql).toMatch(/on public\.ai_messages \(conversation_id, created_at\)/)
    expect(sql).toMatch(/on public\.ai_messages using gin \(fts\)/)
    expect(sql).toMatch(
      /on public\.ai_user_memories \(user_id, status, last_confirmed_at desc\)/
    )
  })

  it("is additive only", () => {
    // Constraint 4: this file is applied to a live project by hand, so a
    // destructive statement here would be unrecoverable. Word boundaries on
    // purpose -- `gen_random_uuid` and the header's "no policies" must not trip
    // the check.
    expect(sql).not.toMatch(/\bdrop\b/i)
    expect(sql).not.toMatch(/\btruncate\b/i)
    expect(sql).not.toMatch(/\bdelete\s+from\b/i)
    expect(sql).not.toMatch(/alter\s+table\s+\S+\s+drop\b/i)
    expect(sql).not.toMatch(/\bgrant\b/i)
  })

  it("creates no policy", () => {
    // The header comment says "NO policies"; the count is over the creation
    // form, which is the only way a policy could actually appear.
    expect((sql.match(/create\s+policy/gi) ?? []).length).toBe(0)
    expect(sql).not.toMatch(/\bfor\s+(select|insert|update|delete)\s+using\b/i)
  })
})
