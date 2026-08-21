-- Track where an image came from so backfills are idempotent and auditable.
alter table public.content_entries
  add column if not exists dcw_title text,
  add column if not exists image_source text;

comment on column public.content_entries.dcw_title is
  'Resolved Detective Conan World article title used to source image_url.';
comment on column public.content_entries.image_source is
  'One of: dcw | upstream | placeholder.';

create index if not exists content_entries_image_source_idx
  on public.content_entries (image_source);

-- Also update schema.sql mirror is handled separately
