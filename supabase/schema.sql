-- ============================================================
-- Detective Conan PH — Database Schema (CONSOLIDATED)
-- ============================================================
-- Single source of truth for the entire database.
-- Merges the old schema.sql + migration-security.sql +
-- migration-admin.sql + migration-content-types.sql +
-- migration-demo-accounts.sql into ONE idempotent script.
--
-- HOW TO USE
--   1. (Optional, dev only) Run reset.sql first to wipe all data.
--   2. Run THIS file in the Supabase SQL Editor.
--   3. Then run seed.sql (base data) and/or seed-content.sql
--      (full catalog) as desired.
--
-- Idempotent: safe to run multiple times on an existing DB.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- EXTENSIONS
-- ─────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto with schema extensions;

-- ─────────────────────────────────────────────────────────────
-- PROFILES
-- ─────────────────────────────────────────────────────────────
create table if not exists profiles (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid unique references auth.users(id) on delete cascade not null,
  username   text unique not null,
  display_name text not null,
  avatar_url text,
  bio        text,
  role       text not null default 'member' check (role in ('member', 'moderator', 'admin')),
  birthday   date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- ARCS (Story Arcs)
-- ─────────────────────────────────────────────────────────────
create table if not exists arcs (
  id             uuid primary key default uuid_generate_v4(),
  slug           text unique not null,
  title          text not null,
  description    text,
  image_url      text,
  start_episode  integer not null,
  end_episode    integer not null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_arcs_slug on arcs(slug);

-- ─────────────────────────────────────────────────────────────
-- CONTENT ENTRIES (Episodes, Movies, Specials, OVAs)
-- Includes the widened type set and release_order column that
-- used to live in migration-content-types.sql.
-- ─────────────────────────────────────────────────────────────
create table if not exists content_entries (
  id               uuid primary key default uuid_generate_v4(),
  slug             text unique not null,
  title            text not null,
  type             text not null check (type in ('episode', 'movie', 'special', 'ova', 'live_action', 'magic_kaito', 'hanzawa', 'zero_tea_time')),
  episode_number   integer,
  movie_number     integer,
  air_date         date not null,
  canon_order      integer not null,
  release_order    integer,
  arc_id           uuid references arcs(id) on delete set null,
  synopsis         text,
  image_url        text,
  runtime_minutes  integer,
  created_at       timestamptz not null default now()
);

-- Heal pre-existing databases where content_entries predates the
-- release_order column. No-op on a fresh CREATE TABLE above.
alter table content_entries add column if not exists release_order integer;

create index if not exists idx_content_air_date on content_entries(air_date);
create index if not exists idx_content_canon_order on content_entries(canon_order);
create index if not exists idx_content_release_order on content_entries(release_order);
create index if not exists idx_content_type on content_entries(type);
create index if not exists idx_content_arc on content_entries(arc_id);

-- ─────────────────────────────────────────────────────────────
-- WATCH STATUS
-- ─────────────────────────────────────────────────────────────
create table if not exists watch_status (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  content_id uuid references content_entries(id) on delete cascade not null,
  status     text not null default 'unwatched' check (status in ('unwatched', 'watching', 'watched')),
  rating     integer check (rating >= 1 and rating <= 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, content_id)
);

create index if not exists idx_watch_status_user on watch_status(user_id);
create index if not exists idx_watch_status_content on watch_status(content_id);

-- ─────────────────────────────────────────────────────────────
-- CHAT ROOMS
-- ─────────────────────────────────────────────────────────────
create table if not exists chat_rooms (
  id          uuid primary key default uuid_generate_v4(),
  slug        text unique not null,
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Seed default rooms
insert into chat_rooms (slug, name, description) values
  ('general', 'General', 'The main gathering place for the organization'),
  ('episodes', 'Episode Discussion', 'Discuss the latest episodes'),
  ('movies', 'Movie Talk', 'Movie reactions and theories'),
  ('off-topic', 'Off-Topic', 'Anything goes (keep it civil)')
on conflict (slug) do nothing;

-- ─────────────────────────────────────────────────────────────
-- CHAT MESSAGES
-- ─────────────────────────────────────────────────────────────
create table if not exists chat_messages (
  id         uuid primary key default uuid_generate_v4(),
  room_id    uuid references chat_rooms(id) on delete cascade not null,
  user_id    uuid references auth.users(id) on delete cascade not null,
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_room on chat_messages(room_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- BADGES
-- ─────────────────────────────────────────────────────────────
create table if not exists badges (
  id          uuid primary key default uuid_generate_v4(),
  slug        text unique not null,
  name        text not null,
  description text,
  icon_url    text,
  category    text not null default 'achievement',
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- USER BADGES
-- ─────────────────────────────────────────────────────────────
create table if not exists user_badges (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  badge_id   uuid references badges(id) on delete cascade not null,
  earned_at  timestamptz not null default now(),
  unique(user_id, badge_id)
);

-- ─────────────────────────────────────────────────────────────
-- SCREENING EVENTS
-- ─────────────────────────────────────────────────────────────
create table if not exists screening_events (
  id           uuid primary key default uuid_generate_v4(),
  movie_number integer not null,
  movie_title  text not null,
  event_name   text not null,
  venue        text,
  city         text,
  date         date,
  ticket_url   text,
  is_featured  boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- SOCIAL LINKS
-- ─────────────────────────────────────────────────────────────
create table if not exists social_links (
  id         uuid primary key default uuid_generate_v4(),
  platform   text not null,
  handle     text not null,
  url        text not null,
  icon       text,
  is_active  boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Seed default social links
insert into social_links (platform, handle, url, icon, sort_order) values
  ('Facebook', '@DetectiveConanPH', 'https://facebook.com/DetectiveConanPH', 'facebook', 1),
  ('Instagram', '@detectiveconan.ph', 'https://instagram.com/detectiveconan.ph', 'instagram', 2),
  ('Discord', 'Join the Organization', 'https://discord.gg/your-invite', 'discord', 3),
  ('YouTube', '@DetectiveConanPH', 'https://youtube.com/@DetectiveConanPH', 'youtube', 4)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- FUNCTIONS
-- ─────────────────────────────────────────────────────────────

-- Auto-create profile on signup (trigger function, see triggers below)
drop function if exists public.handle_new_user();
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id, username, display_name, birthday)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'birthday', '')::date
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Refresh the leaderboard materialized view
create or replace function refresh_leaderboard()
returns void as $$
begin
  refresh materialized view concurrently leaderboard;
end;
$$ language plpgsql;

-- Prevent privilege escalation on profiles UPDATE:
-- blocks any change to `role` / `user_id` coming from a non-admin.
-- Admins and service_role can still change roles.
create or replace function public.prevent_profile_privilege_escalation()
returns trigger as $$
declare
  caller_role text;
begin
  -- service_role bypasses RLS and this check (used by trusted server code)
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Look up the calling user's current role.
  select role into caller_role
  from public.profiles
  where user_id = auth.uid();

  -- Non-admins may not change protected columns.
  if coalesce(caller_role, 'member') <> 'admin' then
    if new.role is distinct from old.role then
      raise exception 'Not allowed to change role';
    end if;
    if new.user_id is distinct from old.user_id then
      raise exception 'Not allowed to change user_id';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Admin check helper (used by content / storage / arcs policies)
create or replace function public.is_admin()
returns boolean as $$
  select coalesce(
    (select role = 'admin'
     from public.profiles
     where user_id = auth.uid()),
    false
  );
$$ language sql stable security definer set search_path = public;

-- Moderator/admin check helper (chat moderation)
create or replace function public.is_moderator_or_admin()
returns boolean as $$
  select coalesce(
    (select role in ('moderator', 'admin')
     from public.profiles
     where user_id = auth.uid()),
    false
  );
$$ language sql stable security definer set search_path = public;

-- ─────────────────────────────────────────────────────────────
-- TRIGGERS
-- ─────────────────────────────────────────────────────────────
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists trg_prevent_profile_privilege_escalation on public.profiles;
create trigger trg_prevent_profile_privilege_escalation
  before update on public.profiles
  for each row execute function public.prevent_profile_privilege_escalation();

-- ─────────────────────────────────────────────────────────────
-- LEADERBOARD (Materialized View)
-- ─────────────────────────────────────────────────────────────
drop materialized view if exists leaderboard;
create materialized view leaderboard as
select
  p.user_id,
  p.username,
  p.display_name,
  p.avatar_url,
  count(ws.id) filter (where ws.status = 'watched') as watched_count,
  coalesce(sum(ce.runtime_minutes) filter (where ws.status = 'watched'), 0) as total_minutes,
  rank() over (order by count(ws.id) filter (where ws.status = 'watched') desc) as rank
from profiles p
left join watch_status ws on ws.user_id = p.user_id
left join content_entries ce on ce.id = ws.content_id
group by p.user_id, p.username, p.display_name, p.avatar_url;

create unique index if not exists idx_leaderboard_user on leaderboard(user_id);

-- ─────────────────────────────────────────────────────────────
-- API ROLE GRANTS
-- Required after `drop schema public cascade` (reset.sql): the
-- project's default privileges are keyed to the old schema OID,
-- so a recreated schema leaves anon/authenticated with NO table
-- access (PostgREST fails "permission denied" before RLS runs).
-- RLS policies below still gate which rows each role can touch.
-- ─────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────
alter table profiles enable row level security;
alter table arcs enable row level security;
alter table content_entries enable row level security;
alter table watch_status enable row level security;
alter table chat_rooms enable row level security;
alter table chat_messages enable row level security;
alter table badges enable row level security;
alter table user_badges enable row level security;
alter table screening_events enable row level security;
alter table social_links enable row level security;

-- Profiles: public read, owner write, self-heal insert
drop policy if exists "Profiles are publicly readable" on profiles;
create policy "Profiles are publicly readable"
  on profiles for select using (true);

drop policy if exists "Users can update own profile" on profiles;
create policy "Users can update own profile"
  on profiles for update using (auth.uid() = user_id);

drop policy if exists "Users can insert own profile" on profiles;
create policy "Users can insert own profile"
  on profiles for insert
  with check (auth.uid() = user_id);

-- Arcs: public read, admin manage
drop policy if exists "Arcs are publicly readable" on arcs;
create policy "Arcs are publicly readable"
  on arcs for select using (true);

drop policy if exists "Admins can insert arcs" on arcs;
create policy "Admins can insert arcs"
  on arcs for insert with check (public.is_admin());

drop policy if exists "Admins can update arcs" on arcs;
create policy "Admins can update arcs"
  on arcs for update using (public.is_admin());

drop policy if exists "Admins can delete arcs" on arcs;
create policy "Admins can delete arcs"
  on arcs for delete using (public.is_admin());

-- Content entries: public read, admin insert/update/delete (used by /api/sync + admin dashboard)
drop policy if exists "Content entries are publicly readable" on content_entries;
create policy "Content entries are publicly readable"
  on content_entries for select using (true);

drop policy if exists "Admins can insert content entries" on content_entries;
create policy "Admins can insert content entries"
  on content_entries for insert
  with check (public.is_admin());

drop policy if exists "Admins can update content entries" on content_entries;
create policy "Admins can update content entries"
  on content_entries for update
  using (public.is_admin());

drop policy if exists "Admins can delete content entries" on content_entries;
create policy "Admins can delete content entries"
  on content_entries for delete
  using (public.is_admin());

-- Watch status: owner CRUD
drop policy if exists "Users can view own watch status" on watch_status;
create policy "Users can view own watch status"
  on watch_status for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own watch status" on watch_status;
create policy "Users can insert own watch status"
  on watch_status for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own watch status" on watch_status;
create policy "Users can update own watch status"
  on watch_status for update using (auth.uid() = user_id);

drop policy if exists "Users can delete own watch status" on watch_status;
create policy "Users can delete own watch status"
  on watch_status for delete using (auth.uid() = user_id);

-- Chat rooms: public read
drop policy if exists "Chat rooms are publicly readable" on chat_rooms;
create policy "Chat rooms are publicly readable"
  on chat_rooms for select using (true);

-- Chat messages: authenticated read, owner insert/delete, moderator/admin delete
drop policy if exists "Authenticated users can read chat messages" on chat_messages;
create policy "Authenticated users can read chat messages"
  on chat_messages for select using (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can insert own messages" on chat_messages;
create policy "Authenticated users can insert own messages"
  on chat_messages for insert with check (auth.uid() = user_id);

drop policy if exists "Users can delete own messages" on chat_messages;
create policy "Users can delete own messages"
  on chat_messages for delete
  using (auth.uid() = user_id);

drop policy if exists "Moderators can delete any message" on chat_messages;
create policy "Moderators can delete any message"
  on chat_messages for delete
  using (public.is_moderator_or_admin());

-- Badges: public read
drop policy if exists "Badges are publicly readable" on badges;
create policy "Badges are publicly readable"
  on badges for select using (true);

-- User badges: public read
drop policy if exists "User badges are publicly readable" on user_badges;
create policy "User badges are publicly readable"
  on user_badges for select using (true);

-- Screening events: public read
drop policy if exists "Screening events are publicly readable" on screening_events;
create policy "Screening events are publicly readable"
  on screening_events for select using (true);

-- Social links: public read
drop policy if exists "Social links are publicly readable" on social_links;
create policy "Social links are publicly readable"
  on social_links for select using (true);

-- ─────────────────────────────────────────────────────────────
-- STORAGE: AVATARS BUCKET
-- Public read; users upload/manage only inside avatars/<user_id>/.
-- Bucket-level MIME + 3 MB size limits (was migration-security.sql).
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  3145728, -- 3 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = true,
  file_size_limit = 3145728,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- Anyone can read avatar images (bucket is public)
drop policy if exists "Avatar images are publicly readable" on storage.objects;
create policy "Avatar images are publicly readable"
  on storage.objects for select
  using ( bucket_id = 'avatars' );

-- Authenticated users may upload only inside their own folder: avatars/<user_id>/*
-- Content-type is enforced to prevent stored XSS via SVG/HTML uploads.
drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (metadata->>'mimetype') in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  );

-- Users may update/delete only their own avatar objects
drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─────────────────────────────────────────────────────────────
-- STORAGE: CONTENT-IMAGES BUCKET
-- Public read; only admins may write. Used for episode/movie
-- cover photos uploaded from the admin dashboard (5 MB limit).
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'content-images',
  'content-images',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

drop policy if exists "Content images are publicly readable" on storage.objects;
create policy "Content images are publicly readable"
  on storage.objects for select
  using ( bucket_id = 'content-images' );

drop policy if exists "Admins can upload content images" on storage.objects;
create policy "Admins can upload content images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'content-images'
    and public.is_admin()
    and (metadata->>'mimetype') in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  );

drop policy if exists "Admins can update content images" on storage.objects;
create policy "Admins can update content images"
  on storage.objects for update to authenticated
  using ( bucket_id = 'content-images' and public.is_admin() );

drop policy if exists "Admins can delete content images" on storage.objects;
create policy "Admins can delete content images"
  on storage.objects for delete to authenticated
  using ( bucket_id = 'content-images' and public.is_admin() );

-- ─────────────────────────────────────────────────────────────
-- DEMO ACCOUNTS
-- Admin:    admin@dcph.ph   / DcphDemo2026!   (demo_admin,   role admin)
-- Member:   member@dcph.ph  / DcphDemo2026!   (demo_member,  role member)
--
-- Demo users are provisioned via scripts/provision-demo-users.mjs
-- (GoTrue admin API). Do NOT insert into auth.users / auth.identities
-- directly: raw SQL rows are incompatible with GoTrue and cause
-- HTTP 500 "Database error querying schema" at login.
--
-- The profile re-assertion below only guarantees the role column
-- is correct (DELETE bypasses the BEFORE UPDATE escalation trigger,
-- so no ALTER TABLE DISABLE TRIGGER is needed). It is safe to run
-- on fresh and existing databases alike.
-- ─────────────────────────────────────────────────────────────

-- Re-assert demo profiles with the correct roles (works even if
-- the handle_new_user trigger already created 'member' rows).
delete from public.profiles
where user_id in (
  select id from auth.users where email in ('admin@dcph.ph', 'member@dcph.ph')
);

insert into public.profiles (user_id, username, display_name, role)
values
  ('11111111-1111-4111-8111-111111111111', 'demo_admin', 'Demo Admin', 'admin'),
  ('22222222-2222-4222-8222-222222222222', 'demo_member', 'Demo Member', 'member');

-- ─────────────────────────────────────────────────────────────
-- VERIFICATION
-- Expected: 2 rows — admin@dcph.ph (demo_admin/admin),
--           member@dcph.ph (demo_member/member).
-- ─────────────────────────────────────────────────────────────
select u.email, p.username, p.role
from auth.users u
left join public.profiles p on p.user_id = u.id
where u.email in ('admin@dcph.ph', 'member@dcph.ph')
order by u.email;
