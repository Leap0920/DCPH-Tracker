-- supabase/migration-streaks.sql
--
-- Daily streaks + TikTok-style revives for the tracker's daily logs.
--
-- WHAT A STREAK IS. One "log day" = a calendar day (Asia/Manila — the
-- audience's timezone) on which at least one watch_event was appended.
-- Consecutive log days stack into the current streak; the streak breaks once a
-- whole calendar day passes with no log.
--
-- WHY A STORED ROW AND NOT A VIEW. A streak needs one fact that watch_events
-- deliberately cannot hold: revives. A revived break is a day WITH NO EVENT
-- that still counts — and that repair must NOT live in watch_events, because
-- fake events would inflate the rolling leaderboards. So the streak state and
-- the revive allowance live in user_streaks, maintained by two SECURITY
-- DEFINER functions; watch_events stays the only judge of "did today get a
-- log". The functions read watch_events directly, so a sync run at any time
-- (page load, after a log, after a missed day) derives the truth from the
-- same append-only source the leaderboards use.
--
-- THE REVIVE RULE (owner's spec): a broken streak can be revived up to
-- 3 times per calendar month; the allowance resets with the month. Reviving
-- heals the gap — the old count plus anything logged since the break become
-- one streak, and the revive covers today, after which normal rules resume.
--
-- NO RETROACTIVE STREAKS, same precedent as migration-watch-events.sql:
-- streaks start accruing at deployment. Past history is not mined, and the
-- created_at backfill from watch_status is an approximation — building
-- streaks on it would fabricate day counts.
--
-- HOW TO RUN. Dashboard SQL Editor, step by step. No script-level BEGIN/COMMIT:
-- every statement is idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP
-- POLICY IF EXISTS before CREATE POLICY), so a failure part-way is repaired by
-- re-running from step 2. (The editor does not honour script-level
-- transactions — the lesson from migration-magic-kaito-1412.sql.)


-- ═══ STEP 1 — PRE-FLIGHT (read-only) ══════════════════════════════════════

-- 1a. The ban-gate helpers must exist (migration-enforce-bans.sql). Expect
--     two rows.
select proname from pg_proc
 where proname in ('is_active', 'is_moderator_or_admin');

-- 1b. The streak's source of truth must exist (migration-watch-events.sql).
select count(*) as watch_events_rows from public.watch_events;

-- 1c. Confirm gen_random_uuid() is available (pgcrypto or PG13+ builtin).
select gen_random_uuid();


-- ═══ STEP 2 — TABLE ═══════════════════════════════════════════════════════

create table if not exists public.user_streaks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  -- The alive streak, as of last_active_date.
  current_streak integer not null default 0 check (current_streak >= 0),
  longest_streak integer not null default 0 check (longest_streak >= 0),
  -- Last Manila day that got a log and counts toward the streak.
  last_active_date date,
  -- The most recent break, held for the revive offer. broken_streak = the
  -- count lost, broken_since = the first missed day. Cleared by a revive.
  broken_streak integer check (broken_streak is null or broken_streak > 0),
  broken_since date,
  -- Revive allowance: usable revives within revive_month (a calendar month).
  revives_used integer not null default 0 check (revives_used >= 0),
  revive_month date not null default date_trunc('month', (now() at time zone 'Asia/Manila'))::date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_streaks is
  'Daily streak state + monthly revive allowance. Written only by the streak_sync()/streak_revive() SECURITY DEFINER functions; clients may read their own row.';


-- ═══ STEP 3 — RLS + GRANTS ════════════════════════════════════════════════

alter table public.user_streaks enable row level security;

-- 3a. Owner-only read. The card reads through streak_sync() anyway; this is
--     for future UI and makes the table useless to anyone else.
drop policy if exists "Users can read own streak" on public.user_streaks;
create policy "Users can read own streak"
  on public.user_streaks for select
  using (auth.uid() = user_id);

-- 3b. BAN GATE. Mirrors the restrictive policies from migration-enforce-bans.sql.
drop policy if exists "Inactive users cannot read streaks" on public.user_streaks;
create policy "Inactive users cannot read streaks"
  on public.user_streaks as restrictive for select
  to authenticated
  using (
    (select public.is_active())
    or (select public.is_moderator_or_admin())
  );

-- 3c. No client-side writes at all. The definer functions are the only
--     writers; revoking the privileges means a future mistaken policy still
--     cannot let a client forge streaks or refill revives.
revoke insert, update, delete on table public.user_streaks from anon, authenticated;
grant select on table public.user_streaks to authenticated;


-- ═══ STEP 4 — FUNCTIONS ═══════════════════════════════════════════════════
-- Both are SECURITY DEFINER: they write user_streaks (which no client role
-- can) and read watch_events to decide "did today get a log". They only ever
-- touch the CALLER'S row (auth.uid()), and refuse inactive accounts the same
-- way RESTRICTIVE policies do elsewhere.

-- 4a. streak_sync(): detect a break, extend on today's first log, roll the
--     monthly revive allowance, and return the snapshot the card renders.
--     Idempotent — safe to call on every page load and after every log.
create or replace function public.streak_sync()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_today   date := (now() at time zone 'Asia/Manila')::date;
  v_month   date := date_trunc('month', (now() at time zone 'Asia/Manila'))::date;
  v_limit   constant integer := 3;   -- revives per calendar month
  r         public.user_streaks%rowtype;
  v_allowed boolean;
  v_logged  boolean;
  v_current integer;
  v_longest integer;
  v_last    date;
  v_broken  integer;
  v_broken_since date;
  v_used    integer;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select (public.is_active() or public.is_moderator_or_admin()) into v_allowed;
  if not coalesce(v_allowed, false) then
    raise exception 'account restricted' using errcode = '42501';
  end if;

  -- Get or create the row, serialized against concurrent syncs.
  select * into r from public.user_streaks where user_id = v_uid for update;
  if not found then
    insert into public.user_streaks (user_id) values (v_uid)
      on conflict (user_id) do nothing;
    select * into r from public.user_streaks where user_id = v_uid for update;
  end if;

  v_current      := r.current_streak;
  v_longest      := r.longest_streak;
  v_last         := r.last_active_date;
  v_broken       := r.broken_streak;
  v_broken_since := r.broken_since;
  -- Monthly reset: the allowance belongs to a calendar month.
  v_used         := case when r.revive_month = v_month then r.revives_used else 0 end;

  -- watch_events is the only judge of "did today get a log".
  select exists (
    select 1 from public.watch_events we
     where we.user_id = v_uid
       and we.created_at >= (v_today::timestamp at time zone 'Asia/Manila')
  ) into v_logged;

  if v_logged and (v_last is null or v_last < v_today) then
    -- First log today: extend the run — unless a whole day already went by,
    -- in which case the previous run is recorded as revivable and a fresh
    -- one starts. (Logging on the very next day never breaks anything.)
    if v_last is not null and (v_today - v_last) >= 2 and v_current > 0 then
      v_broken := v_current;
      v_broken_since := v_last + 1;
    end if;
    v_current := case
      when v_last = v_today - 1 and v_current > 0 then v_current + 1
      else 1
    end;
    v_last := v_today;
    v_longest := greatest(v_longest, v_current);

  elsif not v_logged and v_last is not null
        and (v_today - v_last) >= 2 and v_current > 0 then
    -- A full day passed with no log: the streak broke. Keep it for the
    -- revive offer, then reset.
    v_broken := v_current;
    v_broken_since := v_last + 1;
    v_current := 0;
  end if;

  update public.user_streaks set
    current_streak   = v_current,
    longest_streak   = v_longest,
    last_active_date = v_last,
    broken_streak    = v_broken,
    broken_since     = v_broken_since,
    revives_used     = v_used,
    revive_month     = v_month,
    updated_at       = now()
  where user_id = v_uid;

  return jsonb_build_object(
    'current',         v_current,
    'longest',         v_longest,
    'loggedToday',     v_logged,
    'lastActive',      v_last,
    'brokenStreak',    v_broken,
    'brokenSince',     v_broken_since,
    'revivesUsed',     v_used,
    'revivesLeft',     greatest(0, v_limit - v_used),
    'revivesPerMonth', v_limit
  );
end $$;

comment on function public.streak_sync() is
  'Recomputes the caller''s daily streak from watch_events and returns the card snapshot. Idempotent; safe on every call.';

-- 4b. streak_revive(): heal a break using one of the 3 monthly revives.
create or replace function public.streak_revive()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_today   date := (now() at time zone 'Asia/Manila')::date;
  v_limit   constant integer := 3;
  r         public.user_streaks%rowtype;
  v_allowed boolean;
  v_current integer;
  v_longest integer;
  v_used    integer;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select (public.is_active() or public.is_moderator_or_admin()) into v_allowed;
  if not coalesce(v_allowed, false) then
    raise exception 'account restricted' using errcode = '42501';
  end if;

  -- Sync first: it detects a break that just happened AND applies the
  -- monthly allowance reset, so this never works from stale state.
  perform public.streak_sync();

  select * into r from public.user_streaks where user_id = v_uid for update;

  if r.broken_streak is null then
    raise exception 'Nothing to revive' using errcode = 'P0001', hint = 'no_break';
  end if;
  if r.revives_used >= v_limit then
    raise exception 'No revives left this month' using errcode = 'P0001', hint = 'no_revives';
  end if;

  -- Heal: the lost count + anything logged since the break become one
  -- streak. The revive covers today; normal rules resume tomorrow.
  v_current := r.broken_streak + r.current_streak;
  v_longest := greatest(r.longest_streak, v_current);
  v_used    := r.revives_used + 1;

  update public.user_streaks set
    current_streak   = v_current,
    longest_streak   = v_longest,
    last_active_date = v_today,
    broken_streak    = null,
    broken_since     = null,
    revives_used     = v_used,
    updated_at       = now()
  where user_id = v_uid;

  return jsonb_build_object(
    'current',         v_current,
    'longest',         v_longest,
    'loggedToday',     exists (
      select 1 from public.watch_events we
       where we.user_id = v_uid
         and we.created_at >= (v_today::timestamp at time zone 'Asia/Manila')
    ),
    'lastActive',      v_today,
    'brokenStreak',    null,
    'brokenSince',     null,
    'revivesUsed',     v_used,
    'revivesLeft',     greatest(0, v_limit - v_used),
    'revivesPerMonth', v_limit,
    'revived',         true
  );
end $$;

comment on function public.streak_revive() is
  'Heals the most recent streak break using one of the 3 monthly revives (allowance resets with the calendar month).';

-- 4c. Execution rights: signed-in users only, never anon.
revoke all on function public.streak_sync()   from public, anon;
revoke all on function public.streak_revive() from public, anon;
grant execute on function public.streak_sync()   to authenticated;
grant execute on function public.streak_revive() to authenticated;


-- ═══ STEP 5 — VERIFY ══════════════════════════════════════════════════════

-- 5a. Policies: expect one permissive SELECT (owner) and one restrictive
--     SELECT (ban gate), nothing else.
select policyname, permissive, cmd from pg_policies
 where schemaname = 'public' and tablename = 'user_streaks'
 order by permissive, cmd;

-- 5b. Functions exist and are SECURITY DEFINER (prosecdef = t).
select proname, prosecdef from pg_proc
 where proname in ('streak_sync', 'streak_revive');

-- 5c. After using the app: the row shape you should see.
--     (Run while signed in to the app to bump the row, then inspect here.)
-- select * from public.user_streaks order by updated_at desc limit 5;
