-- ─────────────────────────────────────────────────────────────
-- HERO LIVE STATS (all-time visits + active right now + episodes tracked)
-- Tracks a global visit counter plus the set of currently-active
-- browser sessions so the homepage hero can show "N all-time
-- visits", "M detectives active right now", and "K episodes tracked".
--
-- Standalone idempotent migration — paste into the Supabase
-- Dashboard SQL Editor AFTER schema.sql. Safe to re-run: tables use
-- `create ... if not exists`; the RPCs use drop-first + `create or
-- replace` (the `get_site_stats` drop is required because PostgreSQL
-- 42P13 forbids return-type changes via `CREATE OR REPLACE`) and grants
-- re-apply after.
-- The RPCs are `security definer` with explicit anon/authenticated
-- grants so unauthenticated homepage visitors can call them
-- (RLS is bypassed by the definer — precedent: get_content_rating).
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────
-- HERO LIVE STATS (all-time visits + active right now + episodes tracked)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.site_visits (
  id         boolean primary key default true check (id),
  total      bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.site_visits (id, total) values (true, 0) on conflict (id) do nothing;

create table if not exists public.active_sessions (
  session_id uuid primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  last_seen  timestamptz not null default now()
);

create or replace function public.record_visit()
returns bigint language plpgsql security definer set search_path = public
as $$
begin
  insert into public.site_visits (id, total) values (true, 1)
  on conflict (id) do update
    set total = public.site_visits.total + 1, updated_at = now();
  return (select total from public.site_visits where id = true);
end;
$$;

create or replace function public.heartbeat(p_session_id uuid, p_user_id uuid default null)
returns void language plpgsql security definer set search_path = public
as $$
begin
  insert into public.active_sessions (session_id, user_id, last_seen)
  values (p_session_id, p_user_id, now())
  on conflict (session_id) do update
    set last_seen = now(),
        user_id = coalesce(p_user_id, public.active_sessions.user_id);
end;
$$;

-- 42P13 guard: CREATE OR REPLACE cannot change a function's return type,
-- so drop first. Grants below re-apply after (idempotent for ANY prior
-- state: never pasted / old 2-column version / this version re-run).
drop function if exists public.get_site_stats();

create or replace function public.get_site_stats()
returns table (total_visits bigint, active_now bigint, tracked_episodes bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  return query
    select v.total,
      (select count(*) from public.active_sessions
       where last_seen > now() - interval '2 minutes'),
      (select count(*) from public.watch_status
       where status in ('watched', 'rewatched'))
    from public.site_visits v where v.id = true;
end;
$$;

revoke all on function public.record_visit() from public;
grant execute on function public.record_visit() to anon, authenticated;
revoke all on function public.heartbeat(uuid, uuid) from public;
grant execute on function public.heartbeat(uuid, uuid) to anon, authenticated;
revoke all on function public.get_site_stats() from public;
grant execute on function public.get_site_stats() to anon, authenticated;
