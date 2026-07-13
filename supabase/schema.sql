-- ============================================================
-- Detective Conan PH — Database Schema
-- Run this in Supabase SQL Editor to bootstrap the schema
-- ============================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────────────────────
-- PROFILES
-- ─────────────────────────────────────────────────────────────
create table profiles (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid unique references auth.users(id) on delete cascade not null,
  username   text unique not null,
  display_name text not null,
  avatar_url text,
  bio        text,
  role       text not null default 'member' check (role in ('member', 'moderator', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create profile on signup
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id, username, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- ARCS (Story Arcs)
-- ─────────────────────────────────────────────────────────────
create table arcs (
  id             uuid primary key default uuid_generate_v4(),
  slug           text unique not null,
  title          text not null,
  description    text,
  image_url      text,
  start_episode  integer not null,
  end_episode    integer not null,
  created_at     timestamptz not null default now()
);

create index idx_arcs_slug on arcs(slug);

-- ─────────────────────────────────────────────────────────────
-- CONTENT ENTRIES (Episodes, Movies, Specials, OVAs)
-- ─────────────────────────────────────────────────────────────
create table content_entries (
  id               uuid primary key default uuid_generate_v4(),
  slug             text unique not null,
  title            text not null,
  type             text not null check (type in ('episode', 'movie', 'special', 'ova')),
  episode_number   integer,
  movie_number     integer,
  air_date         date not null,
  canon_order      integer not null,
  arc_id           uuid references arcs(id) on delete set null,
  synopsis         text,
  image_url        text,
  runtime_minutes  integer,
  created_at       timestamptz not null default now()
);

create index idx_content_air_date on content_entries(air_date);
create index idx_content_canon_order on content_entries(canon_order);
create index idx_content_type on content_entries(type);
create index idx_content_arc on content_entries(arc_id);

-- ─────────────────────────────────────────────────────────────
-- WATCH STATUS
-- ─────────────────────────────────────────────────────────────
create table watch_status (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  content_id uuid references content_entries(id) on delete cascade not null,
  status     text not null default 'unwatched' check (status in ('unwatched', 'watching', 'watched')),
  rating     integer check (rating >= 1 and rating <= 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, content_id)
);

create index idx_watch_status_user on watch_status(user_id);
create index idx_watch_status_content on watch_status(content_id);

-- ─────────────────────────────────────────────────────────────
-- CHAT ROOMS
-- ─────────────────────────────────────────────────────────────
create table chat_rooms (
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
  ('off-topic', 'Off-Topic', 'Anything goes (keep it civil)');

-- ─────────────────────────────────────────────────────────────
-- CHAT MESSAGES
-- ─────────────────────────────────────────────────────────────
create table chat_messages (
  id         uuid primary key default uuid_generate_v4(),
  room_id    uuid references chat_rooms(id) on delete cascade not null,
  user_id    uuid references auth.users(id) on delete cascade not null,
  content    text not null,
  created_at timestamptz not null default now()
);

create index idx_chat_messages_room on chat_messages(room_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- BADGES
-- ─────────────────────────────────────────────────────────────
create table badges (
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
create table user_badges (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  badge_id   uuid references badges(id) on delete cascade not null,
  earned_at  timestamptz not null default now(),
  unique(user_id, badge_id)
);

-- ─────────────────────────────────────────────────────────────
-- SCREENING EVENTS
-- ─────────────────────────────────────────────────────────────
create table screening_events (
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
create table social_links (
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
  ('YouTube', '@DetectiveConanPH', 'https://youtube.com/@DetectiveConanPH', 'youtube', 4);

-- ─────────────────────────────────────────────────────────────
-- LEADERBOARD (Materialized View)
-- ─────────────────────────────────────────────────────────────
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

create unique index idx_leaderboard_user on leaderboard(user_id);

-- Function to refresh the leaderboard
create or replace function refresh_leaderboard()
returns void as $$
begin
  refresh materialized view concurrently leaderboard;
end;
$$ language plpgsql;

-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────

-- Enable RLS on all tables
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

-- Profiles: public read, owner write
create policy "Profiles are publicly readable"
  on profiles for select using (true);
create policy "Users can update own profile"
  on profiles for update using (auth.uid() = user_id);

-- Arcs: public read only
create policy "Arcs are publicly readable"
  on arcs for select using (true);

-- Content entries: public read only
create policy "Content entries are publicly readable"
  on content_entries for select using (true);

-- Watch status: owner CRUD
create policy "Users can view own watch status"
  on watch_status for select using (auth.uid() = user_id);
create policy "Users can insert own watch status"
  on watch_status for insert with check (auth.uid() = user_id);
create policy "Users can update own watch status"
  on watch_status for update using (auth.uid() = user_id);
create policy "Users can delete own watch status"
  on watch_status for delete using (auth.uid() = user_id);

-- Chat rooms: public read
create policy "Chat rooms are publicly readable"
  on chat_rooms for select using (true);

-- Chat messages: authenticated read, authenticated insert
create policy "Authenticated users can read chat messages"
  on chat_messages for select using (auth.role() = 'authenticated');
create policy "Authenticated users can insert own messages"
  on chat_messages for insert with check (auth.uid() = user_id);

-- Badges: public read
create policy "Badges are publicly readable"
  on badges for select using (true);

-- User badges: public read
create policy "User badges are publicly readable"
  on user_badges for select using (true);

-- Screening events: public read
create policy "Screening events are publicly readable"
  on screening_events for select using (true);

-- Social links: public read
create policy "Social links are publicly readable"
  on social_links for select using (true);
