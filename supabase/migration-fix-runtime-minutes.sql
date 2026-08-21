-- Fix content_entries.runtime_minutes so analytics watch-time math is correct.
-- Run top-to-bottom in the Supabase Dashboard SQL Editor.
--
-- WHAT THIS TOUCHES: the runtime_minutes column, and nothing else. No title, no
-- slug, no image_url, no type, no canon_order. Recently hand-added entries and
-- cover art are unaffected.
--   (If content_entries has an updated_at trigger, updated_at will bump on the
--    rows that change. Harmless, but expected.)
--
-- TWO PROBLEMS BEING FIXED
--
--  1. UNDER-COUNT: 1,205 of 1,209 episodes have runtime_minutes = NULL, because
--     app/api/sync/route.ts inserts NULL (Jikan exposes no per-episode
--     duration). Analytics sums that column, so those episodes contribute ZERO.
--     A user who watched 500 episodes currently shows ~0 minutes.
--
--  2. JUNK: ~75 rows hold values that are provably not runtimes but sequential
--     source IDs — they increase monotonically with episode order (Hanzawa
--     ep1=1153 … ep12=1172; live_action Ep1=472 … Ep10=706). One movie row reads
--     1188 minutes, i.e. 19.8 hours.
--
-- supabase/seed.sql already has the right fill values but guards them with
-- "WHERE runtime_minutes IS NULL OR = 0", which is exactly why the junk survived
-- every re-seed. Step 7 offers a fix for that gap.
--
-- WHY PLAUSIBILITY PREDICATES INSTEAD OF SLUG LISTS
-- Each block matches on type plus a ceiling that sits ABOVE every real runtime
-- for that type and BELOW every junk ID. Consequences, all deliberate:
--   * legitimate values you or the seed already set are preserved untouched
--     (the three real magic_kaito values, the dozen real OVA values)
--   * no slug inventory is needed
--   * the file is safely RE-RUNNABLE: a second run matches nothing new
--   * episode hour-specials you set later (46 / 92) are BELOW the episode
--     ceiling of 120, so re-running this file will never clobber them
--
-- NOT API-VERIFIED: Jikan/MyAnimeList returned 504 for every request during this
-- audit. High-confidence values come from supabase/seed.sql and well-established
-- series facts. The hour / 2-hour episode specials come from the owner's curated
-- Detective_Conan_Extended_Specials_Tracker sheet (step 2a-b). Remaining
-- low-confidence values are marked "VERIFY" inline (TV specials in step 3, the
-- Haibara compilation in step 4b, live-action chunks in 2f).

-- ═══ STEP 1 — PRE-FLIGHT: exactly what will change ════════════════════
-- Read-only. Run this FIRST and skim it. Nothing outside this list is touched.
select
  type,
  slug,
  title,
  runtime_minutes as before,
  case
    when type = 'episode'        then 25
    when type = 'hanzawa'        then 2
    when type = 'zero_tea_time'  then 3
    when type = 'magic_kaito'    then 24
    when type = 'ova'            then 25
    when type = 'live_action'    then 46
  end as after_value
  from public.content_entries
 where (type = 'episode'       and (runtime_minutes is null or runtime_minutes = 0 or runtime_minutes > 120))
    or (type = 'hanzawa'       and (runtime_minutes is null or runtime_minutes = 0 or runtime_minutes > 10))
    or (type = 'zero_tea_time' and (runtime_minutes is null or runtime_minutes = 0 or runtime_minutes > 10))
    or (type = 'magic_kaito'   and (runtime_minutes is null or runtime_minutes = 0 or runtime_minutes > 60))
    or (type = 'ova'           and (runtime_minutes is null or runtime_minutes = 0 or runtime_minutes > 60))
    or (type = 'live_action'   and (runtime_minutes is null or runtime_minutes = 0 or runtime_minutes > 120))
 order by type, slug;

