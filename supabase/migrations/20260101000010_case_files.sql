-- ============================================================================
-- Case Files: crime data scraped from Detective Conan World's InfoBox Crime.
-- Run manually in the Supabase Dashboard SQL Editor. Idempotent.
--
-- One row per crime BLOCK, not per page: multi-case episodes embed the
-- template several times (e.g. "Roller Coaster Murder Case" has 3).
-- ============================================================================

create table if not exists public.dcw_cases (
  id                 uuid primary key default gen_random_uuid(),

  -- DCW page title, exactly as the wiki spells it. Joins to
  -- content_entries.dcw_title. (page_title, case_index) is the sync's upsert key.
  page_title         text not null,
  case_index         int  not null default 1,

  -- InfoBox "crime". The template itself defaults to Murder when blank.
  crime_type         text not null default 'Murder',
  crime_slug         text not null default 'murder',

  -- InfoBox "cause-death" — the method/weapon.
  cause_death        text,
  cause_slug         text,

  victim             text,
  suspects           text,
  people             text,
  location           text,
  description        text,

  -- Free-text as the wiki writes them; never parsed into date/time types.
  date_text          text,
  time_text          text,
  age_text           text,

  -- Template label overrides ("Victim" -> "Kidnapped" on abduction cases).
  victim_label       text,
  cause_death_label  text,
  suspects_label     text,

  -- Raw InfoBox "image" filename. Resolved to a URL later, if ever.
  image_name         text,

  -- Local tracker entry, resolved by the sync. Nullable: plenty of DCW case
  -- pages (manga-only chapters) have no local row.
  entry_id           uuid references public.content_entries(id) on delete set null,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint dcw_cases_page_case_unique unique (page_title, case_index)
);

create index if not exists dcw_cases_crime_slug_idx on public.dcw_cases (crime_slug);
create index if not exists dcw_cases_cause_slug_idx on public.dcw_cases (cause_slug);
create index if not exists dcw_cases_entry_id_idx   on public.dcw_cases (entry_id);
create index if not exists dcw_cases_page_title_idx on public.dcw_cases (page_title);

-- Case-insensitive victim/title search from the /cases search box.
create index if not exists dcw_cases_victim_lower_idx
  on public.dcw_cases (lower(victim));

-- ── RLS: world-readable, no client writes. ───────────────────────────────────
-- The sync route uses the service-role key, which bypasses RLS entirely, so
-- no insert/update/delete policy is needed or wanted here.
alter table public.dcw_cases enable row level security;

drop policy if exists "dcw_cases are publicly readable" on public.dcw_cases;
create policy "dcw_cases are publicly readable"
  on public.dcw_cases for select
  using (true);

grant select on public.dcw_cases to anon, authenticated;

-- Verify:
--   select crime_type, count(*) from public.dcw_cases group by 1 order by 2 desc;
