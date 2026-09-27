-- supabase/migration-security-hardening-2.sql
--
-- Second hardening pass. Idempotent: safe to re-run, and safe to run after a
-- fresh schema.sql.
--
-- Contents:
--   1. RLS on site_visits / active_sessions        — were fully unprotected
--   2. profiles INSERT escalation guard            — role='admin' self-insert
--   3. Ban gate on episode_comments                — the one content table missing it
--   4. Missing foreign-key indexes
--   5. updated_at triggers                         — these columns never updated themselves
--   6. Scheduled maintenance (pg_cron)             — leaderboard refresh + table GC
--   7. Re-assert the function revokes that schema.sql's blanket
--      `grant execute on all functions ... to anon` undoes on every re-run
--
-- Run in the Supabase Dashboard SQL Editor (or `psql`), as schema.sql is.
-- Part 6 needs the pg_cron extension, which Supabase provides but only the
-- dashboard/owner can create.

begin;

-- ─────────────────────────────────────────────────────────────
-- 1. RLS on the hero-stats tables
-- ─────────────────────────────────────────────────────────────
-- Both were created without RLS and without grants. Under the documented
-- run-as-postgres workflow, schema.sql's `alter default privileges` (select to
-- anon, all to authenticated) then applies to them, so anon could SELECT every
-- session id / user id and authenticated could rewrite the counters straight
-- through PostgREST — the SECURITY DEFINER RPCs were the only intended door.
--
-- RLS with NO policies plus no grants makes the tables unreachable directly.
-- The RPCs below are re-granted because they read these tables as the definer.

alter table public.site_visits     enable row level security;
alter table public.active_sessions enable row level security;

revoke all on table public.site_visits     from anon, authenticated;
revoke all on table public.active_sessions from anon, authenticated;

create index if not exists idx_active_sessions_user
  on public.active_sessions (user_id);

-- heartbeat() took the caller's word for which user the session belongs to.
-- An authenticated caller is now always recorded as themselves; the parameter
-- is only honoured for an anonymous visitor, who has no identity to check it
-- against (and the column is not readable by anyone — see the revoke above).
create or replace function public.heartbeat(
  p_session_id uuid,
  p_user_id    uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.active_sessions (session_id, user_id, last_seen)
  values (p_session_id, coalesce(auth.uid(), p_user_id), now())
  on conflict (session_id) do update
    set last_seen = now(),
        user_id   = coalesce(auth.uid(), public.active_sessions.user_id);
end;
$$;

revoke all on function public.record_visit() from public;
grant execute on function public.record_visit() to anon, authenticated;
revoke all on function public.heartbeat(uuid, uuid) from public;
grant execute on function public.heartbeat(uuid, uuid) to anon, authenticated;
revoke all on function public.get_site_stats() from public;
grant execute on function public.get_site_stats() to anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. profiles — block role/status tampering on INSERT
-- ─────────────────────────────────────────────────────────────
-- prevent_profile_privilege_escalation() is BEFORE UPDATE only. A user whose
-- profile row is missing (deleted by an admin, or a signup that raced the
-- trigger) could therefore INSERT their own row with role='admin' — the INSERT
-- policy checks only `auth.uid() = user_id`.
--
-- Trusted paths keep full control: the owner (SQL editor / seed scripts),
-- service_role (server code), and handle_new_user() which runs as the owner.
-- A client insert may only create an ordinary, active member.

create or replace function public.prevent_profile_insert_escalation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_role text;
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin')
     or auth.role() = 'service_role' then
    return new;
  end if;

  if new.role is distinct from 'member' or new.status is distinct from 'active' then
    select role into caller_role
    from public.profiles
    where user_id = auth.uid();

    if coalesce(caller_role, 'member') <> 'admin' then
      raise exception 'Not allowed to set role or status on a new profile'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_profile_insert_escalation on public.profiles;
create trigger trg_prevent_profile_insert_escalation
  before insert on public.profiles
  for each row execute function public.prevent_profile_insert_escalation();

-- ─────────────────────────────────────────────────────────────
-- 3. episode_comments — the ban gate the other content tables already have
-- ─────────────────────────────────────────────────────────────
-- migration-enforce-bans.sql covers profiles, watch_status, chat_messages and
-- watch_events but never covered comments, so a banned user could keep posting.
-- SELECT stays open (read-only access, same as chat).

drop policy if exists "Inactive users cannot post episode comments" on public.episode_comments;
create policy "Inactive users cannot post episode comments"
  on public.episode_comments
  as restrictive
  for insert
  to authenticated
  with check ((select public.is_active()));

drop policy if exists "Inactive users cannot edit episode comments" on public.episode_comments;
create policy "Inactive users cannot edit episode comments"
  on public.episode_comments
  as restrictive
  for update
  to authenticated
  using      ((select public.is_active()))
  with check ((select public.is_active()));

drop policy if exists "Inactive users cannot delete episode comments" on public.episode_comments;
create policy "Inactive users cannot delete episode comments"
  on public.episode_comments
  as restrictive
  for delete
  to authenticated
  using ((select public.is_active()) or (select public.is_moderator_or_admin()));

-- ─────────────────────────────────────────────────────────────
-- 4. Missing foreign-key indexes
-- ─────────────────────────────────────────────────────────────
-- Postgres does not index a referencing column for you, and each of these is
-- also an RLS predicate or a delete-cascade path.

create index if not exists idx_chat_messages_user   on public.chat_messages (user_id);
create index if not exists idx_notifications_actor  on public.notifications (actor_id);
create index if not exists idx_notifications_content on public.notifications (content_id);
create index if not exists idx_notifications_room   on public.notifications (room_id);
create index if not exists idx_watch_events_content on public.watch_events (content_id);
create index if not exists idx_user_badges_badge    on public.user_badges (badge_id);

-- ─────────────────────────────────────────────────────────────
-- 5. updated_at maintenance
-- ─────────────────────────────────────────────────────────────
-- profiles / watch_status / episode_comments all carry updated_at and nothing
-- ever set it, so it silently stayed at the row's creation time.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_watch_status_updated_at on public.watch_status;
create trigger trg_watch_status_updated_at
  before update on public.watch_status
  for each row execute function public.set_updated_at();

drop trigger if exists trg_episode_comments_updated_at on public.episode_comments;
create trigger trg_episode_comments_updated_at
  before update on public.episode_comments
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 6. Scheduled maintenance
-- ─────────────────────────────────────────────────────────────

create or replace function public.purge_stale_sessions()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.active_sessions where last_seen < now() - interval '1 day';
$$;

create or replace function public.purge_stale_rate_limits()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.rate_limits where window_start < now() - interval '1 day';
$$;

-- Maintenance functions are for the scheduler and trusted server code only.
revoke all on function public.purge_stale_sessions() from public, anon, authenticated;
revoke all on function public.purge_stale_rate_limits() from public, anon, authenticated;
grant execute on function public.purge_stale_sessions() to service_role;
grant execute on function public.purge_stale_rate_limits() to service_role;

-- refresh_leaderboard() existed from the first schema but nothing ever called
-- it, so the `leaderboard` matview kept whatever it was built with.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'refresh-leaderboard') then
    perform cron.unschedule('refresh-leaderboard');
  end if;
  if exists (select 1 from cron.job where jobname = 'purge-stale-sessions') then
    perform cron.unschedule('purge-stale-sessions');
  end if;
  if exists (select 1 from cron.job where jobname = 'purge-stale-rate-limits') then
    perform cron.unschedule('purge-stale-rate-limits');
  end if;
