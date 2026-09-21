-- supabase/migrations/20260919100000_ai_corpus.sql
--
-- The retrieval corpus. Three additions, all additive:
--   pg_trgm        - trigram index support for typo-tolerant title lookup
--   ai_documents   - one row per retrievable document, FTS + trigram indexed
--   ai_wiki_cache  - time-boxed cache in front of the live DCW/Wikipedia fetch
--
-- ai_documents is reachable only with the service-role key: RLS is enabled with
-- NO policies, mirroring public.rate_limits and ai_provider_state.

create extension if not exists pg_trgm with schema extensions;

create table if not exists public.ai_documents (
  id             text        primary key,
  source         text        not null,
  title          text        not null,
  body           text        not null default '',
  url            text,
  metadata       jsonb       not null default '{}'::jsonb,
  -- First-class rather than metadata jsonb: R1 of the ladder looks an episode
  -- number up by equality on every "what happened in episode N" question.
  episode_number integer,
  movie_number   integer,
  aliases        text[]      not null default '{}'::text[],
  content_hash   text        not null,
  updated_at     timestamptz not null default now(),
  -- to_tsvector must be given an explicit regconfig: the one-argument form is
  -- STABLE, not IMMUTABLE, and a generated column rejects it.
  fts tsvector generated always as (
    setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(body, '')), 'B')
  ) stored
);

create index if not exists ai_documents_fts_idx
  on public.ai_documents using gin (fts);

create index if not exists ai_documents_title_trgm_idx
  on public.ai_documents using gin (title extensions.gin_trgm_ops);

create index if not exists ai_documents_aliases_idx
  on public.ai_documents using gin (aliases);

create index if not exists ai_documents_source_idx
  on public.ai_documents (source);

create index if not exists ai_documents_episode_idx
  on public.ai_documents (episode_number)
  where episode_number is not null;

create index if not exists ai_documents_movie_idx
  on public.ai_documents (movie_number)
  where movie_number is not null;

alter table public.ai_documents enable row level security;
revoke all on table public.ai_documents from anon, authenticated;

create table if not exists public.ai_wiki_cache (
  cache_key  text        primary key,
  source     text        not null,
  title      text        not null,
  extract    text        not null,
  url        text,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists ai_wiki_cache_expires_at_idx
  on public.ai_wiki_cache (expires_at);

alter table public.ai_wiki_cache enable row level security;
revoke all on table public.ai_wiki_cache from anon, authenticated;

-- R1: entity-precise. Episode/movie number, exact title, alias, or title substring.
-- p_names must already be lowercase and non-empty; the caller normalises.
create or replace function public.ai_docs_entity(p_numbers int[], p_names text[], p_limit int)
returns table (id text, rank real)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select d.id,
         greatest(
           case when d.episode_number = any (p_numbers) or d.movie_number = any (p_numbers) then 3.0 else 0.0 end,
           case when lower(d.title) = any (p_names) then 2.0 else 0.0 end,
           case when d.aliases && p_names then 1.5 else 0.0 end,
           case when exists (
             select 1 from unnest(p_names) as n
             where n <> '' and lower(d.title) like '%' || n || '%'
           ) then 1.0 else 0.0 end
         )::real as rank
  from public.ai_documents as d
  where d.episode_number = any (p_numbers)
     or d.movie_number = any (p_numbers)
     or lower(d.title) = any (p_names)
     or d.aliases && p_names
     or exists (
       select 1 from unnest(p_names) as n
       where n <> '' and lower(d.title) like '%' || n || '%'
     )
  order by rank desc, d.id
  limit p_limit;
$$;

-- R2: full-text. websearch_to_tsquery never raises on malformed input - it
-- returns an empty tsquery, which matches nothing. That is the property that
-- makes it safe to hand a user's raw question to the database.
create or replace function public.ai_docs_fts(p_query text, p_limit int)
returns table (id text, rank real)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  with q as (select websearch_to_tsquery('english'::regconfig, p_query) as query)
  select d.id, ts_rank_cd(d.fts, q.query)::real as rank
  from public.ai_documents as d, q
  where d.fts @@ q.query
  order by rank desc, d.id
  limit p_limit;
$$;

-- R3: typo tolerance on titles. similarity() is qualified because pg_trgm lives
-- in the extensions schema; the % operator honours pg_trgm.similarity_threshold.
create or replace function public.ai_docs_fuzzy(p_query text, p_keywords text[], p_limit int)
returns table (id text, rank real)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select d.id,
         greatest(
           extensions.similarity(lower(d.title), lower(coalesce(p_query, ''))),
           coalesce((
             select max(extensions.similarity(lower(d.title), k))
             from unnest(p_keywords) as k
             where length(k) >= 3
           ), 0.0)
         )::real as rank
  from public.ai_documents as d
  where lower(d.title) % lower(coalesce(p_query, ''))
     or exists (
       select 1 from unnest(p_keywords) as k
       where length(k) >= 3 and lower(d.title) % k
     )
  order by rank desc, d.id
  limit p_limit;
$$;
