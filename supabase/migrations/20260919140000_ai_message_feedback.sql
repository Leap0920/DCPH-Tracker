-- supabase/migrations/20260919140000_ai_message_feedback.sql
--
-- Per-message answer feedback: one row per (message, user), written only by the
-- service role. A vote is (message, user, value, when, optional note) -- a
-- many-per-message fact with its own ownership rule, so it is its own table
-- rather than the `feedback` / `feedback_note` columns already on
-- public.ai_messages (D3). Those columns are one value a later `update` can
-- overwrite and have no writer in this codebase; they are left in place,
-- unread and unwritten, and this migration is additive only.
--
-- The table holds personal content, so it is reachable only with the
-- service-role key: RLS is enabled with NO policies, mirroring
-- public.rate_limits and the AI tables in 20260919090000 and 20260919110000.
-- A policy would imply that a browser session could read or write these rows,
-- and it cannot.

create table if not exists public.ai_message_feedback (
  id         uuid        primary key default gen_random_uuid(),
  message_id uuid        not null references public.ai_messages (id) on delete cascade,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  -- The vote, restricted to the two states the UI offers. A smallint rather
  -- than a boolean so a later third state does not need a type change.
  value      smallint    not null check (value in (-1, 1)),
  note       text,
  created_at timestamptz not null default now()
);

-- Phase 6's reporting reads the votes for a set of messages by id.
create index if not exists ai_message_feedback_message_idx
  on public.ai_message_feedback (message_id);

-- One vote per user per message: a second vote replaces the first rather than
-- stacking, so the table is bounded by the transcript it annotates.
create unique index if not exists ai_message_feedback_message_user_idx
  on public.ai_message_feedback (message_id, user_id);

alter table public.ai_message_feedback enable row level security;
revoke all on table public.ai_message_feedback from anon, authenticated;
