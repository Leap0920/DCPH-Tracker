-- ============================================================================
-- Case Files: also show DCW crimes that have no matching tracker entry.
--
-- WHY: the view was content_entries LEFT JOIN dcw_cases, so a DCW crime page
-- only reaches /cases if its title matched a content_entries row. As of the
-- 2026-09-27 sync, 282 of 2,018 crime records (102 pages, ~14%) belong to pages
-- with entry_id = NULL and were therefore invisible on /cases — including every
-- recent multi-part arc, because DCW files the arc under one page title ("The
-- Birdman Rally Bombing") while the tracker splits it into parts.
--
-- WHAT THIS CHANGES: a full outer join. Crime rows with no entry now render as
-- their own file — titled from the DCW page, carryable through every crime /
-- method / content filter, with the "read on DCW" link and no tracker link.
-- Entries with no crime data are unaffected.
--
-- THE TRADE-OFF, so it is a deliberate choice and not a surprise: those files
-- have no episode number or release order, so they sort to the bottom of the
-- default "watch order" list and can only be found there by paging to the end,
-- or by sorting A→Z / grouping by crime type. They also include DCW pages for
-- material the tracker does not carry at all (novels, manga special volumes).
--
-- NOT YET APPLIED — run by hand in the Supabase Dashboard SQL Editor, then
-- reload /cases. Idempotent; wrapped in a transaction so a failed create cannot
-- leave the view dropped.
-- ============================================================================

begin;

drop view if exists public.all_episodes_with_crimes;

create view public.all_episodes_with_crimes
with (security_invoker = true) as
select
  -- Stable row key: the crime row's id, else the entry's. gen_random_uuid()
  -- must NOT be used here — the facet fetch pages this view with ORDER BY, and
  -- a key that changes between requests makes the windows overlap.
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
  c.image_name,
  c.culprits,
  c.culprit_count

from public.content_entries e
full outer join public.dcw_cases c on c.entry_id = e.id;

comment on view public.all_episodes_with_crimes is
  'Every content entry plus every DCW crime row, including crime pages the tracker has no entry for.';

commit;

-- Verify (before/after: 2373 rows with 1736 crimes; after: ~2655 rows, same 1736
-- crimes plus 282 previously unreachable ones):
--   select count(*) as rows,
--          count(crime_slug) as crimes,
--          count(*) filter (where entry_id is null) as untracked_crimes
--   from all_episodes_with_crimes;
--
--   select entry_type, count(*) from all_episodes_with_crimes group by entry_type order by 2 desc;