end $$;

select cron.schedule(
  'refresh-leaderboard',
  '*/15 * * * *',
  $$select public.refresh_leaderboard()$$
);

select cron.schedule(
  'purge-stale-sessions',
  '17 * * * *',
  $$select public.purge_stale_sessions()$$
);

select cron.schedule(
  'purge-stale-rate-limits',
  '23 4 * * *',
  $$select public.purge_stale_rate_limits()$$
);

-- ─────────────────────────────────────────────────────────────
-- 7. Re-assert grants that schema.sql's blanket grants clobber
-- ─────────────────────────────────────────────────────────────
-- schema.sql ends with `grant execute on all functions in schema public to
-- anon`, and an `alter default privileges` that does the same for new
-- functions. Re-running it therefore re-opens everything revoked here and in
-- the earlier migrations — most seriously rate_limit_hit, where the rate-limit
-- counters themselves become writable through PostgREST RPC. Run this file
-- after any schema.sql re-run; the statements are idempotent.

revoke all on function public.rate_limit_hit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer)
  to service_role;

revoke all on function public.is_banned() from public;
revoke all on function public.is_active() from public;
grant execute on function public.is_banned() to authenticated, service_role;
grant execute on function public.is_active() to authenticated, service_role;

revoke all on function public.purge_stale_sessions() from public, anon, authenticated;
revoke all on function public.purge_stale_rate_limits() from public, anon, authenticated;
grant execute on function public.purge_stale_sessions() to service_role;
grant execute on function public.purge_stale_rate_limits() to service_role;

commit;

-- ─────────────────────────────────────────────────────────────
-- Verification (run separately)
-- ─────────────────────────────────────────────────────────────
-- RLS is on and there are no policies for the stats tables:
--   select relname, relrowsecurity from pg_class
--   where relname in ('site_visits', 'active_sessions');
--
-- The new triggers exist:
--   select tgname, relname from pg_trigger t join pg_class c on c.oid = t.tgrelid
--   where not tgisinternal and relname in ('profiles','watch_status','episode_comments');
--
-- The jobs are scheduled:
--   select jobname, schedule, command from cron.job order by jobname;
--
-- A client cannot escalate (run while impersonating a user):
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<some-user-uuid>","role":"authenticated"}';
--   insert into public.profiles (user_id, username, display_name, role)
--   values ('<some-user-uuid>', 'x', 'x', 'admin');  -- expect 42501
