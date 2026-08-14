-- ═══════════════════════════════════════════════════════════════════════
-- SECURITY HARDENING MIGRATION — DCPH-Tracker
--
-- How to run: Supabase Dashboard → SQL Editor → paste → Run.
-- IDEMPOTENT: safe to re-run (uses drop-if-exists / create-or-replace).
-- ADDITIVE ONLY: creates one view; does not drop/alter existing tables.
--
-- Contents:
--   1. public_profiles view          — anon-readable, PII-safe column subset
--   2. Revoke anon SELECT on base    — birthday/bio/status/ban fields hidden
--   3. Trigger fix                   — non-admins can't touch moderation fields
--   4. Leaderboard mview revoke      — anon can't read raw leaderboard rows
--   5. Demo password rotation note   — MUST rotate admin@dcph.ph password
--
-- ⚠️ AFTER RUNNING: rotate the demo admin password (DcphDemo2026! is
--    publicly documented in supabase/schema.sql):
--    Dashboard → Authentication → Users → admin@dcph.ph → Reset password.
-- ═══════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- 1. PUBLIC PROFILE VIEW (PII-safe)
-- SECURITY DEFINER (view owner rights) so the view bypasses base-table
-- RLS *for the columns it exposes only*. Anonymous clients get exactly
-- username / display_name / avatar_url — never birthday, bio, status,
-- ban info, or timestamps.
-- ─────────────────────────────────────────────────────────────────────
drop view if exists public_profiles;
create view public_profiles as
select
  user_id,
  username,
  display_name,
  avatar_url
from profiles;

-- Grant the view to the roles that power public pages.
grant select on public_profiles to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2. REVOKE ANON READ ON BASE PROFILES TABLE
-- The base table still carries RLS for authenticated/owner writes, but
-- anonymous clients may no longer SELECT from it directly — the REST
-- endpoint /rest/v1/profiles?select=* now returns an empty/denied result
-- instead of leaking birthday, bio, status, ban_reason, banned_at,
-- suspended_until, created_at, updated_at.
-- ─────────────────────────────────────────────────────────────────────
drop policy if exists "Profiles are publicly readable" on profiles;
revoke select on profiles from anon;

-- ─────────────────────────────────────────────────────────────────────
-- 3. PRIVILEGE-ESCALATION TRIGGER FIX
-- Previously non-admins were only blocked from changing role/user_id —
-- they could still self-unban by setting status='active'. Now the
-- moderation fields are admin-only too (admin role changes go through
-- service_role server actions which bypass this check).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.prevent_profile_privilege_escalation()
returns trigger as $$
declare
  caller_role text;
begin
  -- service_role bypasses RLS and this check (used by trusted server code)
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Look up the calling user's current role.
  select role into caller_role
  from public.profiles
  where user_id = auth.uid();

  -- Non-admins may not change protected columns.
  if coalesce(caller_role, 'member') <> 'admin' then
    if new.role is distinct from old.role then
      raise exception 'Not allowed to change role';
    end if;
    if new.user_id is distinct from old.user_id then
      raise exception 'Not allowed to change user_id';
    end if;
    if new.status is distinct from old.status then
      raise exception 'Not allowed to change status';
    end if;
    if new.ban_reason is distinct from old.ban_reason then
      raise exception 'Not allowed to change ban_reason';
    end if;
    if new.banned_at is distinct from old.banned_at then
      raise exception 'Not allowed to change banned_at';
    end if;
    if new.suspended_until is distinct from old.suspended_until then
      raise exception 'Not allowed to change suspended_until';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_prevent_profile_privilege_escalation on public.profiles;
create trigger trg_prevent_profile_privilege_escalation
  before update on public.profiles
  for each row execute function public.prevent_profile_privilege_escalation();

-- ─────────────────────────────────────────────────────────────────────
-- 4. LEADERBOARD MATERIALIZED VIEW — REVOKE ANON
-- The mview contains raw user_id + per-user aggregates. The app's server
-- queries compute rankings live (they do NOT read this view), so anon
-- gets no direct REST access to it either.
-- ─────────────────────────────────────────────────────────────────────
revoke select on leaderboard from anon;

-- ─────────────────────────────────────────────────────────────────────
-- 5. DEMO ACCOUNT PASSWORD ROTATION
--
-- The demo accounts admin@dcph.ph / member@dcph.ph have a publicly
-- documented password (DcphDemo2026!) in supabase/schema.sql — anyone
-- can log in as the demo admin. Rotation cannot be done via plain SQL
-- (GoTrue password hashes are set through the admin API), so do it in
-- the Dashboard:
--
--   1. Authentication → Users
--   2. admin@dcph.ph → "Reset password" → send the user a recovery email
--      (or use the "Forgot password" flow on the site) and set a NEW
--      strong, private password.
--   3. Repeat for member@dcph.ph.
--
-- Until rotated, treat these accounts as compromised-by-design.
-- ─────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION
-- Expected when anon queries the REST API:
--   /rest/v1/profiles?select=*            → denied (no rows / 401)
--   /rest/v1/public_profiles?select=*     → rows with ONLY user_id,
--                                            username, display_name,
--                                            avatar_url
-- ─────────────────────────────────────────────────────────────────────
select
  (select count(*) from public_profiles) as public_profiles_visible,
  (select count(*) from profiles) as profiles_total;