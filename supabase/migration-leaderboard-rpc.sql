-- ═══════════════════════════════════════════════════════════════════════════
-- LEADERBOARD RPC — aggregate in Postgres, one round trip
--
-- WHY THIS EXISTS
-- lib/queries/leaderboard.ts used to read the WHOLE watch_status table (1,000
-- rows per request — PostgREST's cap) and the whole 30-day watch_events window
-- into the serverless function, then aggregate in JavaScript. At the current
-- size that is:
--
--   watch_status  145,810 rows  -> 146 serial requests
--   watch_events  148,675 rows  -> ~149 serial requests (last 30 days)
--
-- ~295 sequential HTTP round trips and ~50 MB of JSON per page view, measured
-- at 187 seconds for /community/rankings. A signed-in user outside the top 100
-- paid it twice (the old "your rank" fallback paged watch_status again).
--
-- This function returns at most a few hundred rows and does the aggregation
-- where the data lives: one request, a few KB.
--
-- SEMANTICS — a deliberate 1:1 mirror of lib/leaderboard-periods.ts and the
-- loops it replaces. Change one, change the other:
--
--   * all-time   one row per (user, content) with status watched/rewatched.
--                minutes = runtime_minutes when > 0, else the type default from
--                lib/runtime-defaults.ts, times GREATEST(watch_count, 1) — the
--                floor-of-one view rule, so rewatches are time spent twice.
--   * windows    ROLLING 30 and 7 days (not calendar periods), DISTINCT content
--                per window: events are append-only and unwatching does not
--                remove them, so counting raw events would let anyone farm the
--                board with mark-all / unwatch / mark-all.
--   * board      users contributing to any tab, joined to profiles; rows with
--                no all-time count AND no month count are dropped.
--   * ordering   watched_count desc, then total_minutes desc; rank is the
--                ALL-TIME rank (the client renumbers per tab).
--   * extras     the top month performers who missed the all-time cut are
--                appended, so a newcomer can top the 7-day tab.
--   * p_user_id  that user's row is always returned (with its true all-time
--                rank), which is how the page shows "Your Standing" without a
--                second full read.
--
-- APPLY: Dashboard → SQL Editor. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── runtime fallback, mirroring lib/runtime-defaults.ts ────────────────────
-- DEFAULT_RUNTIME_MINUTES in that file is the single source of truth; this is
-- its SQL twin. A NULL or 0 runtime must never count as zero minutes — that is
-- how a user who watched 500 episodes once showed ~0 watch time.
create or replace function public.leaderboard_runtime_minutes(
  p_runtime_minutes integer,
  p_type text
)
returns integer
language sql
immutable
as $$
  select case
    when p_runtime_minutes is not null and p_runtime_minutes > 0 then p_runtime_minutes
    else coalesce(
      case p_type
        when 'episode'       then 25
        when 'special'       then 46
        when 'ova'           then 25
        when 'movie'         then 110
        when 'live_action'   then 46
        when 'magic_kaito'   then 24
        when 'hanzawa'       then 10
        when 'zero_tea_time' then 15
      end,
      25
    )
  end;
$$;

revoke all on function public.leaderboard_runtime_minutes(integer, text) from public;


-- ── the board ──────────────────────────────────────────────────────────────
-- Drop-then-create (not CREATE OR REPLACE): the OUT parameter list is part of
-- the signature, so a future change to it would fail to replace in place.
drop function if exists public.get_leaderboard(integer, uuid);

create function public.get_leaderboard(
  p_limit integer default 100,
  p_user_id uuid default null
)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  watched_count integer,
  total_minutes bigint,
  rewatched_count integer,
  total_views bigint,
  movie_count integer,
  episode_count integer,
  month_count integer,
  month_minutes bigint,
  month_movie_count integer,
  month_episode_count integer,
  week_count integer,
  week_minutes bigint,
  week_movie_count integer,
  week_episode_count integer,
  rank integer
)
language sql
stable
security definer
set search_path = public
as $$
with
-- ── all-time, from watch_status ────────────────────────────────────────────
all_time as (
  select
    ws.user_id,
    count(*)::integer as watched_count,
    coalesce(sum(
      public.leaderboard_runtime_minutes(ce.runtime_minutes, ce.type)
      * greatest(coalesce(ws.watch_count, 0), 1)
    ), 0)::bigint as total_minutes,
    count(*) filter (where ws.status = 'rewatched')::integer as rewatched_count,
    coalesce(sum(coalesce(ws.watch_count, 0)), 0)::bigint as total_views,
    count(*) filter (where ce.type = 'movie')::integer as movie_count,
    count(*) filter (where ce.type = 'episode')::integer as episode_count
  from public.watch_status ws
  left join public.content_entries ce on ce.id = ws.content_id
  where ws.status in ('watched', 'rewatched')
  group by ws.user_id
),

