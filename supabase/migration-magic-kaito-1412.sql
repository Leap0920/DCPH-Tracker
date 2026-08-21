-- supabase/migration-magic-kaito-1412.sql
--
-- Restructure Magic Kaito 1412 into its 24 individual episodes, and populate
-- dcw_title so the live Detective Conan World wiki panel resolves for each one.
--
-- ══ REVISION NOTE — why this file changed ═════════════════════════════════
-- The first version used a TEMP table for the canonical episode list and failed
-- with: ERROR 42P01 relation "mk1412_canon" does not exist.
--
-- Temp tables are SESSION-scoped, and the Dashboard SQL Editor gives no
-- guarantee that consecutive statements run in one session: it executes over an
-- HTTP endpoint against pooled connections, and it did not honour the
-- script-level begin;/commit; as one unit. Either the ON COMMIT DROP fired at
-- the first implicit commit, or the next statement landed on a different backend
-- session — under either mechanism the table was gone by the following INSERT.
-- Dropping the ON COMMIT DROP clause would NOT have been enough.
--
-- The canonical list now lives in a REAL table, public.mk1412_canon_stage,
-- created in step 2 and dropped in step 6. It survives any execution model,
-- any commit boundary and any connection change. It is referenced by steps 3
-- and 4 so the 24-row list exists exactly ONCE in this file — the alternative,
-- inlining the same VALUES block in both statements, means two hand-transcribed
-- copies that can silently drift.
--
-- ══ HOW TO RUN ═══════════════════════════════════════════════════════════
-- There is NO begin;/commit; in this file, and you do not need to add one.
-- Every mutating statement is individually idempotent, so run the steps one at a
-- time (highlight a step, execute, read the output, move on). Re-running any
-- step, or the whole file, converges on the same correct state instead of
-- duplicating or corrupting anything:
--   * step 2b rename  — guarded by NOT EXISTS on the destination slug
--   * step 3 update   — sets absolute values keyed by slug, so it is naturally
--                       idempotent; running it twice changes nothing
--   * step 4 insert   — guarded by NOT EXISTS, inserts only what is missing
-- If your editor does support script-level transactions you may wrap steps 2-4
-- in begin;/commit; anyway — the staging table is permanent, so it survives the
-- commit either way. It buys little, because idempotency already means a
-- mid-script failure is repaired by simply re-running.
--
-- ══ WHEN TO RUN ══════════════════════════════════════════════════════════
-- After supabase/migration-fix-runtime-minutes.sql (already applied). The two
-- are order-independent: that file's magic_kaito predicate only fires on
-- implausible runtimes, and the 24 minutes written here are plausible.
--
-- ══ SCOPE — WHAT THIS TOUCHES ════════════════════════════════════════════
--   * the 16 existing "Magic Kaito 1412" rows: title, air_date, episode_number,
--     runtime_minutes, dcw_title, canon_order, release_order, synopsis.
--     image_url is NOT in any SET list, so hand-added cover art survives by
--     omission.
--   * 8 new rows for the episodes that have no row at all.
--   * NOTHING ELSE. The 12 original MK TV specials
--     (mk-magic-kaito-special-01..12, canon_order 606-739) are not matched by
--     any statement here and keep their titles, covers, runtimes and synopses.
--
-- NOTHING IS DELETED. The 7 combined chunk rows are RENAMED into the first
-- episode each contained:
--     -07-08 -> -07     -09-11 -> -09     -13-14 -> -13     -15-16 -> -15
--     -17-18 -> -17     -21-22 -> -21     -23-24 -> -23
-- This makes the cascade question moot — no row is removed, so whatever
-- ON DELETE rule watch_status carries is never exercised. It also keeps
-- hand-added covers in place and lets the 8 new rows inherit a cover from their
-- former chunk-mate.
--
-- CONSEQUENCE TO BE AWARE OF: a watch_status row that pointed at a chunk now
-- points at the FIRST episode of that block. Someone who marked -09-11 watched
-- shows ep 09 watched and eps 10, 11 unwatched. That is the honest reading of
-- ambiguous data and it inflates nobody's count, but it will look like progress
-- was lost if anyone had tracked the chunks.
--
-- ══ SOURCE OF TRUTH ══════════════════════════════════════════════════════
--   titles + air dates : official Japanese broadcast list (user-supplied)
--   dcw_title          : probed live from DCW's Category:Magic Kaito 1412
--                        Episodes index — 22 pages for 24 episodes, because
--                        "Golden Eye" covers eps 18+19 and "Midnight Crow"
--                        covers eps 23+24
--   runtime            : 24 minutes for all 24
--
-- dcw_title IS THE WIKI LOOKUP KEY, NOT A DISPLAY STRING. Where DCW's page name
-- differs from the official title, DCW wins, because tier 1 of
-- lib/dcw-episode.ts getDcwEpisodeDetails() resolves on exactly this value. The
-- user-facing `title` column keeps the official wording. They diverge in three
-- places: ep 07 (DCW uses Western name order "Kaito Kuroba's"), ep 12 (DCW says
-- "Christmas Eve", official says "Holy Night"), ep 16 (DCW "Miraculous",
-- official "Miracle").


