-- ============================================================================
-- Case Files: read view joining dcw_cases to its tracker entry.
--
-- WHY A VIEW: /cases must filter by content type and order by franchise watch
-- order, both of which live on content_entries. Neither is expressible through
-- a PostgREST embed — filtering an embedded column doesn't exclude parent rows,
-- and ordering parents by an embedded column isn't reachable from supabase-js.
-- Pre-joining makes both a plain top-level operation.
--
-- security_invoker = true so the querying user's RLS applies, not the view
-- owner's. Without it the view would bypass RLS on both tables.
--
-- Run manually in the Supabase Dashboard SQL Editor. Re-runnable.
-- ============================================================================

drop view if exists public.dcw_cases_view;

create view public.dcw_cases_view
with (security_invoker = true) as
select
  c.id,
  c.page_title,
  c.case_index,
  c.crime_type,
  c.crime_slug,
  c.cause_death,
  c.cause_slug,
  c.victim,
  c.victim_label,
  c.cause_death_label,
  c.suspects,
  c.suspects_label,
  c.location,
  c.description,
  c.date_text,
  c.image_name,
  c.entry_id,
  c.created_at,
  c.updated_at,
  e.slug            as entry_slug,
  e.title           as entry_title,
  e.type::text      as entry_type,
  e.episode_number  as entry_episode_number,
  e.release_order   as entry_release_order
from public.dcw_cases c
left join public.content_entries e on e.id = c.entry_id;

comment on view public.dcw_cases_view is
  'dcw_cases pre-joined to content_entries so /cases can filter by content type and order by release_order without a PostgREST embed. Columns are enumerated explicitly, not c.* — adding a column to dcw_cases requires re-running this file.';

-- Supporting indexes on the BASE table (a view has none of its own).
create index if not exists content_entries_release_order_idx
  on public.content_entries (release_order nulls last);

create index if not exists content_entries_type_idx
  on public.content_entries (type);

-- Verify:
--   select entry_type, count(*) from public.dcw_cases_view group by 1 order by 2 desc nulls last;
--   select count(*) from public.dcw_cases_view where entry_id is not null and entry_release_order is null;