-- ── the rolling window, from the event log ─────────────────────────────────
-- Future-dated rows are dropped, never clamped: a bad timestamp must not
-- inflate a ranking.
window_events as (
  select
    we.user_id,
    we.content_id,
    we.created_at,
    public.leaderboard_runtime_minutes(ce.runtime_minutes, ce.type) as minutes,
    ce.type
  from public.watch_events we
  left join public.content_entries ce on ce.id = we.content_id
  where we.created_at >= now() - interval '30 days'
    and we.created_at <= now()
),

month_distinct as (
  select distinct on (we.user_id, we.content_id)
    we.user_id, we.content_id, we.minutes, we.type
  from window_events we
  order by we.user_id, we.content_id, we.created_at
),
month_totals as (
  select
    md.user_id,
    count(*)::integer as month_count,
    sum(md.minutes)::bigint as month_minutes,
    count(*) filter (where md.type = 'movie')::integer as month_movie_count,
    count(*) filter (where md.type = 'episode')::integer as month_episode_count
  from month_distinct md
  group by md.user_id
),

week_distinct as (
  select distinct on (we.user_id, we.content_id)
    we.user_id, we.content_id, we.minutes, we.type
  from window_events we
  where we.created_at >= now() - interval '7 days'
  order by we.user_id, we.content_id, we.created_at
),
week_totals as (
  select
    wd.user_id,
    count(*)::integer as week_count,
    sum(wd.minutes)::bigint as week_minutes,
    count(*) filter (where wd.type = 'movie')::integer as week_movie_count,
    count(*) filter (where wd.type = 'episode')::integer as week_episode_count
  from week_distinct wd
  group by wd.user_id
),

-- ── everyone who contributes to any tab ────────────────────────────────────
-- A union, not just all_time: someone who watched something recently and has
-- since set it back to unwatched has events in the window but no qualifying
-- watch_status row. They belong on the period boards.
contributors as (
  select a.user_id from all_time a
  union
  select m.user_id from month_totals m
  union
  select w.user_id from week_totals w
),

board as (
  select
    c.user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    coalesce(a.watched_count, 0)::integer as watched_count,
    coalesce(a.total_minutes, 0)::bigint as total_minutes,
    coalesce(a.rewatched_count, 0)::integer as rewatched_count,
    coalesce(a.total_views, 0)::bigint as total_views,
    coalesce(a.movie_count, 0)::integer as movie_count,
    coalesce(a.episode_count, 0)::integer as episode_count,
    coalesce(m.month_count, 0)::integer as month_count,
    coalesce(m.month_minutes, 0)::bigint as month_minutes,
    coalesce(m.month_movie_count, 0)::integer as month_movie_count,
    coalesce(m.month_episode_count, 0)::integer as month_episode_count,
    coalesce(w.week_count, 0)::integer as week_count,
    coalesce(w.week_minutes, 0)::bigint as week_minutes,
    coalesce(w.week_movie_count, 0)::integer as week_movie_count,
    coalesce(w.week_episode_count, 0)::integer as week_episode_count
  from contributors c
  join public.profiles p on p.user_id = c.user_id
  left join all_time a on a.user_id = c.user_id
  left join month_totals m on m.user_id = c.user_id
  left join week_totals w on w.user_id = c.user_id
),

-- Drop profiles that contribute nothing to any tab (the unwatched-everything
-- case, once its events age out of the 30-day window).
filtered as (
  select b.* from board b
  where b.watched_count > 0 or b.month_count > 0
),

ranked as (
  select
    f.*,
    (row_number() over (order by f.watched_count desc, f.total_minutes desc))::integer as rank
  from filtered f
),

kept as (
  select r.* from ranked r order by r.rank limit greatest(p_limit, 0)
),

-- A newcomer can top the 7-day board while sitting far below the all-time cut;
-- without this the period tabs would simply never show them.
extras as (
  select r.* from ranked r
  where r.month_count > 0
    and r.user_id not in (select k.user_id from kept k)
  order by r.month_count desc, r.month_minutes desc
  limit greatest(p_limit, 0)
),

-- The caller's own row, so the page can show their standing (and true rank)
-- without re-reading the table.
mine as (
  select r.* from ranked r
  where p_user_id is not null and r.user_id = p_user_id
),

final as (
  select f.* from kept f
  union
  select f.* from extras f
  union
  select f.* from mine f
)

select
  f.user_id,
  f.username,
  f.display_name,
  f.avatar_url,
  f.watched_count,
  f.total_minutes,
  f.rewatched_count,
  f.total_views,
  f.movie_count,
  f.episode_count,
  f.month_count,
  f.month_minutes,
  f.month_movie_count,
  f.month_episode_count,
  f.week_count,
  f.week_minutes,
  f.week_movie_count,
  f.week_episode_count,
  f.rank
from final f
order by f.rank;
$$;

revoke all on function public.get_leaderboard(integer, uuid) from public;
grant execute on function public.get_leaderboard(integer, uuid) to anon, authenticated;
