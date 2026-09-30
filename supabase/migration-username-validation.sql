-- ============================================================================
-- Username validation at the database boundary.
--
-- The app already rejects bad handles in lib/validation.ts (character set,
-- length, blocklist) on every route that accepts one. This migration adds the
-- same rule as a table constraint so the value cannot be written by a path
-- that skipped the route: a direct client insert under RLS, an admin tooling
-- script, or a signup whose metadata bypassed the generated handle.
--
-- Character class only. The profanity blocklist is intentionally NOT mirrored
-- here: it is a long hand-maintained list of app-level terms, and duplicating it
-- in SQL would give two lists that drift. The app layer rejects those handles
-- before they ever reach this constraint.
--
-- Apply in the Supabase Dashboard SQL Editor. Idempotent.
-- ============================================================================

do $$
begin
  -- A named constraint is added only when absent, so re-running is a no-op and
  -- existing rows are not re-validated on every apply.
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_username_format'
  ) then
    alter table public.profiles
      add constraint profiles_username_format
      check (
        username ~ '^[a-zA-Z0-9_-]{3,20}$'
      ) not valid;
  end if;
end;
$$;

-- NOT VALID above means existing rows are trusted for now (some predate the
-- rule, and a failed ADD CONSTRAINT would block the apply). Validate only once
-- the legacy rows are known to be clean; uncomment when that has happened.
-- alter table public.profiles validate constraint profiles_username_format;
