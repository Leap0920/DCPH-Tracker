-- ─────────────────────────────────────────────────────────────
-- SYNC STAGING TABLE (Admin Approval Queue)
-- Stores synced items fetched from APIs (Jikan / Kitsu / AniList).
-- Items remain in `sync_staging` with status = 'pending' until an Admin
-- approves (publishes to `content_entries`) or rejects them.
-- ─────────────────────────────────────────────────────────────

create table if not exists sync_staging (
  id              uuid primary key default uuid_generate_v4(),
  source          text not null, -- 'jikan', 'kitsu', 'anilist'
  slug            text not null,
  title           text not null,
  type            text not null check (type in ('episode', 'movie', 'special', 'ova', 'live_action', 'magic_kaito', 'hanzawa', 'zero_tea_time', 'yaiba')),
  episode_number  integer,
  movie_number    integer,
  air_date        date,
  canon_order     integer,
  synopsis        text,
  image_url       text,
  runtime_minutes integer,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_notes    text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_sync_staging_status on sync_staging(status);
create index if not exists idx_sync_staging_slug on sync_staging(slug);

alter table sync_staging enable row level security;

-- Admin read/write policy for sync_staging
drop policy if exists "Admins can manage sync_staging" on sync_staging;
create policy "Admins can manage sync_staging"
  on sync_staging for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