-- ═══ STEP 1 — PRE-FLIGHT (read-only). Run this before anything else. ═══════

-- 1a. CONFIRM THE SLUG PREFIX. Every statement below assumes
--     'mk-magic-kaito-1412-'. If your slugs differ, find-and-replace that
--     prefix throughout this file before running steps 2-4.
select slug, title, episode_number, air_date, runtime_minutes,
       canon_order, release_order, dcw_title,
       left(coalesce(synopsis, ''), 40) as synopsis_head,
       (image_url is not null)          as has_cover
  from public.content_entries
 where type = 'magic_kaito'
 order by slug;

-- 1b. DID THE FAILED RUN PARTIALLY APPLY? Step 2b (the rename) uses inline
--     VALUES and does NOT depend on the staging table, so it could have
--     executed if the editor continued past the error.
--       7 / 9 / 0  -> clean state, nothing applied. Expected.
--       0 / 16 / 0 -> the renames DID apply and nothing else did. Rows -07, -09,
--                     -13, -15, -17, -21, -23 exist but still carry merged
--                     titles. No action needed: this file repairs that state
--                     exactly as it repairs the clean one.
--     Any other combination: stop and paste the 1a output before continuing.
select count(*) filter (where slug ~ '^mk-magic-kaito-1412-[0-9]{2}-[0-9]{2}$') as chunk_rows_remaining,
       count(*) filter (where slug ~ '^mk-magic-kaito-1412-[0-9]{2}$')          as individual_rows,
       count(*) filter (where dcw_title is not null)                            as rows_with_dcw_title
  from public.content_entries
 where type = 'magic_kaito'
   and slug like 'mk-magic-kaito-1412%';

-- 1c. Any staging table left over from a failed run? Zero rows expected; if one
--     is listed, step 2 drops it automatically.
select tablename from pg_tables
 where schemaname = 'public' and tablename = 'mk1412_canon_stage';

-- 1d. What already occupies the target canon_order range 741-764? Rows of
--     another type are harmless for fetchAdjacentEntries (it filters
--     .eq("type", type)), but check the result against any globally-ordered
--     view you have. To relocate the block, change the two "740 +"
--     occurrences in steps 3 and 4.
select type, count(*) as rows, min(canon_order), max(canon_order)
  from public.content_entries
 where canon_order between 741 and 764
 group by type
 order by type;


-- ═══ STEP 2 — canonical staging table + chunk renames ═════════════════════

-- 2a. The 24 episodes, defined ONCE, in a permanent table so no commit boundary
--     or connection change can lose it. Dropped again in step 6.
drop table if exists public.mk1412_canon_stage;

create table public.mk1412_canon_stage (
  ep         int  primary key,
  slug       text not null unique,
  title      text not null,   -- user-facing, official wording
  dcw_title  text not null,   -- DCW page name, the wiki lookup key
  air_date   date not null,
  donor_slug text             -- cover source, for rows that must be INSERTed
);

-- This table lives in `public` only because that is where the SQL Editor's
-- search_path points. It is scaffolding, not application data: lock it away from
-- the API for the few minutes it exists. RLS with no policies denies anon and
-- authenticated outright, while the editor's superuser role bypasses RLS and
-- works normally.
alter table public.mk1412_canon_stage enable row level security;
revoke all on table public.mk1412_canon_stage from anon, authenticated;

