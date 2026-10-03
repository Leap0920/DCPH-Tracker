-- supabase/migration-watch-events.sql
--
-- Append-only log of watch events, so period leaderboards (last 7 / 30 days) can
-- be computed from real data instead of the invented multipliers currently in
-- components/community/RankingsBoard.tsx (watched_count * 0.28 for "month",
-- * 0.08 for "week").
--
-- WHY A NEW TABLE. watch_status holds one row per (user_id, content_id) and is
-- overwritten in place on every change. watch_status.created_at is the first-track
-- time and updated_at is clobbered by unrelated edits (favoriting, rating), so
-- NOTHING in the current schema records when a watch happened. No query against
-- the existing tables can produce a true 7- or 30-day count; that is why the
-- client resorted to multiplying.
--
-- APPEND-ONLY BY DESIGN. There is no UPDATE and no DELETE policy. Combined with
-- counting DISTINCT content_id per window (see lib/leaderboard-periods.ts), this
-- closes an inflation vector: without it, mark-all -> unwatch -> mark-all again
-- would pile up events and farm the period boards. Unwatching an entry does NOT
-- remove its event — the watch did happen.
--
-- HOW TO RUN. Dashboard SQL Editor, step by step. No script-level BEGIN/COMMIT:
-- every statement is idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS before
-- CREATE POLICY), so a failure part-way is repaired by re-running from step 2.
-- This is the same lesson as migration-magic-kaito-1412.sql, which failed because
-- the editor does not honour script-level transactions.
--
-- PERIODS START ACCRUING AT DEPLOYMENT. Real history does not exist. Step 5 is an
-- OPTIONAL best-effort backfill from watch_status.created_at. Without it, both
-- period tabs are empty until users track things.


-- ═══ STEP 1 — PRE-FLIGHT (read-only) ══════════════════════════════════════

-- 1a. Print the existing policies on watch_status. Step 4 needs the EXACT
--     predicate from your restrictive "inactive users cannot ..." ban-gate policy,
--     so watch_events refuses banned accounts the same way. Copy the `qual` /
--     `with_check` text from the restrictive row into the marked spot in 4c.
select policyname, permissive, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'watch_status'
 order by permissive, cmd;

-- 1b. How much would the optional step 5 backfill insert, and how far back does
--     it reach? One event per existing tracked row.
select count(*)                                                   as backfill_rows,
       min(created_at)::date                                      as oldest,
       max(created_at)::date                                      as newest,
       count(*) filter (where created_at >= now() - interval '30 days') as within_30d,
       count(*) filter (where created_at >= now() - interval '7 days')  as within_7d
  from public.watch_status
 where status in ('watched', 'rewatched');

-- 1c. Confirm gen_random_uuid() is available (pgcrypto or PG13+ builtin).
select gen_random_uuid();


-- ═══ STEP 2 — TABLE ═══════════════════════════════════════════════════════

create table if not exists public.watch_events (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id)            on delete cascade,
  content_id uuid        not null references public.content_entries(id) on delete cascade,
  -- 'watched' = first time through, 'rewatched' = a repeat view. Kept distinct so
  -- future features (streaks, "new this week") can tell them apart; the period
  -- aggregation currently treats both as one view.
  event_type text        not null check (event_type in ('watched', 'rewatched')),
  -- 'single' = one deliberate tap, 'bulk' = part of a mark-all, 'backfill' =
  -- synthesised in step 5 from watch_status.created_at and NOT a recorded event.
  -- Tagging backfill rows means they can be identified or removed later:
  --   delete from public.watch_events where source = 'backfill';
  source     text        not null default 'single'
               check (source in ('single', 'bulk', 'backfill')),
  created_at timestamptz not null default now()
);

comment on table public.watch_events is
  'Append-only watch log powering the rolling 7/30-day leaderboards. No UPDATE or DELETE policy: history is immutable once written.';

-- Period queries always filter created_at >= now() - N days and then group by
-- user, so this index order matches the access path and keeps the scan bounded to
-- the window rather than the whole table.
create index if not exists watch_events_created_at_idx
  on public.watch_events (created_at desc);

create index if not exists watch_events_user_created_idx
  on public.watch_events (user_id, created_at desc);


-- ═══ STEP 3 — DEFENCE IN DEPTH: block UPDATE and DELETE outright ══════════
-- RLS with no UPDATE/DELETE policy already denies both. Revoking the privileges
-- as well means a future permissive policy added by mistake still cannot rewrite
-- history.
revoke update, delete on table public.watch_events from anon, authenticated;
grant  select, insert on table public.watch_events to   anon, authenticated;


