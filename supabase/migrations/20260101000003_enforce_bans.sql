-- supabase/migration-enforce-bans.sql
-- Enforce account status (banned / suspended) at the RLS layer.
-- Idempotent: safe to re-run.
--
-- Design notes:
--   * Uses RESTRICTIVE policies, which are AND-ed with existing permissive
--     policies. Existing policies are therefore left untouched.
--   * service_role bypasses RLS entirely, so the cron/admin client in
--     app/api/sync/route.ts is unaffected.
--   * Helpers are SECURITY DEFINER so they can read profiles without
--     re-entering profiles' own RLS (no recursion).

begin;

-- ---------------------------------------------------------------------------
-- 1. Status helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_banned()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.status::text = 'banned'
  );
$$;

create or replace function public.is_active()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select not exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.status::text in ('banned', 'suspended')
  );
$$;

comment on function public.is_banned() is
  'True when the calling user''s profile status is ''banned''. False for anon.';
comment on function public.is_active() is
  'True unless the calling user''s profile status is ''banned'' or ''suspended''. True for anon.';

-- Own the functions with a role that bypasses RLS on profiles.
-- (Drop these two lines if you are not running as a superuser/owner.)
alter function public.is_banned() owner to postgres;
alter function public.is_active() owner to postgres;

revoke all on function public.is_banned() from public;
revoke all on function public.is_active() from public;
grant execute on function public.is_banned()  to authenticated, service_role;
grant execute on function public.is_active()  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. profiles — block self-service writes by inactive users.
--    Admins are exempted so a mis-set status can never lock the console out.
-- ---------------------------------------------------------------------------

drop policy if exists "Inactive users cannot update profiles" on public.profiles;
create policy "Inactive users cannot update profiles"
  on public.profiles
  as restrictive
  for update
  to authenticated
  using      ((select public.is_active()) or (select public.is_admin()))
  with check ((select public.is_active()) or (select public.is_admin()));

-- Optional and NOT enabled: also hide the profile from banned users.
-- Only enable this if your middleware reads profiles.status with the ADMIN
-- client. Under the user's own token this would make a ban undetectable.
--
-- drop policy if exists "Banned users cannot read profiles" on public.profiles;
-- create policy "Banned users cannot read profiles"
--   on public.profiles
--   as restrictive
--   for select
--   to authenticated
--   using (not (select public.is_banned()) or (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 3. watch_status — writes only. SELECT is left public by design.
-- ---------------------------------------------------------------------------

drop policy if exists "Inactive users cannot insert watch status" on public.watch_status;
create policy "Inactive users cannot insert watch status"
  on public.watch_status
  as restrictive
  for insert
  to authenticated
  with check ((select public.is_active()));

drop policy if exists "Inactive users cannot update watch status" on public.watch_status;
create policy "Inactive users cannot update watch status"
  on public.watch_status
  as restrictive
  for update
  to authenticated
  using      ((select public.is_active()))
  with check ((select public.is_active()));

drop policy if exists "Inactive users cannot delete watch status" on public.watch_status;
create policy "Inactive users cannot delete watch status"
  on public.watch_status
  as restrictive
  for delete
  to authenticated
  using ((select public.is_active()));

-- ---------------------------------------------------------------------------
-- 4. chat_messages — no posting, editing or deleting while inactive.
--    SELECT stays open so a banned user still sees the room read-only.
-- ---------------------------------------------------------------------------

drop policy if exists "Inactive users cannot post chat messages" on public.chat_messages;
create policy "Inactive users cannot post chat messages"
  on public.chat_messages
  as restrictive
  for insert
  to authenticated
  with check ((select public.is_active()));

drop policy if exists "Inactive users cannot edit chat messages" on public.chat_messages;
create policy "Inactive users cannot edit chat messages"
  on public.chat_messages
  as restrictive
  for update
  to authenticated
  using      ((select public.is_active()) or (select public.is_moderator_or_admin()))
  with check ((select public.is_active()) or (select public.is_moderator_or_admin()));

drop policy if exists "Inactive users cannot delete chat messages" on public.chat_messages;
create policy "Inactive users cannot delete chat messages"
  on public.chat_messages
  as restrictive
  for delete
  to authenticated
  using ((select public.is_active()) or (select public.is_moderator_or_admin()));

-- ---------------------------------------------------------------------------
-- 5. content_entries: unchanged. "publicly readable using (true)" is correct
--    for a public catalog; writes remain admin-only.
-- ---------------------------------------------------------------------------

commit;

-- ---------------------------------------------------------------------------
-- Verification (run separately)
-- ---------------------------------------------------------------------------
-- select tablename, policyname, permissive, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('profiles', 'watch_status', 'chat_messages')
-- order by tablename, permissive, policyname;
