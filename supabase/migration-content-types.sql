-- Migration: widen content_entries.type + add release_order column.
-- Run this in the Supabase SQL Editor against an EXISTING database
-- (already bootstrapped from the old schema.sql). Safe to re-run.

-- 1) Widen the type CHECK constraint (drop the old one, add the new set).
do $$
declare
  conname text;
begin
  select conname into conname
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
  where c.conrelid = 'public.content_entries'::regclass
    and a.attname = 'type'
    and c.contype = 'c';
  if conname is not null then
    execute format('alter table public.content_entries drop constraint %I', conname);
  end if;
end $$;

alter table public.content_entries
  add constraint content_entries_type_check
  check (type in ('episode', 'movie', 'special', 'ova', 'live_action', 'magic_kaito', 'hanzawa', 'zero_tea_time'));

-- 2) Add release_order column (global chronological sequence) if missing.
alter table public.content_entries
  add column if not exists release_order integer;

create index if not exists idx_content_release_order
  on public.content_entries(release_order);
