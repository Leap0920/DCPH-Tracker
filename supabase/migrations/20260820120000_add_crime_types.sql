-- Crime taxonomy: content_entries.crime_types stores taxonomy slugs.
-- Source of truth for labels/descriptions is lib/crime-categories.ts.
-- Regenerate the CHECK constraint whenever the taxonomy gains or loses a slug.

alter table content_entries
  add column if not exists crime_types text[] not null default '{}'::text[];

alter table content_entries
  drop constraint if exists content_entries_crime_types_valid;

alter table content_entries
  add constraint content_entries_crime_types_valid
  check (
    crime_types <@ array[
      'stabbing',
      'blunt-force',
      'strangulation',
      'poisoning',
      'shooting',
      'explosion',
      'arson',
      'drowning',
      'fall',
      'electrocution',
      'suffocation',
      'locked-room',
      'staged-accident',
      'serial-murder',
      'kidnapping',
      'theft-heist',
      'no-crime'
    ]::text[]
  );

-- Supports @> / && / = any() filtering when you move filtering server-side.
create index if not exists content_entries_crime_types_idx
  on content_entries using gin (crime_types);

comment on column content_entries.crime_types is
  'Crime taxonomy slugs. Validated against lib/crime-categories.ts via CHECK constraint.';
