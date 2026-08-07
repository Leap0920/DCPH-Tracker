-- ============================================================
-- Detective Conan PH — Database RESET (DESTRUCTIVE)
-- ============================================================
-- WARNING: This DELETES ALL DATA — every table, row, account,
-- upload, and policy in the project. There is NO undo.
--
-- Use it to wipe the database back to a blank state, then run
-- schema.sql (and optionally seed.sql / seed-content.sql).
--
-- HOW TO USE
--   1. Supabase Dashboard → SQL Editor
--   2. Paste THIS file → Run
--   3. Then paste schema.sql → Run
--   4. (Optional) seed.sql for base data, seed-content.sql for
--      the full catalog
--
-- Runs as postgres, so it can touch auth.* and storage.* too.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1) DROP AND RECREATE THE PUBLIC SCHEMA
-- Removes all tables, views, functions, triggers, RLS policies.
-- ─────────────────────────────────────────────────────────────
drop schema public cascade;
create schema public;

grant all on schema public to postgres;
grant all on schema public to anon;
grant all on schema public to authenticated;
grant all on schema public to service_role;

-- ─────────────────────────────────────────────────────────────
-- 2) WIPE ALL ACCOUNTS
-- Removes every auth user and identity (demo + real). The
-- schema.sql demo-account section will recreate the demo ones.
-- ─────────────────────────────────────────────────────────────
delete from auth.identities;
delete from auth.users;

-- ─────────────────────────────────────────────────────────────
-- 3) STORAGE — intentionally NOT wiped from SQL
--
-- Supabase blocks direct DELETEs on storage.* tables
-- (storage.protect_delete → "Direct deletion from storage tables
-- is not allowed") to prevent orphaned S3 files. Bypassing that
-- guard would only remove the metadata row — the actual file
-- would stay in S3 and keep counting against your storage quota.
--
-- So uploaded files survive a reset. To remove them too:
--   Dashboard → Storage → open bucket → select files → Delete
--   (or use the Storage API / S3-compatible endpoint).
--
-- The buckets themselves are re-created/updated by schema.sql
-- (INSERT ... ON CONFLICT DO UPDATE), so nothing else is needed.
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────
-- DONE. Now run schema.sql in the same SQL Editor session.
-- (Extensions are re-created by schema.sql with
--  `create extension if not exists`, so nothing else is needed.)
-- ─────────────────────────────────────────────────────────────
