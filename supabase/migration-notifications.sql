-- ─────────────────────────────────────────────────────────────
-- IN-APP NOTIFICATIONS (Notification Bell)
-- Creates the `notifications` table with RLS + security-definer
-- triggers that fire on new episode comments and chat @mentions.
--
-- USER MUST RUN THIS IN THE SUPABASE DASHBOARD SQL EDITOR.
-- (DDL requires the Dashboard in this environment — the app never
-- touches this with the admin client; notification rows are written
-- by these SECURITY DEFINER triggers and read by the authenticated
-- client through the RLS policies below.)
--
-- Standalone idempotent migration — paste into the Supabase
-- Dashboard SQL Editor AFTER schema.sql and
-- migration-episode-comments.sql. Safe to re-run.
--
-- Verified against the live schema:
--   episode_comments: id, content_id, user_id, body, created_at,
--                     updated_at (supabase/migration-episode-comments.sql:17-24)
--   chat_messages:    id, room_id, user_id, content, created_at
--                     (supabase/schema.sql:147-153)
--   profiles:         user_id, username (supabase/schema.sql:28-39)
--   content_entries:  id (supabase/schema.sql:72-87)
--   chat_rooms:       id (supabase/schema.sql:127-134)
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────
-- NOTIFICATIONS TABLE
-- ─────────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  actor_id   uuid references auth.users(id) on delete cascade,
  type       text not null check (type in ('comment_reply','chat_mention')),
  content_id uuid references public.content_entries(id) on delete cascade,
  room_id    uuid references public.chat_rooms(id) on delete cascade,
  message    text not null,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user
  on public.notifications(user_id, is_read, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Own-rows only: the authenticated client (the bell's /api/notifications
-- route) can list its own notifications and mark them read. Inserts are
-- performed exclusively by the SECURITY DEFINER triggers below, which
-- bypass RLS.
-- ─────────────────────────────────────────────────────────────
alter table public.notifications enable row level security;

grant select, insert, update, delete on public.notifications to authenticated;
grant select on public.notifications to anon;

drop policy if exists "Users can view own notifications" on public.notifications;
create policy "Users can view own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

drop policy if exists "Users can update own notifications" on public.notifications;
create policy "Users can update own notifications"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- COMMENT THREAD TRIGGER
-- When a comment is posted on a content entry, notify every OTHER
-- user who already commented on that entry (reply-threading does
-- not exist yet, so "someone replied to the thread you're in" is
-- the closest signal).
-- ─────────────────────────────────────────────────────────────
create or replace function public.notify_comment_thread()
returns trigger
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, actor_id, type, content_id, message)
  select distinct c.user_id, new.user_id, 'comment_reply', new.content_id,
         '@' || (select username from public.profiles p where p.user_id = new.user_id) || ' commented on an episode you discussed'
  from public.episode_comments c
  where c.content_id = new.content_id and c.user_id <> new.user_id
  on conflict do nothing;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_notify_comment_thread on public.episode_comments;
create trigger trg_notify_comment_thread
  after insert on public.episode_comments
  for each row execute function public.notify_comment_thread();

-- ─────────────────────────────────────────────────────────────
-- CHAT MENTION TRIGGER
-- When a chat message contains "@<username>", notify that user.
-- ─────────────────────────────────────────────────────────────
create or replace function public.notify_chat_mention()
returns trigger
security definer
set search_path = public
as $$
declare
  m record;
begin
  for m in
    select user_id, username from public.profiles
    where new.content ilike '%@' || username || '%' and user_id <> new.user_id
  loop
    insert into public.notifications (user_id, actor_id, type, room_id, message)
    values (m.user_id, new.user_id, 'chat_mention', new.room_id,
            '@' || (select username from public.profiles p where p.user_id = new.user_id) || ' mentioned you in chat');
  end loop;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_notify_chat_mention on public.chat_messages;
create trigger trg_notify_chat_mention
  after insert on public.chat_messages
  for each row execute function public.notify_chat_mention();

-- ─────────────────────────────────────────────────────────────
-- VERIFICATION — READY TO PASTE
-- Run the block below after the migration above to confirm
-- everything landed. Expected: 1 table row with rowsecurity,
-- 2 policies, 2 functions, 2 triggers.
-- ─────────────────────────────────────────────────────────────

-- 1) Table exists + RLS enabled
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename = 'notifications';

-- 2) RLS policies (expect 2)
select policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'notifications'
order by policyname;

-- 3) Trigger functions exist (expect 2)
select proname
from pg_proc
where proname in ('notify_comment_thread', 'notify_chat_mention');

-- 4) Triggers attached (expect 2)
select event_object_table, trigger_name
from information_schema.triggers
where trigger_name in ('trg_notify_comment_thread', 'trg_notify_chat_mention');
