-- Automatic chat purge: chat_messages older than 12 hours are deleted.
-- Run top-to-bottom in the Supabase Dashboard SQL Editor. Idempotent.
--
-- Mechanism: pg_cron inside Postgres, NOT Vercel Cron.
--   * Vercel Hobby allows 2 cron jobs at daily granularity; vercel.json already
--     uses both, and "every 12 hours" is not expressible there.
--   * A purge deletes other users' rows, so an app route would need the
--     service-role key, which is not configured in every environment.
--   * A DB-side job keeps the table bounded even while the app is down.

-- ═══ STEP 1 — extension ═══════════════════════════════════════════════
-- If this errors, enable pg_cron in Dashboard → Database → Extensions,
-- then re-run this file from STEP 2.
create extension if not exists pg_cron;

-- ═══ STEP 2 — index the purge predicate ═══════════════════════════════
-- Without this, every run seq-scans the table. Brief write lock while it
-- builds; the table is small, so this is a sub-second operation here.
create index if not exists chat_messages_created_at_idx
  on public.chat_messages (created_at);

-- ═══ STEP 3 — the purge function ══════════════════════════════════════
-- SECURITY DEFINER because RLS only lets a user delete their OWN messages.
-- Owned by postgres, so it bypasses RLS as the table owner.
-- Deletes in batches: one 50k-row DELETE would hold locks and dump 50k
-- realtime events at once. SKIP LOCKED so a concurrent unsend never blocks it.
create or replace function public.purge_old_chat_messages(
  p_retention  interval default interval '12 hours',
  p_batch_size integer  default 500,
  p_max_rows   integer  default 100000   -- safety valve for a first huge run
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch integer;
  v_total integer := 0;
begin
  loop
    delete from public.chat_messages
     where id in (
       select id
         from public.chat_messages
        where created_at < now() - p_retention
        order by created_at
        limit p_batch_size
        for update skip locked
     );
    get diagnostics v_batch = row_count;
    v_total := v_total + v_batch;
    exit when v_batch = 0 or v_total >= p_max_rows;
  end loop;

  raise log 'purge_old_chat_messages: deleted % row(s) older than %',
    v_total, p_retention;
  return v_total;
end;
$$;

-- ═══ STEP 4 — LOCK IT DOWN (do not skip) ══════════════════════════════
-- Postgres grants EXECUTE on new functions to PUBLIC by default. Left as-is,
-- ANY logged-in user could call this RPC with interval '0 seconds' and wipe
-- the entire chat. These revokes are the whole reason this file is not just
-- STEP 3 plus a schedule.
revoke all on function public.purge_old_chat_messages(interval, integer, integer)
  from public;
revoke all on function public.purge_old_chat_messages(interval, integer, integer)
  from anon, authenticated;
grant execute on function public.purge_old_chat_messages(interval, integer, integer)
  to postgres, service_role;

-- ═══ STEP 5 — dry run before scheduling ═══════════════════════════════
-- How many rows would go right now:
select count(*) as would_delete
  from public.chat_messages
 where created_at < now() - interval '12 hours';

-- Optional one-shot to clear the existing backlog (returns rows deleted):
-- select public.purge_old_chat_messages();

-- ═══ STEP 6 — schedule ════════════════════════════════════════════════
-- Hourly, at :07. Rolling retention: a message lives at most 12 hours and
-- disappears quietly once it is far off-screen. Hourly (not 12-hourly) runs
-- keep each batch tiny and spread the realtime DELETE traffic.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-chat-messages') then
    perform cron.unschedule('purge-chat-messages');
  end if;
end $$;

select cron.schedule(
  'purge-chat-messages',
  '7 * * * *',
  $$select public.purge_old_chat_messages(interval '12 hours')$$
);

-- Literal alternative — wipe the ENTIRE chat twice a day instead. NOT
-- recommended: it deletes messages posted seconds earlier, mid-conversation.
--   select cron.unschedule('purge-chat-messages');
--   select cron.schedule('purge-chat-messages', '0 0,12 * * *',
--     $$select public.purge_old_chat_messages(interval '0 seconds')$$);

-- ═══ STEP 7 — observability ═══════════════════════════════════════════
-- pg_cron records every run, so no bespoke audit table is needed.
select jobid, jobname, schedule, active, command
  from cron.job
 where jobname = 'purge-chat-messages';

-- Rows deleted per run land in return_message. Check after the first hour:
select runid, status, return_message, start_time, end_time
  from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'purge-chat-messages')
 order by start_time desc
 limit 20;

-- Table size trend:
select pg_size_pretty(pg_total_relation_size('public.chat_messages')) as total_size,
       count(*) as rows,
       min(created_at) as oldest
  from public.chat_messages;
