-- Chat realtime: diagnosis, then the definitive fix.
-- Run top-to-bottom in the Supabase Dashboard SQL Editor. Idempotent.
-- Supersedes supabase/migration-chat-unsend-realtime.sql.

-- ═══ STEP 1 — DIAGNOSE (read-only). Note every result. ════════════════

-- 1a. Does the publication exist, and what does it publish?
--     Expect pubinsert AND pubdelete = true. Zero rows = realtime was never
--     set up on this project at all.
select pubname, pubinsert, pubupdate, pubdelete, pubtruncate
  from pg_publication
 where pubname = 'supabase_realtime';

-- 1b. Is chat_messages IN it? An empty/absent chat_messages row here is the
--     single most likely cause of "no events ever arrive".
select schemaname, tablename
  from pg_publication_tables
 where pubname = 'supabase_realtime'
   and schemaname = 'public'
 order by tablename;

-- 1c. Replica identity. 'd' (default) is fine: DELETE payloads then carry only
--     the primary key, which is why ChatWindow subscribes to DELETE unfiltered.
select relreplident, relrowsecurity
  from pg_class
 where oid = 'public.chat_messages'::regclass;

-- 1d. RLS. Realtime re-evaluates the SELECT policies using the SOCKET's JWT.
--     A socket still holding the anon key is role `anon`, fails
--     "Authenticated users can read chat messages", and receives NOTHING —
--     which looks identical to a broken subscription. (ChatWindow now calls
--     realtime.setAuth() with the live access token before subscribing.)
select policyname, cmd, permissive, roles, qual
  from pg_policies
 where schemaname = 'public' and tablename = 'chat_messages'
 order by cmd, policyname;

-- ═══ STEP 2 — FIX: publication membership (idempotent) ════════════════
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception
      'Publication supabase_realtime does not exist. Enable Realtime for this project in Dashboard → Database → Replication, then re-run this file.';
  end if;

  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
    raise notice 'chat_messages ADDED to supabase_realtime — this was the bug.';
  else
    raise notice 'chat_messages was already published; look elsewhere (see 1a/1d).';
  end if;
end $$;

-- ═══ STEP 3 — conditional: publish flags ══════════════════════════════
-- ONLY if 1a showed pubinsert or pubdelete = false. This affects every table in
-- the publication, so run it deliberately, not reflexively:
-- alter publication supabase_realtime set (publish = 'insert, update, delete');

-- ═══ STEP 4 — optional: REPLICA IDENTITY FULL ═════════════════════════
-- Not needed today. Only if you later want room-filtered DELETE/UPDATE events.
-- It writes the whole old row to WAL on every UPDATE/DELETE.
-- alter table public.chat_messages replica identity full;

-- ═══ STEP 5 — RE-VERIFY ═══════════════════════════════════════════════
select tablename
  from pg_publication_tables
 where pubname = 'supabase_realtime' and schemaname = 'public'
 order by tablename;

select pubinsert, pubupdate, pubdelete
  from pg_publication
 where pubname = 'supabase_realtime';