-- ═══ STEP 4 — RLS ═════════════════════════════════════════════════════════
alter table public.watch_events enable row level security;

-- 4a. PUBLIC READ. This is forced, not a preference: SUPABASE_SERVICE_ROLE_KEY is
--     not configured in this project's runtime (createAdminClient() returns
--     null), so lib/queries/leaderboard.ts reads with the ordinary client. An
--     owner-only select policy would make every other user's rows invisible and
--     the leaderboard would show only you. Mirrors the existing
--     "Watch status is publicly readable" policy — the same data is already
--     public through watch_status.
drop policy if exists "Watch events are publicly readable" on public.watch_events;
create policy "Watch events are publicly readable"
  on public.watch_events for select
  using (true);

-- 4b. Insert own rows only. The client sets user_id explicitly; this makes a
--     tampered value unusable.
drop policy if exists "Users can insert own watch events" on public.watch_events;
create policy "Users can insert own watch events"
  on public.watch_events for insert
  with check (auth.uid() = user_id);

-- 4c. BAN GATE. Mirrors the restrictive "Inactive users cannot delete watch
--     status" policy from supabase/migration-enforce-bans.sql verbatim: this
--     project gates bans with the SQL functions public.is_active() and
--     public.is_moderator_or_admin(), NOT a profiles.is_active column (an earlier
--     draft assumed that column and failed with 42703: column p.is_active does
--     not exist).
drop policy if exists "Inactive users cannot insert watch events" on public.watch_events;
create policy "Inactive users cannot insert watch events"
  on public.watch_events as restrictive for insert
  to authenticated
  with check (
    (select public.is_active())
    or (select public.is_moderator_or_admin())
  );

-- No UPDATE policy. No DELETE policy. Intentional — see the header.


-- ═══ STEP 5 — OPTIONAL BACKFILL ═══════════════════════════════════════════
-- Synthesises ONE event per currently-tracked entry, timestamped with
-- watch_status.created_at (when the row was first created, i.e. first tracked).
--
-- WHAT THIS IS: a defensible approximation of first-watch time.
-- WHAT IT IS NOT: proof of a watch date, and it recovers NO rewatches — an entry
--   watched five times contributes one event.
-- Every row is tagged source='backfill'. Fully reversible:
--   delete from public.watch_events where source = 'backfill';
--
-- Skip this step entirely if you would rather the period boards start empty and
-- contain only genuine events. Re-running it inserts nothing (NOT EXISTS guard).
insert into public.watch_events (user_id, content_id, event_type, source, created_at)
select ws.user_id,
       ws.content_id,
       'watched',
       'backfill',
       ws.created_at
  from public.watch_status ws
 where ws.status in ('watched', 'rewatched')
   and not exists (
     select 1 from public.watch_events we
      where we.user_id    = ws.user_id
        and we.content_id = ws.content_id
        and we.source     = 'backfill'
   );


-- ═══ STEP 6 — VERIFY ══════════════════════════════════════════════════════

-- 6a. Policies: expect exactly one permissive SELECT, one permissive INSERT, one
--     restrictive INSERT, and NO update/delete rows at all.
select policyname, permissive, cmd from pg_policies
 where schemaname = 'public' and tablename = 'watch_events'
 order by permissive, cmd;

-- 6b. Shape of what now exists, by source.
select source, event_type, count(*), min(created_at)::date, max(created_at)::date
  from public.watch_events
 group by source, event_type
 order by source, event_type;

-- 6c. The exact query shape lib/queries/leaderboard.ts will run — check it
--     returns promptly and the numbers are plausible. DISTINCT content per user
--     is what the app counts.
select we.user_id,
       count(distinct we.content_id)                                   as entries_30d,
       count(distinct we.content_id) filter (where ce.type = 'movie')  as movies_30d
  from public.watch_events we
  join public.content_entries ce on ce.id = we.content_id
 where we.created_at >= now() - interval '30 days'
 group by we.user_id
 order by entries_30d desc
 limit 10;

-- 6d. Confirm immutability from the client's perspective. Run in the app as a
--     signed-in non-admin, NOT here (the editor bypasses RLS):
--       await supabase.from("watch_events").delete().eq("user_id", myId)
--     Expect zero rows affected.
