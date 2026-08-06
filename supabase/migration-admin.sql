-- ============================================================
-- Detective Conan PH — Admin Dashboard Migration
-- Run in the Supabase SQL Editor AFTER schema.sql and
-- migration-security.sql. Idempotent: safe to re-run.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- Helper: is_admin()  — used by content policies below.
-- ─────────────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean as $$
  select coalesce(
    (select role = 'admin'
     from public.profiles
     where user_id = auth.uid()),
    false
  );
$$ language sql stable security definer set search_path = public;

-- ─────────────────────────────────────────────────────────────
-- Content entries: admins can DELETE (insert/update already exist).
-- ─────────────────────────────────────────────────────────────
drop policy if exists "Admins can delete content entries" on public.content_entries;
create policy "Admins can delete content entries"
  on public.content_entries for delete
  using (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- Arcs: admins can manage (insert/update/delete). Public read
-- already exists from schema.sql.
-- ─────────────────────────────────────────────────────────────
drop policy if exists "Admins can insert arcs" on public.arcs;
create policy "Admins can insert arcs"
  on public.arcs for insert with check (public.is_admin());

drop policy if exists "Admins can update arcs" on public.arcs;
create policy "Admins can update arcs"
  on public.arcs for update using (public.is_admin());

drop policy if exists "Admins can delete arcs" on public.arcs;
create policy "Admins can delete arcs"
  on public.arcs for delete using (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- STORAGE: content-images bucket
-- Public read; only admins may write. Used for episode/movie
-- cover photos uploaded from the admin dashboard.
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
