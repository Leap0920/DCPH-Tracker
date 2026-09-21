import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

// The URL form, not process.cwd(): vitest runs from the repo root today, but the
// URL cannot drift with the runner's working directory.
const migrationUrl = new URL(
  "../../supabase/migrations/20260919130000_ai_request_log_pipeline.sql",
  import.meta.url
)

// A missing file must fail as an assertion, not as an import-time ENOENT: the
// suite has to survive a fresh checkout where the migration has not landed yet.
// Nothing here executes SQL -- the migration is applied by hand, so its shape is
// the only thing a test in this repo can honestly assert.
const sql = existsSync(migrationUrl) ? readFileSync(migrationUrl, "utf8") : ""

describe("ai_request_log pipeline migration", () => {
  it("exists and is non-empty", () => {
    expect(sql.length).toBeGreaterThan(0)
  })

  it("is additive only", () => {
    // Constraint 4: this file is applied to a live project by hand, so a
    // destructive statement here would be unrecoverable. Word boundaries on
    // purpose, so the header's prose cannot trip the check.
    expect(sql).not.toMatch(/\bdrop\b/i)
    expect(sql).not.toMatch(/\btruncate\b/i)
    expect(sql).not.toMatch(/\bdelete\s+from\b/i)
  })

  it("alters ai_request_log exactly once", () => {
    expect(sql.match(/alter\s+table/gi) ?? []).toHaveLength(1)
    expect(sql).toMatch(/alter\s+table\s+public\.ai_request_log\b/i)
  })

  it("adds exactly the three pipeline columns, each with if not exists", () => {
    // The count is over the clause, not the column names: a bare `add column`
    // aborts the whole statement on a table that already has one of them, and
    // this file is re-run by hand on a project the earlier migrations touched.
    expect(sql.match(/add\s+column\s+if\s+not\s+exists/gi) ?? []).toHaveLength(3)
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+plan_source\s+text\b/i)
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+tools\s+text\[\]/i)
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+citations_valid\s+boolean\b/i)
  })

  it("leaves all three nullable, inventing nothing for the rows that predate them", () => {
    // Every row written before the pipeline shipped has no value for these
    // columns: a constant would record a decision no request made, and a
    // non-null constraint would refuse to extend the table over its own history.
    expect(sql).not.toMatch(/\bnot\s+null\b/i)
    expect(sql).not.toMatch(/\bdefault\b/i)
  })

  it("touches no access control", () => {
    // Rule 2: 20260919090000 already enables RLS on this table with no policies
    // and removes anon/authenticated reach from it. Re-stating any of that here
    // -- a new privilege above all -- is the classic way an additive migration
    // accidentally widens a table only service_role may touch.
    expect(sql).not.toMatch(/\bgrant\b/i)
    expect(sql).not.toMatch(/\brevoke\b/i)
    expect(sql).not.toMatch(/create\s+policy/i)
    expect(sql).not.toMatch(/enable\s+row\s+level\s+security/i)
    expect(sql).not.toMatch(/\bfor\s+(select|insert|update|delete)\s+using\b/i)
  })
})
