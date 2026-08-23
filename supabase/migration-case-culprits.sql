-- ============================================================================
-- Case Files: culprit list per case (manual curation, spoiler-safe).
-- Adds culprits array + count to dcw_cases and recreates the view.
-- Run manually in the Supabase Dashboard SQL Editor. Idempotent.
-- ============================================================================

alter table public.dcw_cases
  add column if not exists culprits      text[],
  add column if not exists culprit_count int;

comment on column public.dcw_cases.culprits is
  'Names from == People == whose role bullets read as culprit/accomplice. NULL when not yet curated or page-level ambiguous. SPOILER — must render blurred.';
comment on column public.dcw_cases.culprit_count is
  'array_length(culprits,1) denormalized for indexed filtering. NULL when culprits is NULL.';

create index if not exists dcw_cases_culprit_count_idx
  on public.dcw_cases (culprit_count) where culprit_count is not null;

-- View enumerates columns explicitly, so it MUST be recreated to expose them.
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
  c.culprits,
  c.culprit_count,
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
  'dcw_cases pre-joined to content_entries. Re-run this file after adding columns to dcw_cases.';

-- Verify after manual update:
--   update dcw_cases set culprits = array['Kaito Kid'], culprit_count = 1 where page_title = 'Test Page' and case_index = 1;
--   select culprit_count, count(*) from dcw_cases_view group by 1 order by 1 nulls last;
