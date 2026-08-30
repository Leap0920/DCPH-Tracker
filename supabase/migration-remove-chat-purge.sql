-- Remove automatic chat purge: permanently unschedule the pg_cron job and drop purge function.
-- Run in Supabase SQL Editor to disable the auto-delete message feature.

-- 1. Unschedule the pg_cron job if it exists
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-chat-messages') then
    perform cron.unschedule('purge-chat-messages');
  end if;
end $$;

-- 2. Drop the purge function
drop function if exists public.purge_old_chat_messages(interval, integer, integer);
