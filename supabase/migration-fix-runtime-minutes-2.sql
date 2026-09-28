-- Runtime accuracy pass #2 — corrects content_entries.runtime_minutes where the
-- stored value disagreed with the source. Run top-to-bottom in the Supabase
-- Dashboard SQL Editor (or via scripts/apply-runtime-fix-2.mjs).
--
-- WHAT THIS TOUCHES: runtime_minutes only. No title, slug, date, type, image or
-- ordering column is modified, so watch progress, favorites and ratings on these
-- rows are unaffected.
--
-- WHY: runtime_minutes is the tracker's core number — /tracker shows it per
-- entry and /analytics + /rank sum it into watch time. Pass #1
-- (migration-fix-runtime-minutes.sql) fixed NULLs and imported-ID junk with
-- plausibility predicates; this pass corrects the VALUES themselves, per entry,
-- against the sources below.
--
-- SOURCES (all re-checked 2026-09-27)
--   * Episodes — Detective Conan World season tables and episode infoboxes.
--     The infobox `int-episode` field is the international slot range: a special
--     occupies more than one slot. 2 slots = 1-hour special, 4 = 2-hour,
--     5 = 2.5-hour. Episode numbering here is the Japanese local numbering, which
--     is what content_entries.episode_number uses.
--   * Movies — DCW "Regular movies" (per-film runtime field) and "Compilation
--     movies".
--   * Live action — ja.wikipedia 名探偵コナン (テレビドラマ) infobox 放送分.
--   * Hanzawa / Zero's Tea Time — AniList episode durations (10 min × 12 eps,
--     15 min × 6 eps).
--
-- CONVENTION: a 1-hour broadcast slot is 46 content minutes (60 minus ads),
-- 2-hour = 92, 2.5-hour = 115. This matches every other runtime already in the
-- table, so the tracker's totals stay internally consistent.
--
-- Idempotent: every statement sets an absolute value, so re-running changes
-- nothing the second time.

-- ═══ STEP 1 — PRE-FLIGHT (read-only). Skim this before applying. ════════
-- Rows whose stored runtime differs from the corrected value.
select type, slug, runtime_minutes as before, after_runtime as after
  from (
    select 'episode'::text as type, slug, runtime_minutes,
           case episode_number
             when 11 then 46 when 52 then 46 when 76 then 46 when 96 then 92
             when 118 then 46 when 129 then 92 when 162 then 46 when 174 then 92
             when 184 then 46 when 208 then 46 when 219 then 92 when 263 then 92
             when 304 then 92 when 315 then 25 when 342 then 46 when 345 then 115
             when 356 then 46 when 383 then 92 when 425 then 115 when 449 then 46
             when 452 then 46 when 479 then 92 when 487 then 46 when 488 then 46
             when 489 then 46 when 490 then 46 when 515 then 46 when 516 then 46
             when 521 then 46 when 522 then 46 when 557 then 25 when 651 then 46
             when 734 then 46 when 804 then 46 when 805 then 46 when 916 then 25
             when 927 then 46 when 928 then 46 when 1187 then 46
           end as after_runtime
      from public.content_entries
     where type = 'episode'
       and episode_number in (11,52,76,96,118,129,162,174,184,208,219,263,304,
                              315,342,345,356,383,425,449,452,479,487,488,489,
                              490,515,516,521,522,557,651,734,804,805,916,927,
                              928,1187)
    union all
    select 'movie', slug, runtime_minutes,
           case slug
             when 'mov-32' then 95  when 'mov-35' then 100 when 'mov-55' then 108
             when 'mov-57' then 109 when 'mov-58' then 108 when 'mov-62' then 107
             when 'mov-64' then 112 when 'mov-29' then 103 when 'mov-31' then 110
             when 'mov-34' then 111 when 'mov-36' then 111 when 'mov-38' then 111
             when 'mov-40' then 113 when 'mov-44' then 111 when 'mov-45' then 110
             when 'mov-47' then 111 when 'mov-48' then 111 when 'mov-49' then 110
             when 'mov-46' then 110 when 'mov-37' then 107
             when 'mov-compilation-movie-the-story-of-haibara' then 90
           end
      from public.content_entries
     where slug in ('mov-32','mov-35','mov-55','mov-57','mov-58','mov-62','mov-64',
                    'mov-29','mov-31','mov-34','mov-36','mov-38','mov-40','mov-44',
                    'mov-45','mov-47','mov-48','mov-49','mov-46','mov-37',
                    'mov-compilation-movie-the-story-of-haibara')
    union all
    select 'special', slug, runtime_minutes,
           case slug when 'sp-02' then 25 when 'sp-03' then 92 when 'sp-04' then 25 end
      from public.content_entries where slug in ('sp-02','sp-03','sp-04')
    union all
    select 'live_action', slug, runtime_minutes,
           case slug
             when 'la-live-action-drama-special-01' then 108
             when 'la-live-action-drama-special-02' then 108
             when 'la-live-action-drama-special-03' then 104
             when 'la-live-action-drama-special-04' then 108
             -- 2011 series, 40 min per episode; grouped rows carry their total.
             when 'la-live-action-drama-episode-01-02' then 80
             when 'la-live-action-drama-episode-03' then 40
             when 'la-live-action-drama-episodes-04-07' then 160
             when 'la-live-action-drama-episodes-08-09' then 80
             when 'la-live-action-drama-episodes-10-11' then 80
             when 'la-live-action-drama-episode-12-13' then 80
             when 'drama-episode-11' then 40
             when 'drama-episode-12' then 40
             when 'drama-episode-13' then 40
           end
      from public.content_entries
     where type = 'live_action'
    union all
    select 'hanzawa', slug, runtime_minutes, 10
      from public.content_entries where type = 'hanzawa'
    union all
    select 'zero_tea_time', slug, runtime_minutes, 15
      from public.content_entries where type = 'zero_tea_time'
  ) x
 where runtime_minutes is distinct from after_runtime
 order by type, slug;

