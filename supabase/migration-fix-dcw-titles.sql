-- ============================================================================
-- Fix: Map tracker content_entries to correct DCW page titles.
--
-- The tracker uses Kitsu/Jikan titles (e.g. "Detective Conan Movie 01: The Timed
-- Skyscraper") but DCW uses different names (e.g. "The Time-Bombed Skyscraper").
-- This migration sets dcw_title to the correct DCW page name so the crime sync
-- can link entries properly.
--
-- Run manually in the Supabase Dashboard SQL Editor. Idempotent.
-- ============================================================================

-- ── MOVIES ──────────────────────────────────────────────────────────────────
-- DCW page title -> tracker movie_number mapping

UPDATE content_entries SET dcw_title = 'The Time-Bombed Skyscraper'
WHERE type = 'movie' AND movie_number = 1;

UPDATE content_entries SET dcw_title = 'The Fourteenth Target'
WHERE type = 'movie' AND movie_number = 2;

UPDATE content_entries SET dcw_title = 'The Last Wizard of the Century'
WHERE type = 'movie' AND movie_number = 3;

UPDATE content_entries SET dcw_title = 'Captured in Her Eyes'
WHERE type = 'movie' AND movie_number = 4;

UPDATE content_entries SET dcw_title = 'Countdown to Heaven'
WHERE type = 'movie' AND movie_number = 5;

UPDATE content_entries SET dcw_title = 'The Phantom of Baker Street'
WHERE type = 'movie' AND movie_number = 6;

UPDATE content_entries SET dcw_title = 'Crossroad in the Ancient Capital'
WHERE type = 'movie' AND movie_number = 7;

UPDATE content_entries SET dcw_title = 'Magician of the Silver Sky'
WHERE type = 'movie' AND movie_number = 8;

UPDATE content_entries SET dcw_title = 'Strategy Above the Depths'
WHERE type = 'movie' AND movie_number = 9;

UPDATE content_entries SET dcw_title = 'The Private Eyes'' Requiem'
WHERE type = 'movie' AND movie_number = 10;

UPDATE content_entries SET dcw_title = 'Jolly Roger in the Deep Azure'
WHERE type = 'movie' AND movie_number = 11;

UPDATE content_entries SET dcw_title = 'Full Score of Fear'
WHERE type = 'movie' AND movie_number = 12;

UPDATE content_entries SET dcw_title = 'The Raven Chaser'
WHERE type = 'movie' AND movie_number = 13;

UPDATE content_entries SET dcw_title = 'The Lost Ship in the Sky'
WHERE type = 'movie' AND movie_number = 14;

UPDATE content_entries SET dcw_title = 'Quarter of Silence'
WHERE type = 'movie' AND movie_number = 15;

UPDATE content_entries SET dcw_title = 'The Eleventh Striker'
WHERE type = 'movie' AND movie_number = 16;

UPDATE content_entries SET dcw_title = 'Private Eye in the Distant Sea'
WHERE type = 'movie' AND movie_number = 17;

UPDATE content_entries SET dcw_title = 'Dimensional Sniper'
WHERE type = 'movie' AND movie_number = 18;

UPDATE content_entries SET dcw_title = 'Sunflowers of Inferno'
WHERE type = 'movie' AND movie_number = 19;

UPDATE content_entries SET dcw_title = 'The Darkest Nightmare'
WHERE type = 'movie' AND movie_number = 20;

UPDATE content_entries SET dcw_title = 'The Crimson Love Letter'
WHERE type = 'movie' AND movie_number = 21;

UPDATE content_entries SET dcw_title = 'Zero the Enforcer'
WHERE type = 'movie' AND movie_number = 22;

UPDATE content_entries SET dcw_title = 'The Fist of Blue Sapphire'
WHERE type = 'movie' AND movie_number = 23;

UPDATE content_entries SET dcw_title = 'The Scarlet Bullet'
WHERE type = 'movie' AND movie_number = 24;

UPDATE content_entries SET dcw_title = 'The Bride of Halloween'
WHERE type = 'movie' AND movie_number = 25;

UPDATE content_entries SET dcw_title = 'Black Iron Submarine'
WHERE type = 'movie' AND movie_number = 26;

UPDATE content_entries SET dcw_title = 'The Million-dollar Pentagram'
WHERE type = 'movie' AND movie_number = 27;

UPDATE content_entries SET dcw_title = 'One-eyed Flashback'
WHERE type = 'movie' AND movie_number = 28;

UPDATE content_entries SET dcw_title = 'Fallen Angel of the Highway'
WHERE type = 'movie' AND movie_number = 29;

-- ── EPISODES ────────────────────────────────────────────────────────────────
-- For episodes, DCW uses "Episode {number}" as the page title.
-- The sync already handles this via dcw-episode.ts Tier 1b.
-- But we need to set dcw_title so the crime sync can link them.

UPDATE content_entries
SET dcw_title = 'Episode ' || episode_number
WHERE type = 'episode'
  AND dcw_title IS NULL
  AND episode_number IS NOT NULL;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Run these after applying:
--
-- SELECT type, count(*) as total,
--        count(dcw_title) as has_dcw_title,
--        count(*) - count(dcw_title) as missing_dcw_title
-- FROM content_entries
-- GROUP BY type
-- ORDER BY total DESC;
--
-- SELECT movie_number, title, dcw_title
-- FROM content_entries
-- WHERE type = 'movie'
-- ORDER BY movie_number;
