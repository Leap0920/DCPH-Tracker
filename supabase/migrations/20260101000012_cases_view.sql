-- supabase/migration-case-files-all-episodes.sql

-- ============================================================================
-- Case Files: every content entry with crime data where available.
--
-- /cases reads this view (CASES_VIEW) and nothing else, so without it the page
-- has no rows to render. It lived only in a hand-run file, which is why a
-- database built from the migration chain alone had no such view.
--
-- Two deviations from that hand-run file, both deliberate:
--
--   1. `culprits` and `culprit_count` are not selected. No migration defines
--      those columns and no code reads them, so selecting them made the view
--      impossible to create on a fresh database.
--   2. `id` falls back to the entry's own id rather than gen_random_uuid().
--      The facet pager orders by `id` and pages through it in windows, which
--      only works if the value is stable and unique across requests. A random
--      uuid per row per query reshuffles the order between windows, so a case
--      could be counted twice and another dropped. `coalesce(c.id, e.id)` is
--      unique (the two id spaces are disjoint) and stable, and for a row that
--      has crime data it is still the case id.
--
-- security_invoker = true so the querying user's RLS applies, not the view
-- owner's. Without it the view would bypass RLS on both tables.
--
-- The indexes this file's hand-run sibling created already exist under other
-- names (idx_content_release_order, idx_content_type), so they are not repeated.
-- ============================================================================

drop view if exists public.all_episodes_with_crimes;

create view public.all_episodes_with_crimes
with (security_invoker = true) as
select
  coalesce(c.id, e.id)                         as id,
  e.id                                         as entry_id,
  e.slug                                       as entry_slug,
  e.title                                      as entry_title,
  e.type::text                                 as entry_type,
  e.episode_number                             as entry_episode_number,
  e.release_order                              as entry_release_order,
  e.air_date,

  -- Crime data (NULL when DCW has no crime template for this entry)
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
  c.image_name

from public.content_entries e
left join public.dcw_cases c on c.entry_id = e.id;

comment on view public.all_episodes_with_crimes is
  'Every content entry with crime data where available. Left join ensures episodes without DCW crime data still appear.';