insert into public.mk1412_canon_stage (ep, slug, title, dcw_title, air_date, donor_slug) values
  ( 1, 'mk-magic-kaito-1412-01', 'The Revived Phantom Thief Kid',                              'The Revived Phantom Thief Kid',                   '2014-10-04', null),
  ( 2, 'mk-magic-kaito-1412-02', 'Blue Birthday',                                              'Blue Birthday',                                   '2014-10-11', null),
  ( 3, 'mk-magic-kaito-1412-03', 'Hustler vs. Magician',                                       'Hustler vs. Magician',                            '2014-10-18', null),
  ( 4, 'mk-magic-kaito-1412-04', 'A Great Detective Steps Into the Light',                      'A Great Detective Steps Into the Light',          '2014-10-25', null),
  -- 05 and 06 currently carry October air dates that belong in November.
  ( 5, 'mk-magic-kaito-1412-05', 'A Temptation in Scarlet',                                     'A Temptation in Scarlet',                         '2014-11-01', null),
  ( 6, 'mk-magic-kaito-1412-06', 'Black Star',                                                  'Black Star',                                      '2014-11-08', null),
  -- 07 arrives via the -07-08 rename; 08 is new and inherits 07's cover.
  ( 7, 'mk-magic-kaito-1412-07', 'Kuroba Kaito''s Busy Holiday',                                'Kaito Kuroba''s Busy Holiday',                    '2014-11-15', null),
  ( 8, 'mk-magic-kaito-1412-08', 'Adult''s Charm',                                              'The Adult''s Charm',                              '2014-11-22', 'mk-magic-kaito-1412-07'),
  -- 09 arrives via the -09-11 rename; 10 and 11 are new.
  ( 9, 'mk-magic-kaito-1412-09', 'The Phantom Lady Appears',                                    'The Phantom Lady Appears',                        '2014-11-29', null),
  (10, 'mk-magic-kaito-1412-10', 'The Phantom Lady and the Ryoma Treasure',                     'The Phantom Lady and Ryoma''s Treasure',          '2014-12-06', 'mk-magic-kaito-1412-09'),
  (11, 'mk-magic-kaito-1412-11', 'Kid and Conan''s Ryoma Treasure Illusion',                    'Kid and Conan''s Ryoma Treasure Illusion',        '2014-12-13', 'mk-magic-kaito-1412-09'),
  (12, 'mk-magic-kaito-1412-12', 'Holy Night: Two Kaitou Kids',                                 'Christmas Eve - Two Kaitou Kids',                 '2014-12-27', null),
  (13, 'mk-magic-kaito-1412-13', 'Stay Away from Him',                                          'Stay Away From Him',                              '2015-01-10', null),
  (14, 'mk-magic-kaito-1412-14', 'Crystal Mother',                                              'Crystal Mother',                                  '2015-01-17', 'mk-magic-kaito-1412-13'),
  (15, 'mk-magic-kaito-1412-15', 'The Princess and the Thief''s Improv',                        'The Princess and the Thief''s Improv',            '2015-01-24', null),
  (16, 'mk-magic-kaito-1412-16', 'Kid vs. Conan: Miracle Midair Walk',                          'Kid Vs Conan, Miraculous Midair Walk',            '2015-01-31', 'mk-magic-kaito-1412-15'),
  (17, 'mk-magic-kaito-1412-17', 'Green Dream',                                                 'Green Dream',                                     '2015-02-07', null),
  -- 18 and 19 share ONE DCW page ("Golden Eye"), as do 23 and 24 ("Midnight
  -- Crow"). Intentional, not a copy-paste slip: the wiki article covers both
  -- parts, so both rows show the same article and share one cache entry.
  (18, 'mk-magic-kaito-1412-18', 'Golden Eye (Part 1): Chat Noir''s Challenge',                 'Golden Eye',                                      '2015-02-14', 'mk-magic-kaito-1412-17'),
  (19, 'mk-magic-kaito-1412-19', 'Golden Eye (Part 2): Kid vs. Chat Noir Endgame',              'Golden Eye',                                      '2015-02-21', null),
  (20, 'mk-magic-kaito-1412-20', 'Dark Knight',                                                 'Dark Knight',                                     '2015-02-28', null),
  (21, 'mk-magic-kaito-1412-21', 'Kid vs. Conan: Teleportation Under the Moonlight',            'Kid vs Conan: Teleportation Under the Moonlight', '2015-03-07', null),
  (22, 'mk-magic-kaito-1412-22', 'Red Tear',                                                    'Red Tear',                                        '2015-03-14', 'mk-magic-kaito-1412-21'),
  (23, 'mk-magic-kaito-1412-23', 'Midnight Crow (Part 1): The Name is Phantom Thief Corbeau!',  'Midnight Crow',                                   '2015-03-21', null),
  (24, 'mk-magic-kaito-1412-24', 'Midnight Crow (Part 2): Clash! White or Black!?',             'Midnight Crow',                                   '2015-03-28', 'mk-magic-kaito-1412-23');

-- Sanity check the staging table itself before it drives any mutation.
-- Expect: 24 / 24 / 24 / 8
select count(*)                       as rows_loaded,
       count(distinct slug)           as distinct_slugs,
       count(distinct title)          as distinct_titles,
       count(donor_slug)              as rows_with_donor
  from public.mk1412_canon_stage;

-- 2b. Rename each combined chunk into the first episode it contained. Inline
--     VALUES, independent of the staging table. The NOT EXISTS guard makes this
--     re-runnable: once -07 exists, this statement stops touching -07-08.
update public.content_entries as c
   set slug = v.new_slug
  from (values
    ('mk-magic-kaito-1412-07-08', 'mk-magic-kaito-1412-07'),
    ('mk-magic-kaito-1412-09-11', 'mk-magic-kaito-1412-09'),
    ('mk-magic-kaito-1412-13-14', 'mk-magic-kaito-1412-13'),
    ('mk-magic-kaito-1412-15-16', 'mk-magic-kaito-1412-15'),
    ('mk-magic-kaito-1412-17-18', 'mk-magic-kaito-1412-17'),
    ('mk-magic-kaito-1412-21-22', 'mk-magic-kaito-1412-21'),
    ('mk-magic-kaito-1412-23-24', 'mk-magic-kaito-1412-23')
  ) as v(old_slug, new_slug)
 where c.type = 'magic_kaito'
   and c.slug = v.old_slug
   and not exists (
     select 1 from public.content_entries x where x.slug = v.new_slug
   );


-- ═══ STEP 3 — correct the 16 rows now present ═════════════════════════════
-- The 9 originals plus the 7 just renamed. Joined to the staging table on slug,
-- so the 12 specials cannot be reached. image_url is absent from the SET list on
-- purpose: hand-added covers are preserved by omission.
--
-- IDEMPOTENT: every assignment is an absolute value read from staging, keyed by
-- slug — no increments, no reads of the column being written. Running it twice,
-- or ten times, produces the same rows.
--
-- ONE CAVEAT for future re-runs: it unconditionally NULLs synopsis. If real
-- per-episode synopses are ever written into these rows, drop the synopsis line
-- before running this file again or they will be wiped.
update public.content_entries as c
   set title           = k.title,
       dcw_title       = k.dcw_title,
       air_date        = k.air_date,
       episode_number  = k.ep,
       runtime_minutes = 24,
       canon_order     = 740 + k.ep,
       release_order   = 9 + k.ep,
       -- All 16 rows carry the SAME placeholder ("Eight years after the
       -- mysterio…"), which reads as though 24 distinct episodes share one plot.
       -- Empty is more honest than wrong, and the live DCW panel supplies the
       -- real description. Comment this line out to keep the placeholders; if
       -- synopsis is NOT NULL in your schema, use '' instead of null.
       synopsis        = null
  from public.mk1412_canon_stage as k
 where c.slug = k.slug
   and c.type = 'magic_kaito';


-- ═══ STEP 4 — insert whatever is still missing ════════════════════════════
-- Driven by NOT EXISTS rather than a hardcoded list of 8, so it stays correct
-- whatever the live state is (clean, or renames-already-applied) and re-running
-- inserts nothing.
--
-- Cover inheritance: donor_slug first (the former chunk-mate, where the
-- hand-added art lives), then episode 01 as a series-level fallback.
insert into public.content_entries
  (slug, title, type, episode_number, air_date, canon_order, release_order,
   runtime_minutes, dcw_title, synopsis, image_url)
select k.slug,
       k.title,
       'magic_kaito',
       k.ep,
       k.air_date,
       740 + k.ep,
       9 + k.ep,
       24,
       k.dcw_title,
       null,
       coalesce(
         (select d.image_url from public.content_entries d where d.slug = k.donor_slug),
         (select d.image_url from public.content_entries d where d.slug = 'mk-magic-kaito-1412-01')
       )
  from public.mk1412_canon_stage as k
 where not exists (
   select 1 from public.content_entries c where c.slug = k.slug
 );

-- If this errors on a NOT NULL column not listed above, add that column here
-- rather than widening any statement in step 3.


-- ═══ STEP 5 — VERIFY. Run all of these before step 6 drops the staging ════
-- ═══          table, since 5f needs it.                                 ════

-- 5a. Expect exactly: 24 / 24 / 1 / 24 / 0
select count(*)                                    as rows_total,
       count(distinct episode_number)              as distinct_eps,
       min(episode_number)                         as min_ep,
       max(episode_number)                         as max_ep,
       count(*) filter (where dcw_title is null)   as missing_dcw_title
  from public.content_entries
 where type = 'magic_kaito'
   and slug like 'mk-magic-kaito-1412-%';

-- 5b. No merged chunk slug or title survives anywhere in the table.
--     Expect ZERO rows.
select slug, title from public.content_entries
 where slug ~ '-[0-9]{2}-[0-9]{2}$'
    or title ~ '[0-9]{2}-[0-9]{2}$';

-- 5c. Air-date walk. days_since_prev must be 7 or 14, and ONLY these two 14s are
--     legitimate: ep 11 -> 12 (2014-12-13 -> 2014-12-27, New Year break) and
--     ep 12 -> 13 (2014-12-27 -> 2015-01-10). Any other 14, or any other value,
--     means something is wrong. Also eyeball has_cover: all 24 true.
select episode_number, air_date,
       air_date - lag(air_date) over (order by episode_number) as days_since_prev,
       title, dcw_title, runtime_minutes, canon_order, release_order,
       (image_url is not null) as has_cover
  from public.content_entries
 where type = 'magic_kaito'
   and slug like 'mk-magic-kaito-1412-%'
 order by episode_number;

-- 5d. The 12 specials are exactly as they were: 12 rows, canon_order 606-739,
--     original titles, runtimes 24-25, synopses intact.
select slug, title, air_date, runtime_minutes, canon_order, release_order,
       dcw_title, (synopsis is not null) as has_synopsis
  from public.content_entries
 where type = 'magic_kaito'
   and slug not like 'mk-magic-kaito-1412-%'
 order by canon_order;

-- 5e. Whole type: expect 36 (12 specials + 24 episodes).
select count(*) as magic_kaito_total
  from public.content_entries
 where type = 'magic_kaito';

-- 5f. STRONGEST CHECK, newly possible because staging is a real table: a full
--     field-by-field diff of live rows against the canonical list. Catches a
--     half-applied step 3 that the count checks above would pass.
--     Expect ZERO rows.
select k.ep, c.slug,
       c.title           is distinct from k.title           as title_wrong,
       c.dcw_title       is distinct from k.dcw_title       as dcw_title_wrong,
       c.air_date        is distinct from k.air_date        as air_date_wrong,
       c.episode_number  is distinct from k.ep              as ep_number_wrong,
       c.runtime_minutes is distinct from 24                as runtime_wrong,
       c.canon_order     is distinct from (740 + k.ep)      as canon_order_wrong,
       c.release_order   is distinct from (9 + k.ep)        as release_order_wrong
  from public.mk1412_canon_stage k
  left join public.content_entries c
         on c.slug = k.slug and c.type = 'magic_kaito'
 where c.slug is null
    or c.title           is distinct from k.title
    or c.dcw_title       is distinct from k.dcw_title
    or c.air_date        is distinct from k.air_date
    or c.episode_number  is distinct from k.ep
    or c.runtime_minutes is distinct from 24
    or c.canon_order     is distinct from (740 + k.ep)
    or c.release_order   is distinct from (9 + k.ep)
 order by k.ep;


-- ═══ STEP 6 — CLEANUP. Only after step 5 passes. ═════════════════════════
-- Removes the scaffolding table so it does not linger in the Table Editor or the
-- API schema. If you ever abandon this file mid-run, run this line on its own.
drop table if exists public.mk1412_canon_stage;


-- ═══ STEP 7 — FOLLOW-UP, NOT DONE HERE: dcw_title elsewhere ══════════════
-- Deliberately out of scope, because it needs the same live category probe that
-- produced the 1412 mapping. Guessing a dcw_title is WORSE than leaving it NULL:
-- a wrong tier-1 hit short-circuits the four working fallback tiers in
-- lib/dcw-episode.ts, so a row that resolves fine by title today would stop
-- resolving.
--
-- Rows with no lookup key, by type:
--   select type,
--          count(*) filter (where dcw_title is null) as no_key,
--          count(*)                                  as total
--     from public.content_entries group by type order by type;
--
-- Rows whose TITLE looks merged or auto-generated — least likely to resolve by
-- title alone, so the next targets after this file:
--   select type, slug, title from public.content_entries
--    where dcw_title is null
--      and (title ~ '[0-9]{2}-[0-9]{2}' or title ~ '^[A-Za-z ]+ [0-9]+$')
--    order by type, slug;
--
-- Suggested order: the 12 MK specials, then the OVA set (Secret Files / Magic
-- Files / Shogakukan Encyclopedia), then live_action.
