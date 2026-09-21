-- supabase/migrations/20260919090000_ai_gateway_infra.sql
--
-- Infrastructure for the AI chat model gateway. Two internal tables:
--   ai_provider_state - cross-instance circuit breaker state per target
--   ai_request_log    - one row per chat request, for latency/quality debugging
--
-- Both are operationally sensitive and reachable only with the service-role
-- key: RLS is enabled with NO policies, mirroring public.rate_limits.

create table if not exists public.ai_provider_state (
  target               text        primary key,
  consecutive_failures integer     not null default 0,
  open_until           timestamptz,
  last_failure_kind    text,
  last_status          integer,
  last_error           text,
  last_used_at         timestamptz,
  success_count        bigint      not null default 0,
  failure_count        bigint      not null default 0,
  updated_at           timestamptz not null default now()
);

-- The gateway's hot query is "which targets are currently open?".
create index if not exists ai_provider_state_open_until_idx
  on public.ai_provider_state (open_until)
  where open_until is not null;

alter table public.ai_provider_state enable row level security;
revoke all on table public.ai_provider_state from anon, authenticated;

create table if not exists public.ai_request_log (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        references auth.users (id) on delete set null,
  conversation_id   uuid,
  target_id         text,
  outcome           text        not null,
  -- Latency breakdown, in ms, so a slow stage is identifiable without a trace tool.
  plan_ms           integer,
  retrieve_ms       integer,
  ttft_ms           integer,
  total_ms          integer,
  attempts          jsonb       not null default '[]'::jsonb,
  doc_count         integer,
  cache_hit         boolean     not null default false,
  degraded_reason   text,
  prompt_tokens     integer,
  completion_tokens integer,
  created_at        timestamptz not null default now()
);

create index if not exists ai_request_log_created_at_idx
  on public.ai_request_log (created_at desc);

create index if not exists ai_request_log_user_idx
  on public.ai_request_log (user_id, created_at desc);

alter table public.ai_request_log enable row level security;
revoke all on table public.ai_request_log from anon, authenticated;