-- Pre-flight for step 2a-b: the 23 confirmed hour / 2-hour specials.
-- Source: the owner's curated Detective_Conan_Extended_Specials_Tracker sheet.
select episode_number, title, runtime_minutes as before,
       case when v.hours = 1 then 46 else 92 end as after_value
  from public.content_entries
  join (values (11,1),(52,1),(76,1),(96,2),(118,1),(129,2),(174,2),(208,1),
               (219,2),(263,2),(304,1),(315,2),(342,2),(356,1),(449,1),
               (479,2),(487,1),(488,1),(490,1),(515,1),(557,1),(734,1),(916,1)
       ) as v(ep, hours)
    on episode_number = v.ep
 where type = 'episode'
 order by episode_number;

-- Count by type, so you can sanity-check the scale before writing anything.
-- Expect roughly: episode 1205, hanzawa 12, zero_tea_time 6,
-- magic_kaito 25, ova ~20, live_action ~13.
select type, count(*) as rows_to_change
  from public.content_entries
 where (type = 'episode'       and (runtime_minutes is null or runtime_minutes = 0 or runtime_minutes > 120))
    or (type = 'hanzawa'       and (runtime_minutes is null or runtime_minutes = 0 or runtime_minutes > 10))
    or (type = 'zero_tea_time' and (runtime_minutes is null or runtime_minutes = 0 or runtime_minutes > 10))
    or (type = 'magic_kaito'   and (runtime_minutes is null or runtime_minutes = 0 or runtime_minutes > 60))
    or (type = 'ova'           and (runtime_minutes is null or runtime_minutes = 0 or runtime_minutes > 60))
    or (type = 'live_action'   and (runtime_minutes is null or runtime_minutes = 0 or runtime_minutes > 120))
 group by type
 order by type;

-- ═══ STEP 2 — BULK FILL BY TYPE ═══════════════════════════════════════
-- One transaction: either all of this lands or none of it does.
begin;

-- 2a. Mainline episodes -> 25 (matches supabase/seed.sql and MAL's listed
--     duration). Ceiling 120 so genuine hour-special values (46 / 92) survive a
--     re-run of this file. This is the STANDARD-LENGTH baseline; the confirmed
--     hour / 2-hour specials are corrected in step 2a-b right after.
update public.content_entries
   set runtime_minutes = 25
 where type = 'episode'
   and (runtime_minutes is null or runtime_minutes = 0 or runtime_minutes > 120);

-- 2a-b. CONFIRMED hour / 2-hour specials -> 46 / 92.
--     Source: the owner's curated tracker sheet
--     (Detective_Conan_Extended_Specials_Tracker), compiled from DCW's "Anime
--     Specials" page and Wikipedia's per-season 1hr/2hr footnotes. Japanese air
--     numbering matches content_entries.episode_number (both follow original
--     broadcast order — spot-checked: ep 11 Moonlight Sonata, ep 52 Mist Goblin).
--     Unconditional on purpose: for these 23 rows the list IS the ground truth.
--
--     Confirmed STANDARD length, no action needed (stay at 25 from step 2a):
--       * the five Wild Police Story "special planning" episodes
--         (1029, 1038, 1042, 1061, 1133)
--       * every multi-part aired block (387-389, 425-426, 459-463, 965-968,
--         1000-1001, 1142-1143 incl. The Ranpo Mansion Murder Case) — those are
--         consecutive normal episodes, not extended ones.
update public.content_entries
   set runtime_minutes = case when v.hours = 1 then 46 else 92 end
  from (values
    -- 1-hour specials -> 46 content minutes
    (11, 1), (52, 1), (76, 1), (118, 1), (208, 1), (304, 1), (356, 1),
    (449, 1), (487, 1), (488, 1), (490, 1), (515, 1), (557, 1), (734, 1),
    (916, 1),
    -- 2-hour specials -> 92 content minutes
    (96, 2), (129, 2), (174, 2), (219, 2), (263, 2), (315, 2), (342, 2),
    (479, 2)
  ) as v(ep, hours)
 where type = 'episode'
   and episode_number = v.ep;

