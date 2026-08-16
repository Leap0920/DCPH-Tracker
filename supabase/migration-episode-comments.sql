-- ─────────────────────────────────────────────────────────────
-- EPISODE COMMENTS (Episode Page Redesign)
-- Stores per-episode/movie comments for the community episode
-- page, plus a security-definer RPC that aggregates public
-- ratings from watch_status.
--
-- Standalone idempotent migration — paste into the Supabase
-- Dashboard SQL Editor AFTER schema.sql. Safe to re-run.
--
-- NOTE: the uuid-ossp extension is already created by
-- schema.sql:21, so it is intentionally NOT created here.
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────
-- EPISODE COMMENTS TABLE
-- ─────────────────────────────────────────────────────────────
create table if not exists public.episode_comments (
  id         uuid primary key default uuid_generate_v4(),
  content_id uuid not null references public.content_entries(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  body       text not null check (length(body) <= 2000 and length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_episode_comments_content_id
  on public.episode_comments (content_id, created_at desc);
create index if not exists idx_episode_comments_user_id
  on public.episode_comments (user_id);

-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────
alter table public.episode_comments enable row level security;

-- Authenticated users can read all comments (episode pages are public to members)
drop policy if exists "Authenticated users can read episode comments" on public.episode_comments;
create policy "Authenticated users can read episode comments"
  on public.episode_comments for select
  to authenticated
  using (true);

-- Owner can insert their own comments
drop policy if exists "Users can insert own episode comments" on public.episode_comments;
create policy "Users can insert own episode comments"
  on public.episode_comments for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Owner can update their own comments
drop policy if exists "Users can update own episode comments" on public.episode_comments;
create policy "Users can update own episode comments"
  on public.episode_comments for update
  to authenticated
  using (auth.uid() = user_id);

-- Owner can delete their own comments
drop policy if exists "Users can delete own episode comments" on public.episode_comments;
create policy "Users can delete own episode comments"
  on public.episode_comments for delete
  to authenticated
  using (auth.uid() = user_id);

-- Moderators/admins can delete any comment (moderation)
drop policy if exists "Moderators can delete any episode comment" on public.episode_comments;
create policy "Moderators can delete any episode comment"
  on public.episode_comments for delete
  to authenticated
  using (public.is_moderator_or_admin());

-- ─────────────────────────────────────────────────────────────
-- RATING RPC
-- Security definer: computes the community-average rating for a
-- content entry across ALL users' watch_status rows (the caller
-- may have no row of their own, and RLS would otherwise filter
-- other users' ratings out).
-- NOTE: no execute grant to service_role — it bypasses RLS anyway.
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_content_rating(p_content_id uuid)
returns table (avg_rating numeric, rating_count bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  return query
    select avg(w.rating)::numeric, count(*)::bigint
    from public.watch_status w
    where w.content_id = p_content_id
      and w.rating is not null;
end;
$$;

revoke all on function public.get_content_rating(uuid) from public;
grant execute on function public.get_content_rating(uuid) to authenticated, anon;

-- ─────────────────────────────────────────────────────────────
-- VERIFICATION — READY TO PASTE
-- Run the block below after the migration above to confirm
-- everything landed. Expected: 1 table row with rowsecurity,
-- 5 policies, 1 function, and a rating row (or an empty set if
-- the content has no ratings yet).
-- ─────────────────────────────────────────────────────────────

-- 1) Table exists + RLS enabled
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename = 'episode_comments';

-- 2) RLS policies (expect 5)
select policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'episode_comments'
order by policyname;

-- 3) Rating RPC exists (expect 1)
select proname
from pg_proc
where proname = 'get_content_rating';

-- 4) RPC works — substitute a real content entry id.
--    (Grab one with: select id from public.content_entries limit 1;)
select * from public.get_content_rating('<some-real-content-uuid>');