-- ═══ STEP 2 — EPISODES ═══════════════════════════════════════════════════
-- Hour / 2-hour / 2.5-hour specials. Episode numbers are the Japanese local
-- numbering used by content_entries.episode_number.

-- Correct length already, re-asserted so a partial database converges:
update public.content_entries set runtime_minutes = 46
 where type = 'episode'
   and episode_number in (11,52,76,118,208,356,449,487,488,490,515,734);

update public.content_entries set runtime_minutes = 92
 where type = 'episode'
   and episode_number in (96,129,174,219,263,479);

-- Wrong length, corrected:
update public.content_entries set runtime_minutes = 46
 where type = 'episode'
   and episode_number in (162,184,342,452,489,516,521,522,651,804,805,927,928,1187);

update public.content_entries set runtime_minutes = 92
 where type = 'episode'
   and episode_number in (304,383);

update public.content_entries set runtime_minutes = 115
 where type = 'episode'
   and episode_number in (345,425);

-- Multi-part cases whose infobox spans several slots but whose individual
-- broadcasts are standard length: 315 (int 340), 557 (int 608),
-- 916 (int 971-972, Parts 1-2 aired a week apart).
update public.content_entries set runtime_minutes = 25
 where type = 'episode'
   and episode_number in (315,557,916);

-- Standard-length spine. Runs after the specials above, and only touches rows
-- that are not one of them.
update public.content_entries set runtime_minutes = 25
 where type = 'episode'
   and runtime_minutes is null
   and episode_number not in (11,52,76,96,118,129,162,174,184,208,219,263,304,
                              315,342,345,356,383,425,449,452,479,487,488,489,
                              490,515,516,521,522,557,651,734,804,805,916,927,
                              928,1187);

-- ═══ STEP 3 — MOVIES ═════════════════════════════════════════════════════
-- DCW "Regular movies", per-film runtime. mov-32…mov-52 are movie_number 1…29
-- (2003-2017 rows live under mov-53…mov-64 after the renumber migration).
update public.content_entries set runtime_minutes = 95  where slug = 'mov-32'; -- M1  1997
update public.content_entries set runtime_minutes = 100 where slug = 'mov-35'; -- M2  1998
update public.content_entries set runtime_minutes = 108 where slug = 'mov-55'; -- M6  2002
update public.content_entries set runtime_minutes = 109 where slug = 'mov-57'; -- M8  2004
update public.content_entries set runtime_minutes = 108 where slug = 'mov-58'; -- M9  2005
update public.content_entries set runtime_minutes = 107 where slug = 'mov-62'; -- M11 2007
update public.content_entries set runtime_minutes = 112 where slug = 'mov-64'; -- M13 2009
update public.content_entries set runtime_minutes = 103 where slug = 'mov-29'; -- M14 2010
update public.content_entries set runtime_minutes = 110 where slug = 'mov-31'; -- M15 2011
update public.content_entries set runtime_minutes = 111 where slug = 'mov-34'; -- M16 2012
update public.content_entries set runtime_minutes = 111 where slug = 'mov-36'; -- M17 2013
update public.content_entries set runtime_minutes = 111 where slug = 'mov-38'; -- M18 2014
update public.content_entries set runtime_minutes = 113 where slug = 'mov-40'; -- M19 2015
update public.content_entries set runtime_minutes = 111 where slug = 'mov-44'; -- M22 2018 (was NULL)
update public.content_entries set runtime_minutes = 110 where slug = 'mov-45'; -- M23 2019 (was NULL)
update public.content_entries set runtime_minutes = 111 where slug = 'mov-47'; -- M24 2021
update public.content_entries set runtime_minutes = 111 where slug = 'mov-48'; -- M25 2022
update public.content_entries set runtime_minutes = 110 where slug = 'mov-49'; -- M26 2023

