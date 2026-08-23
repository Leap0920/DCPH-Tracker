-- ============================================================================
-- Fix: backfill dcw_cases.entry_id using normalized title matching.
--
-- The sync route matches dcw_cases.page_title to content_entries.dcw_title
-- via exact string equality. This fails for curly quotes, punctuation
-- differences, case mismatches, and whitespace variations. This migration
-- backfills entry_id using a normalized comparison that strips all of that.
--
-- Run manually in the Supabase Dashboard SQL Editor. Idempotent.
-- ============================================================================

-- 1. Normalization function: lowercase, strip punctuation, strip curly quotes
create or replace function dcw_norm(t text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           lower(translate(coalesce(t, ''), E'\u2018\u2019\u201C\u201D\u2013\u2014_', '''''""--  ')),
           '[^a-z0-9]+', '', 'g'
         )
$$;

-- 2. First pass: match on normalized dcw_title (strongest signal)
update dcw_cases dc
set entry_id = ce.id
from content_entries ce
where dc.entry_id is null
  and ce.dcw_title is not null
  and dcw_norm(ce.dcw_title) = dcw_norm(dc.page_title);

-- 3. Second pass: fall back to normalized display title (weaker, only if dcw_title matched nothing)
update dcw_cases dc
set entry_id = ce.id
from content_entries ce
where dc.entry_id is null
  and dcw_norm(ce.title) = dcw_norm(dc.page_title);

-- 4. Functional indexes so the sync route can use the same normalization
create index if not exists content_entries_dcw_title_norm_idx
  on content_entries (dcw_norm(dcw_title));

create index if not exists content_entries_title_norm_idx
  on content_entries (dcw_norm(title));

create index if not exists dcw_cases_page_title_norm_idx
  on dcw_cases (dcw_norm(page_title));

-- 5. Verify:
--    select count(*) as total,
--           count(entry_id) as linked,
--           count(*) - count(entry_id) as orphaned
--    from dcw_cases;
--
--    select ce.type, count(*) as crimes, count(distinct dc.page_title) as pages
--    from dcw_cases dc
--    join content_entries ce on ce.id = dc.entry_id
--    group by ce.type
--    order by crimes desc;
