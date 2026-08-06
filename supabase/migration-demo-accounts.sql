-- ============================================================
-- Detective Conan PH — Demo Accounts Migration
-- ============================================================
-- Run this in the Supabase Dashboard → SQL Editor → paste → Run.
-- (Runs as the `postgres` role, which is allowed to write to
--  auth.users / auth.identities and manage triggers.)
--
-- Creates two ready-to-use demo accounts:
--
--   Demo Admin   → admin@dcph.ph   / DcphDemo2026!   (role: admin)
--   Demo Member  → member@dcph.ph  / DcphDemo2026!   (role: member)
--
-- Idempotent: safe to run multiple times (ON CONFLICT DO NOTHING).
-- No real secrets are stored in this file.
-- ============================================================

-- pgcrypto is required for crypt()/gen_salt() to hash the passwords.
create extension if not exists pgcrypto with schema extensions;

-- ─────────────────────────────────────────────────────────────
-- 1) Create the auth.users rows
--    The handle_new_user() trigger (schema.sql) automatically
--    creates the matching public.profiles rows from
--    raw_user_meta_data (username / display_name).
-- ─────────────────────────────────────────────────────────────

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-4111-8111-111111111111',
    'authenticated',
    'authenticated',
    'admin@dcph.ph',
    extensions.crypt('DcphDemo2026!', extensions.gen_salt('bf', 10)),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"demo_admin","display_name":"Demo Admin"}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-4222-8222-222222222222',
    'authenticated',
    'authenticated',
    'member@dcph.ph',
    extensions.crypt('DcphDemo2026!', extensions.gen_salt('bf', 10)),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"demo_member","display_name":"Demo Member"}',
    now(),
    now()
  )
on conflict (email) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 2) Create the auth.identities rows (email provider)
--    Matches what Supabase writes on a normal email signup.
-- ─────────────────────────────────────────────────────────────

insert into auth.identities (
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    '{"sub":"11111111-1111-4111-8111-111111111111","email":"admin@dcph.ph","email_verified":true,"phone_verified":false}',
    'email',
    now(),
    now(),
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    '22222222-2222-4222-8222-222222222222',
    '{"sub":"22222222-2222-4222-8222-222222222222","email":"member@dcph.ph","email_verified":true,"phone_verified":false}',
    'email',
    now(),
    now(),
    now()
  )
on conflict (provider, provider_id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 3) Promote the demo accounts to their intended roles
--    The prevent_profile_privilege_escalation trigger
--    (migration-security.sql) blocks role changes for non-admins,
--    and the SQL Editor session has no auth.uid() — so we
--    temporarily disable the trigger, update, and re-enable it.
--    The EXCEPTION block guarantees re-enable even on failure.
-- ─────────────────────────────────────────────────────────────

do $$
begin
  alter table public.profiles disable trigger trg_prevent_profile_privilege_escalation;

  update public.profiles set role = 'admin'  where username = 'demo_admin';
  update public.profiles set role = 'member' where username = 'demo_member';

  alter table public.profiles enable trigger trg_prevent_profile_privilege_escalation;
exception when others then
  alter table public.profiles enable trigger trg_prevent_profile_privilege_escalation;
  raise;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 4) Verification — expect 2 rows
-- ─────────────────────────────────────────────────────────────

select
  u.email,
  u.email_confirmed_at is not null as confirmed,
  p.username,
  p.role
from auth.users u
join public.profiles p on p.user_id = u.id
where u.email in ('admin@dcph.ph', 'member@dcph.ph')
order by u.email;
