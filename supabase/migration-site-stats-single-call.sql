-- ─────────────────────────────────────────────────────────────
-- SITE-STATS RPCs — single-round-trip variants
--
-- The homepage hero currently costs two PostgREST requests per cycle:
--   record_visit() + get_site_stats()   (first visit)
--   heartbeat()    + get_site_stats()   (every 60s per open tab)
-- Every request is ingested into the Supabase log quota, so the homepage
-- alone is a large slice of this project's log volume. These wrappers do
-- the write and the read in ONE request.
--
-- The client (lib/queries/client/stats.ts) tries these first and falls
-- back to the old two-call pair when they are missing (PGRST202), so this
-- file can be applied — or rolled back — independently of any deploy.
--
-- Paste into Dashboard → SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- heartbeat + stats
drop function if exists public.heartbeat_and_get_stats(uuid, uuid);

create function public.heartbeat_and_get_stats(
  p_session_id uuid,
  p_user_id uuid default null
)
returns table (total_visits bigint, active_now bigint, tracked_episodes bigint)
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.active_sessions (session_id, user_id, last_seen)
  values (p_session_id, p_user_id, now())
  on conflict (session_id) do update
    set last_seen = now(),
        user_id = coalesce(p_user_id, public.active_sessions.user_id);

  return query
    select v.total,
      (select count(*) from public.active_sessions
       where last_seen > now() - interval '2 minutes'),
      (select count(*) from public.watch_status
       where status in ('watched', 'rewatched'))
    from public.site_visits v where v.id = true;
end;
$$;

-- record_visit + stats
drop function if exists public.record_visit_and_get_stats();

create function public.record_visit_and_get_stats()
returns table (total_visits bigint, active_now bigint, tracked_episodes bigint)
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.site_visits (id, total) values (true, 1)
  on conflict (id) do update
    set total = public.site_visits.total + 1, updated_at = now();

  return query
    select v.total,
      (select count(*) from public.active_sessions
       where last_seen > now() - interval '2 minutes'),
      (select count(*) from public.watch_status
       where status in ('watched', 'rewatched'))
    from public.site_visits v where v.id = true;
end;
$$;

revoke all on function public.heartbeat_and_get_stats(uuid, uuid) from public;
grant execute on function public.heartbeat_and_get_stats(uuid, uuid) to anon, authenticated;
revoke all on function public.record_visit_and_get_stats() from public;
grant execute on function public.record_visit_and_get_stats() to anon, authenticated;
