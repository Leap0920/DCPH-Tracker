-- ============================================================================
-- Case Files: ALL content entries with crime data where available.
-- Shows every episode/movie/special even if DCW has no crime template.
-- Run manually in the Supabase Dashboard SQL Editor. Idempotent.
-- ============================================================================

drop view if exists public.all_episodes_with_crimes;

create view public.all_episodes_with_crimes
with (security_invoker = true) as
select
  coalesce(c.id, gen_random_uuid())           as id,
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
left join public.dcw_cases c on c.entry_id = e.id;

comment on view public.all_episodes_with_crimes is
  'Every content entry with crime data where available. Left join ensures episodes without DCW crime data still appear.';

-- Verify:
--   select entry_type, count(*) as total,
--          count(crime_type) as has_crime_data
--   from all_episodes_with_crimes
--   group by entry_type
--   order by total desc;
