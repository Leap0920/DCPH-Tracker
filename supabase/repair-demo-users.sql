-- ─────────────────────────────────────────────────────────────
-- REPAIR DEMO ACCOUNTS (SQL-only fallback — no service role key)
-- ─────────────────────────────────────────────────────────────
-- USE: Supabase Dashboard -> SQL Editor -> paste -> Run
--
-- WHY: The demo accounts (admin@dcph.ph / member@dcph.ph) were
-- originally created via raw SQL inserts into auth.users /
-- auth.identities. GoTrue cannot read those rows back at login,
-- producing HTTP 500 "Database error querying schema".
--
-- FIX: Deleting auth rows via SQL is SAFE (only raw INSERTS into
-- auth.* break GoTrue). We delete the broken rows, then sign up
-- fresh accounts through the app (which writes proper GoTrue rows
-- via the signup endpoint), then re-assert the roles.
--
-- NOTE: signup-assigned user IDs are RANDOM UUIDs, so this script
-- resolves user_ids from auth.users BY EMAIL — never hardcodes.
--
-- PART 1 and PART 2 MUST be run as TWO SEPARATE batches:
--   1. Run PART 1 below.
--   2. Sign up BOTH demo accounts in the app at /signup:
--        admin@dcph.ph  / DcphDemo2026!   (username: demo_admin)
--        member@dcph.ph / DcphDemo2026!   (username: demo_member)
--   3. Run PART 2 below.
-- ─────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════
-- PART 1: DELETE broken demo auth rows (safe — cascades to
--         auth.identities and public.profiles via FKs).
-- ═════════════════════════════════════════════════════════════

-- Delete identities first (FK: auth.identities.user_id -> auth.users.id)
delete from auth.identities
where user_id in (
  select id from auth.users where email in ('admin@dcph.ph', 'member@dcph.ph')
);

-- Delete the auth users themselves (FK: profiles.user_id -> auth.users.id ON DELETE CASCADE)
delete from auth.users
where email in ('admin@dcph.ph', 'member@dcph.ph');

-- Also clean up the leftover probe@test.com test user from the bug hunt
delete from auth.identities
where user_id in (
  select id from auth.users where email = 'probe@test.com'
);

delete from auth.users
where email = 'probe@test.com';

-- Verify: should return 0 rows for all three emails
select 'PART 1 VERIFY (expect 0 rows)' as check_label, count(*) as remaining
from auth.users
where email in ('admin@dcph.ph', 'member@dcph.ph', 'probe@test.com');

-- ─────────────────────────────────────────────────────────────
-- >>> NOW GO SIGN UP BOTH ACCOUNTS IN THE APP AT /signup <<<
--     admin@dcph.ph  / DcphDemo2026!   (username: demo_admin)
--     member@dcph.ph / DcphDemo2026!   (username: demo_member)
--     THEN RUN PART 2 BELOW.
-- ─────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════
-- PART 2: Re-assert profile roles (DELETE+INSERT bypasses the
--         prevent_profile_privilege_escalation BEFORE UPDATE
--         trigger — the trigger only gates UPDATE, not INSERT).
-- ═════════════════════════════════════════════════════════════

-- Remove the trigger-created 'member' rows for the demo users
delete from public.profiles
where user_id in (
  select id from auth.users where email in ('admin@dcph.ph', 'member@dcph.ph')
);

-- Insert fresh profile rows with the correct roles, resolving
-- user_id and username from auth.users BY EMAIL.
insert into public.profiles (user_id, username, display_name, role)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'username', split_part(u.email, '@', 1)),
  coalesce(u.raw_user_meta_data ->> 'display_name', split_part(u.email, '@', 1)),
  case when u.email = 'admin@dcph.ph' then 'admin' else 'member' end
from auth.users u
where u.email in ('admin@dcph.ph', 'member@dcph.ph');

-- VERIFY: expect 2 rows — admin@dcph.ph (demo_admin/admin),
--         member@dcph.ph (demo_member/member)
select u.email, p.username, p.role
from auth.users u
left join public.profiles p on p.user_id = u.id
where u.email in ('admin@dcph.ph', 'member@dcph.ph')
order by u.email;
