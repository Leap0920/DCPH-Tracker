-- =============================================================================
-- Protect the system owner account (carlobaclao789@gmail.com)
--
-- No other admin may delete, ban, suspend, or demote the owner — not even
-- through the service_role key, because these triggers have NO service_role
-- bypass (unlike prevent_profile_privilege_escalation, which is left untouched).
--
-- Idempotent: safe to re-run.
-- How to run: Supabase Dashboard → SQL Editor → paste → Run.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Owner identity resolution
-- -----------------------------------------------------------------------------

-- Single source of truth for the owner email.
create or replace function public.system_owner_email()
returns text
language sql
immutable
as $$
  select 'carlobaclao789@gmail.com'::text
$$;

-- SECURITY DEFINER: auth.users is not readable by `authenticated`, and this is
-- called from triggers that fire on ordinary user self-updates.
create or replace function public.system_owner_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(public.system_owner_email())
  order by u.created_at asc
  limit 1
$$;

create or replace function public.is_system_owner(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select uid is not null and uid = public.system_owner_id()
$$;

revoke all on function public.system_owner_id()      from public;
revoke all on function public.is_system_owner(uuid)  from public;
grant execute on function public.system_owner_id()     to authenticated, service_role;
grant execute on function public.is_system_owner(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. profiles guard: BEFORE UPDATE / BEFORE DELETE, no service_role bypass
-- -----------------------------------------------------------------------------

create or replace function public.protect_system_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.system_owner_id();
begin
  -- Owner account does not exist (fresh DB / different env): nothing to guard.
  if v_owner is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.user_id = v_owner then
      raise exception
        'The system owner account is protected and cannot be deleted.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  -- UPDATE: guard the owner row, and guard re-pointing another row at the owner.
  if old.user_id = v_owner or new.user_id = v_owner then
    if new.user_id         is distinct from old.user_id
    or new.role            is distinct from old.role
    or new.status          is distinct from old.status
    or new.ban_reason      is distinct from old.ban_reason
    or new.banned_at       is distinct from old.banned_at
    or new.suspended_until is distinct from old.suspended_until
    then
      raise exception
        'The system owner account is protected: role, status, and ban fields cannot be changed.'
        using errcode = '42501';
    end if;
  end if;

  -- Non-protected columns (display_name, avatar_url, ...) pass through.
  return new;
end
$$;

-- Named `a_...` so it sorts first among BEFORE triggers on profiles.
drop trigger if exists a_protect_system_owner   on public.profiles;
drop trigger if exists trg_protect_system_owner on public.profiles;

create trigger a_protect_system_owner
before update or delete on public.profiles
for each row execute function public.protect_system_owner();

commit;

-- =============================================================================
-- Optional (recommended) — block it at auth.users too
--
-- Gives deleteUser a clean error instead of a cascade abort, blocks GoTrue-
-- level bans, and locks the owner's email so the lookup above can't be
-- defeated by reassigning the email.
--
-- NOTE: a BEFORE UPDATE trigger on auth.users sits in the login path
-- (last_sign_in_at updates). This function only raises for the owner's row
-- on protected-field changes, so normal logins are unaffected — but test a
-- login right after applying it. If anything breaks, run:
--   drop trigger a_protect_system_owner_auth on auth.users;
-- =============================================================================

begin;

create or replace function public.protect_system_owner_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.system_owner_id();
begin
  if v_owner is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.id = v_owner then
      raise exception
        'The system owner account is protected and cannot be deleted.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if old.id = v_owner then
    if lower(coalesce(new.email, '')) is distinct from lower(coalesce(old.email, '')) then
      raise exception 'The system owner email cannot be changed.'
        using errcode = '42501';
    end if;

    -- to_jsonb keeps this version-proof: if the column does not exist in this
    -- GoTrue version, both sides read NULL and the check is a no-op.
    if (pg_catalog.to_jsonb(new) ->> 'banned_until')
       is distinct from (pg_catalog.to_jsonb(old) ->> 'banned_until') then
      raise exception 'The system owner cannot be banned.'
        using errcode = '42501';
    end if;

    if (pg_catalog.to_jsonb(new) ->> 'deleted_at')
       is distinct from (pg_catalog.to_jsonb(old) ->> 'deleted_at') then
      raise exception 'The system owner cannot be soft-deleted.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists a_protect_system_owner_auth on auth.users;

create trigger a_protect_system_owner_auth
before update or delete on auth.users
for each row execute function public.protect_system_owner_auth();

commit;

-- =============================================================================
-- Verification (run separately after applying)
-- =============================================================================
-- -- expect: the owner's uuid
-- select public.system_owner_id();
--
-- -- expect: true
-- select public.is_system_owner(public.system_owner_id());
--
-- -- expect: ERROR 42501 for all three
-- update public.profiles set role = 'member' where user_id = public.system_owner_id();
-- update public.profiles set status = 'banned' where user_id = public.system_owner_id();
-- delete from public.profiles where user_id = public.system_owner_id();
--
-- -- expect: success (non-protected column)
-- update public.profiles set display_name = display_name where user_id = public.system_owner_id();
