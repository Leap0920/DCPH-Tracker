-- ============================================================
-- Detective Conan PH — Security Hardening Migration
-- Run this in the Supabase SQL Editor AFTER schema.sql.
-- Idempotent: safe to run multiple times.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- #1  Prevent privilege escalation on profiles UPDATE
--
-- The original "Users can update own profile" policy only checked
-- ownership, so a user could set their own role to 'admin'. We
-- replace it with a trigger that blocks any change to `role`
-- (and `user_id`) coming from a non-admin. Admins/service_role
-- can still change roles (e.g. to appoint moderators).
-- ─────────────────────────────────────────────────────────────

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

drop trigger if exists trg_prevent_profile_privilege_escalation on public.profiles;
create trigger trg_prevent_profile_privilege_escalation
  before update on public.profiles
  for each row execute function public.prevent_profile_privilege_escalation();

-- ─────────────────────────────────────────────────────────────
-- #2  Restrict the avatars storage bucket (MIME type + size)
--
-- The bucket is public for reads, but uploads were previously
-- unrestricted, allowing arbitrary files (e.g. SVG/HTML) → stored
-- XSS. Constrain allowed MIME types and a 3 MB size limit at the
-- bucket level, and enforce the content-type in the insert policy.
-- ─────────────────────────────────────────────────────────────

update storage.buckets
set
  file_size_limit = 3145728, -- 3 MB
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'avatars';

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (metadata->>'mimetype') in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  );

-- ─────────────────────────────────────────────────────────────
-- #12  Chat moderation & deletion policies
--
-- Previously chat_messages had no DELETE policy, so nothing could
-- be removed — not even by the author, and no moderator/admin
-- controls existed. Add:
--   * authors can delete their own messages
--   * moderators/admins can delete any message
-- ─────────────────────────────────────────────────────────────

create or replace function public.is_moderator_or_admin()
returns boolean as $$
  select coalesce(
    (select role in ('moderator', 'admin')
     from public.profiles
     where user_id = auth.uid()),
    false
  );
$$ language sql stable security definer set search_path = public;

drop policy if exists "Users can delete own messages" on public.chat_messages;
create policy "Users can delete own messages"
  on public.chat_messages for delete
  using (auth.uid() = user_id);

drop policy if exists "Moderators can delete any message" on public.chat_messages;
create policy "Moderators can delete any message"
  on public.chat_messages for delete
  using (public.is_moderator_or_admin());

-- ─────────────────────────────────────────────────────────────
-- #10 (support)  Fallback profile insert policy
--
-- Signups rely on the handle_new_user() trigger to create the
-- profile row. Add an explicit INSERT policy so an authenticated
-- user can self-heal a missing profile (id must match auth.uid()).
-- ─────────────────────────────────────────────────────────────

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);