-- Compilation / crossover films:
update public.content_entries set runtime_minutes = 110 where slug = 'mov-46'; -- The Scarlet Alibi (2021)
update public.content_entries set runtime_minutes = 107 where slug = 'mov-37'; -- Lupin III vs. Conan: The Movie (2013)
update public.content_entries set runtime_minutes = 90
 where slug = 'mov-compilation-movie-the-story-of-haibara'; -- 2023 compilation

-- Not changed, because the sources disagree or list no runtime:
--   mov-52 (M29, 2026)      DCW lists "TBA"; the stored 110 is the series norm.
--   mov-33 (planetarium short, 2012) and mov-41 (manner movie) have no per-title
--   runtime published; both are already short and bounded.

-- ═══ STEP 4 — TV SPECIALS ════════════════════════════════════════════════
update public.content_entries set runtime_minutes = 25 where slug = 'sp-02'; -- Black History recap, 25 min
update public.content_entries set runtime_minutes = 92 where slug = 'sp-03'; -- Ultra 30, two-hour slot
update public.content_entries set runtime_minutes = 25 where slug = 'sp-04'; -- Fugitive: Kogoro Mouri, regular-slot web animation

-- Not changed: sp-01 (Time Travel of the Silver Sky) and
-- star-detectives-assemble carry no published runtime in any source checked.

-- ═══ STEP 5 — LIVE ACTION ════════════════════════════════════════════════
-- ja.wikipedia 放送分 for the four TV specials:
update public.content_entries set runtime_minutes = 108 where slug = 'la-live-action-drama-special-01'; -- 2006
update public.content_entries set runtime_minutes = 108 where slug = 'la-live-action-drama-special-02'; -- 2007
update public.content_entries set runtime_minutes = 104 where slug = 'la-live-action-drama-special-03'; -- 2011, Friday Super Prime
update public.content_entries set runtime_minutes = 108 where slug = 'la-live-action-drama-special-04'; -- 2012

-- 2011 series (木曜ミステリーシアター, 23:58-24:38): 40 minutes per episode.
-- Rows that group several episodes carry the group total.
update public.content_entries set runtime_minutes = 80  where slug = 'la-live-action-drama-episode-01-02';  -- eps 1-2
update public.content_entries set runtime_minutes = 40  where slug = 'la-live-action-drama-episode-03';     -- ep 3
update public.content_entries set runtime_minutes = 160 where slug = 'la-live-action-drama-episodes-04-07'; -- eps 4-7
update public.content_entries set runtime_minutes = 80  where slug = 'la-live-action-drama-episodes-08-09'; -- eps 8-9
update public.content_entries set runtime_minutes = 80  where slug = 'la-live-action-drama-episodes-10-11'; -- eps 10-11
update public.content_entries set runtime_minutes = 80  where slug = 'la-live-action-drama-episode-12-13';  -- eps 12-13
update public.content_entries set runtime_minutes = 40  where slug in ('drama-episode-11','drama-episode-12','drama-episode-13');

-- NOTE: this type still contains two overlapping coverages of the same episodes
-- (the la-live-action-drama-episodes-* groups and the standalone
-- drama-episode-11/12/13 rows). That is a catalog-dedup problem, not a runtime
-- problem, and is left for a separate pass.

-- ═══ STEP 6 — SPIN-OFFS ══════════════════════════════════════════════════
-- AniList: Hannin no Hanzawa-san is 12 episodes at 10 minutes (was 2 — an ID).
update public.content_entries set runtime_minutes = 10 where type = 'hanzawa';

-- AniList: Zero's Tea Time is 6 episodes at 15 minutes (was 3 — an ID).
update public.content_entries set runtime_minutes = 15 where type = 'zero_tea_time';

-- magic_kaito and ova are left as they are: MK1412 is 24 min/episode (AniList
-- agrees) and the stored 22-29 min OVA values are all plausible.

-- ═══ STEP 7 — VERIFY ═════════════════════════════════════════════════════
-- Expect 0 rows.
select type, slug, runtime_minutes
  from public.content_entries
 where runtime_minutes is null
    or runtime_minutes <= 0
    or runtime_minutes > 200
 order by type, slug;

-- Distributions after the pass (sanity check against the source list above).
select type, runtime_minutes, count(*)
  from public.content_entries
 group by type, runtime_minutes
 order by type, runtime_minutes;