-- 2b. "The Culprit Hanzawa" -> 2. Comedy shorts. All 12 rows currently hold
--     sequential IDs 1153-1172.
update public.content_entries
   set runtime_minutes = 2
 where type = 'hanzawa'
   and (runtime_minutes is null or runtime_minutes = 0 or runtime_minutes > 10);

-- 2c. "Zero's Tea Time" -> 3. Shorts. All 6 rows hold IDs 1125-1136.
update public.content_entries
   set runtime_minutes = 3
 where type = 'zero_tea_time'
   and (runtime_minutes is null or runtime_minutes = 0 or runtime_minutes > 10);

-- 2d. Magic Kaito -> 24 (Magic Kaito 1412 TV length). Ceiling 60 PRESERVES the
--     three legitimate values already present (25, 30, 30) — older MK specials
--     vary and are not overwritten.
update public.content_entries
   set runtime_minutes = 24
 where type = 'magic_kaito'
   and (runtime_minutes is null or runtime_minutes = 0 or runtime_minutes > 60);

-- 2e. OVAs -> 25 (Secret Files / Magic Files / Conan vs Wooo are all ~22-30).
--     Ceiling 60 preserves the ~12 rows already holding real 22-29 values.
--     VERIFY LATER: the "Shogakukan Illustrated Encyclopedia" OVAs (#01-#11)
--     are currently NULL and may be shorter educational pieces; 25 is a bounded
--     default, not a confident figure.
update public.content_entries
   set runtime_minutes = 25
 where type = 'ova'
   and (runtime_minutes is null or runtime_minutes = 0 or runtime_minutes > 60);

-- 2f. Live-action -> 46. VERIFY: these rows are per-"Drama Episode" chunks of
--     TV specials. 46 is the content length of a 1-hour broadcast slot, which
--     fits a chunked row better than a 90+ minute whole-special figure. If your
--     rows actually represent whole specials rather than chunks, change to 92.
--     Currently 10 of 13 hold sequential IDs 472-706.
update public.content_entries
   set runtime_minutes = 46
 where type = 'live_action'
   and (runtime_minutes is null or runtime_minutes = 0 or runtime_minutes > 120);

-- ═══ STEP 3 — PER-TITLE: TV SPECIALS ══════════════════════════════════
-- These genuinely differ per title, so there is no defensible blanket value.
-- Every figure here is a SLOT-BASED ESTIMATE (1-hour slot ~= 46 content min,
-- 2-hour slot ~= 92) and is LOW CONFIDENCE without Jikan. Adjust freely — this
-- block is small and isolated on purpose.
--
-- "Lupin III vs. Detective Conan" already reads 105 and is correct: it is
-- absent from this block and stays untouched.
--
-- Matched on title (I do not have your special slugs). ILIKE with a leading and
-- trailing % tolerates subtitle differences; the guard clause still restricts
-- every match to type = 'special'.
update public.content_entries as c
   set runtime_minutes = v.minutes
  from (values
    -- VERIFY: 2-hour specials.
    ('%Disappearance of Conan Edogawa%',            92),
    ('%Love Story at Police Headquarters%',         92),
    ('%Episode One%',                              92),
    ('%Fugitive Kogoro%',                          92),
    -- VERIFY: 1-hour specials.
    ('%Time Travel of the Silver Sky%',            46),
    ('%Star Detectives Assemble%',                 46),
    -- VERIFY: recap/clip special, likely a single-slot piece.
    ('%Black History%',                            24)
  ) as v(pattern, minutes)
 where c.type = 'special'
   and c.title ilike v.pattern
   -- Same guard as everywhere else: never overwrite a plausible existing value.
   and (c.runtime_minutes is null or c.runtime_minutes = 0 or c.runtime_minutes > 200);

-- ═══ STEP 4 — MOVIES ══════════════════════════════════════════════════
-- 4a. Movies 22 and 23 are NULL; these two values come straight from the
--     supabase/seed.sql RUNTIMES CASE, so they are high confidence.
update public.content_entries
   set runtime_minutes = 111
 where slug = 'mov-22'
   and (runtime_minutes is null or runtime_minutes = 0);

update public.content_entries
   set runtime_minutes = 110
 where slug = 'mov-23'
   and (runtime_minutes is null or runtime_minutes = 0);

-- 4b. The Haibara compilation currently reads 1188 (19.8 hours) — a source ID.
--     VERIFY: it is a theatrical compilation film, so it belongs near 100
--     minutes, NOT the ~25 a TV episode would get.
update public.content_entries
   set runtime_minutes = 100
 where type = 'movie'
   and title ilike '%Haibara%'
   and (runtime_minutes is null or runtime_minutes = 0 or runtime_minutes > 200);

-- 4c. NOT TOUCHED, on purpose: "Manner Movie" = 1 (it really is a ~1-minute
--     manner short) and "The Magician of Starlight" = 25 (a short). Both are
--     plausible as-is and no statement above matches them.

-- ═══ STEP 5 — VERIFY, THEN COMMIT ═════════════════════════════════════
-- Run these while still inside the transaction. If anything looks wrong, run
-- ROLLBACK; instead of COMMIT; and nothing will have changed.

-- 5a. Nothing implausible left anywhere. Expect ZERO rows.
select type, slug, title, runtime_minutes
  from public.content_entries
 where runtime_minutes is null
    or runtime_minutes = 0
    or runtime_minutes > 200
 order by type, slug;

-- 5b. Distribution per type — eyeball for anything absurd.
select type,
       count(*)                as entries,
       min(runtime_minutes)    as min_min,
       round(avg(runtime_minutes))::int as avg_min,
       max(runtime_minutes)    as max_min
  from public.content_entries
 group by type
 order by type;

-- 5c. The number the user actually cares about: total library watch time.
select count(*) as entries,
       sum(runtime_minutes) as total_minutes,
       round(sum(runtime_minutes) / 60.0, 1) as total_hours
  from public.content_entries;

commit;
-- rollback;   -- <- use this instead if 5a/5b/5c look wrong

-- ═══ STEP 6 — DONE: hour and 2-hour episode specials ══════════════════
-- Applied in step 2a-b from the owner's curated special-episode tracker
-- (Detective_Conan_Extended_Specials_Tracker, sourced from DCW's "Anime
-- Specials" page and Wikipedia's per-season 1hr/2hr footnotes):
--   15 one-hour specials -> 46 min
--     (eps 11, 52, 76, 118, 208, 304, 356, 449, 487, 488, 490, 515, 557, 734,
--      916)
--    8 two-hour specials -> 92 min
--     (eps 96, 129, 174, 219, 263, 315, 342, 479)
--
-- Confirmed STANDARD length at 25 min, no action taken:
--   * the five Wild Police Story "special planning" episodes
--     (1029, 1038, 1042, 1061, 1133)
--   * every multi-part aired block (387-389, 425-426, 459-463, 965-968,
--     1000-1001, 1142-1143 incl. The Ranpo Mansion Murder Case) — consecutive
--     normal episodes, not extended ones.
--
-- Sanity check: exactly these 23 rows should sit above 25:
select episode_number, title, runtime_minutes
  from public.content_entries
 where type = 'episode'
   and runtime_minutes > 25
 order by episode_number;

-- ═══ STEP 7 — OPTIONAL: stop this recurring ═══════════════════════════
-- A CHECK constraint makes the class of bug impossible: any future import that
-- tries to write a source ID into this column fails loudly at insert time
-- instead of quietly inflating someone's watch time by 19 hours.
-- Run ONLY after step 5a returns zero rows, or it will fail.
-- NULL is still allowed so a new entry can be added before its runtime is known.
--
-- alter table public.content_entries
--   add constraint content_entries_runtime_minutes_plausible
--   check (runtime_minutes is null or (runtime_minutes > 0 and runtime_minutes <= 200));
--
-- Also worth fixing in supabase/seed.sql: its RUNTIMES section guards with
-- "WHERE runtime_minutes IS NULL OR = 0", which is precisely why the junk
-- values survived every re-seed. Widening each guard to
-- "OR runtime_minutes > <type ceiling>" makes a re-seed HEAL bad data instead
-- of preserving it.
