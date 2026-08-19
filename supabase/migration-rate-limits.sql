-- supabase/migration-rate-limits.sql

create table if not exists public.rate_limits (
  key          text primary key,
  count        integer     not null default 0,
  window_start timestamptz not null default now()
);

create index if not exists rate_limits_window_start_idx
  on public.rate_limits (window_start);

-- RLS on with NO policies: unreachable by anon/authenticated. Only the
-- security-definer function below (and service_role) can touch it.
alter table public.rate_limits enable row level security;

revoke all on table public.rate_limits from anon, authenticated;

/**
 * Atomically records a hit and reports whether it is allowed.
 * Cross-instance correct via INSERT ... ON CONFLICT (single statement,
 * row-level locked) — unlike per-lambda in-memory counters.
 */
create or replace function public.rate_limit_hit(
  p_key            text,
  p_limit          integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now    timestamptz := now();
  v_window interval    := make_interval(secs => p_window_seconds);
  v_row    public.rate_limits;
begin
  if p_limit is null or p_limit < 1 or p_window_seconds is null
     or p_window_seconds < 1 or p_key is null or length(p_key) > 512 then
    raise exception 'invalid rate limit parameters';
  end if;

  insert into public.rate_limits as rl (key, count, window_start)
  values (p_key, 1, v_now)
  on conflict (key) do update
    set count = case
          when rl.window_start < v_now - v_window then 1
          else rl.count + 1
        end,
        window_start = case
          when rl.window_start < v_now - v_window then v_now
          else rl.window_start
        end
  returning * into v_row;

  -- Opportunistic GC so the table cannot grow unbounded.
  if random() < 0.01 then
    delete from public.rate_limits
    where window_start < v_now - interval '1 day';
  end if;

  if v_row.count > p_limit then
    return query select
      false,
      greatest(
        1,
        ceil(extract(epoch from (v_row.window_start + v_window) - v_now))::int
      );
  end if;

  return query select true, 0;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer)
  to service_role;