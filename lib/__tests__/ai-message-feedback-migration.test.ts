import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

// The URL form, not process.cwd(): vitest runs from the repo root today, but the
// URL cannot drift with the runner's working directory.
const migrationUrl = new URL(
  "../../supabase/migrations/20260919140000_ai_message_feedback.sql",
  import.meta.url
)

// A missing file must fail as an assertion, not as an import-time ENOENT: the
// suite has to survive a fresh checkout where the migration has not landed yet.
// Nothing here executes SQL -- the migration is applied by hand, so its shape is
// the only thing a test in this repo can honestly assert.
const sql = existsSync(migrationUrl) ? readFileSync(migrationUrl, "utf8") : ""

describe("ai_message_feedback migration", () => {
  it("exists and is non-empty", () => {
    expect(sql.length).toBeGreaterThan(0)
  })

  it("creates the table, if not exists", () => {
    expect(sql).toMatch(/create\s+table\s+if\s+not\s+exists\s+public\.ai_message_feedback\s*\(/i)
  })

  it("declares every column with its constraint", () => {
    expect(sql).toMatch(/id\s+uuid\s+primary\s+key\s+default\s+gen_random_uuid\(\)/i)
    expect(sql).toMatch(
      /message_id\s+uuid\s+not\s+null\s+references\s+public\.ai_messages\s*\(id\)\s+on\s+delete\s+cascade/i
    )
    expect(sql).toMatch(
      /user_id\s+uuid\s+not\s+null\s+references\s+auth\.users\s*\(id\)\s+on\s+delete\s+cascade/i
    )
    expect(sql).toMatch(/value\s+smallint\s+not\s+null\s+check\s*\(\s*value\s+in\s*\(\s*-1\s*,\s*1\s*\)\s*\)/i)
    expect(sql).toMatch(/\bnote\s+text\b/i)
    expect(sql).toMatch(/created_at\s+timestamptz\s+not\s+null\s+default\s+now\(\)/i)
  })

  it("indexes message_id for the reporting read", () => {
    expect(sql).toMatch(
      /create\s+index\s+if\s+not\s+exists\s+\S+\s+on\s+public\.ai_message_feedback\s*\(\s*message_id\s*\)/i
    )
  })

  it("makes (message_id, user_id) unique so a re-vote replaces the first", () => {
    // A non-unique index here would let a second vote stack instead of replace,
    // which is the whole reason the table has an index on the pair at all.
    expect(sql).toMatch(
      /create\s+unique\s+index\s+if\s+not\s+exists\s+\S+\s+on\s+public\.ai_message_feedback\s*\(\s*message_id\s*,\s*user_id\s*\)/i
    )
  })

  it("enables RLS and revokes anon/authenticated, leaving no policy behind", () => {
    // The 20260919090000 pattern: RLS on with no policies means only the
    // service-role key can reach the table.
    expect(sql).toMatch(/alter\s+table\s+public\.ai_message_feedback\s+enable\s+row\s+level\s+security/i)
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+table\s+public\.ai_message_feedback\s+from\s+anon\s*,\s*authenticated/i
    )
    expect(sql).not.toMatch(/create\s+policy/i)
  })

  it("is additive only", () => {
    // This file is applied to a live project by hand, so a destructive or
    // privileged statement here would be unrecoverable. Word boundaries on
    // purpose, so the header's prose cannot trip the check.
    expect(sql).not.toMatch(/\bdrop\b/i)
    expect(sql).not.toMatch(/\btruncate\b/i)
    expect(sql).not.toMatch(/\bdelete\s+from\b/i)
    expect(sql).not.toMatch(/alter\s+column/i)
    expect(sql).not.toMatch(/\bgrant\b/i)
  })
})
