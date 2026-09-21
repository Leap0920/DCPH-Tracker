-- supabase/migrations/20260919110000_ai_memory.sql
--
-- DCPH Bot's memory. Three additive tables:
--   ai_conversations  - one row per conversation; owns the L1 window and its summary
--   ai_messages       - the transcript, FTS-indexed so a past turn can be found again
--   ai_user_memories  - long-term facts about a user, one row per active slot
--
-- All three hold personal content, so all three are reachable only with the
-- service-role key: RLS is enabled with NO policies, mirroring public.rate_limits,
-- ai_provider_state and ai_request_log. Ownership is enforced by the stores, which
-- carry the user id into every message query (D1); a policy would imply that a
-- browser session could read these tables, and it cannot.

create table if not exists public.ai_conversations (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            uuid        not null references auth.users (id) on delete cascade,
  title              text,
  summary            text,
  -- The rolling summary covers turns below this index, so the L1 window can move
  -- forward without re-summarising what it still shows verbatim.
  summarized_through integer     not null default 0,
  message_count      integer     not null default 0,
  -- Activity, not creation: the route attaches to the user's most recent
  -- conversation inside a 30-minute window, which is a write-time fact.
  last_message_at    timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  archived_at        timestamptz
);

-- The attach query: this user's newest conversation by activity.
create index if not exists ai_conversations_user_last_message_idx
  on public.ai_conversations (user_id, last_message_at desc);

alter table public.ai_conversations enable row level security;
revoke all on table public.ai_conversations from anon, authenticated;

create table if not exists public.ai_messages (
  id                uuid        primary key default gen_random_uuid(),
  conversation_id   uuid        not null references public.ai_conversations (id) on delete cascade,
  role              text        not null check (role in ('user','assistant','system')),
  content           text        not null,
  metadata          jsonb       not null default '{}'::jsonb,
  model             text,
  prompt_tokens     integer,
  completion_tokens integer,
  feedback          text check (feedback in ('up','down')),
  feedback_note     text,
  created_at        timestamptz not null default now(),
  -- to_tsvector must be given an explicit regconfig: the one-argument form is
  -- STABLE, not IMMUTABLE, and a generated column rejects it.
  fts tsvector generated always as (to_tsvector('english'::regconfig, coalesce(content, ''))) stored
);

-- The verbatim window reads the newest rows of one conversation; the transcript
-- view reads all of them in order.
create index if not exists ai_messages_conversation_created_idx
  on public.ai_messages (conversation_id, created_at);

-- Episodic search (D5): a past turn is looked up by its words, per user.
create index if not exists ai_messages_fts_idx
  on public.ai_messages using gin (fts);

alter table public.ai_messages enable row level security;
revoke all on table public.ai_messages from anon, authenticated;

create table if not exists public.ai_user_memories (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users (id) on delete cascade,
  kind              text        not null check (kind in ('preference','progress','identity','interest','constraint')),
  key               text        not null,
  value             text        not null,
  confidence        real        not null default 0.7 check (confidence >= 0 and confidence <= 1),
  status            text        not null default 'active' check (status in ('active','superseded','expired')),
  -- set null, not cascade: a superseded fact is provenance and must survive the
  -- row it points at, and a deleted source message must not take the fact with it.
  superseded_by     uuid        references public.ai_user_memories (id) on delete set null,
  source_message_id uuid        references public.ai_messages (id) on delete set null,
  evidence_count    integer     not null default 1,
  last_confirmed_at timestamptz not null default now(),
  -- Set only for progress slots (90 days), so a stale watch position does not
  -- outlive the show it was about.
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One active row per slot. Partial on purpose: superseding keeps the old row for
-- provenance, so the slot's history is unbounded while the active set is a single
-- row -- and two concurrent writers cannot both insert the same active slot.
create unique index if not exists ai_user_memories_active_slot_idx
  on public.ai_user_memories (user_id, kind, key)
  where status = 'active';

-- The prompt read: this user's active facts, newest-confirmed first.
create index if not exists ai_user_memories_user_status_idx
  on public.ai_user_memories (user_id, status, last_confirmed_at desc);

alter table public.ai_user_memories enable row level security;
revoke all on table public.ai_user_memories from anon, authenticated;
