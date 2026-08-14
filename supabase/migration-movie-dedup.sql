-- =============================================================================
-- Migration: Movie/Special/OVA Deduplication
-- DCPH-Tracker — run this in the Supabase Dashboard SQL Editor (one time).
--
-- ROOT CAUSE: syncSeedFranchise (app/api/sync/route.ts) assigns position-based
-- slugs (mov-01, mov-02, ...) from Kitsu's getFranchiseEntries() text search,
-- which returns the SAME film twice (duplicate rows, identical canonicalTitle,
-- e.g. JP + EN editions). Each duplicate got a different slug + canon_order,
-- so 17 duplicate movie rows exist (50 rows / 33 unique titles).
--
-- This migration deletes the duplicate rows, keeping the LOWEST canon_order
-- per (type, title) — which is the originally-seeded row and its slug
-- (e.g. "Detective Conan Movie 01" keeps mov-01/canon_order 1001, the mov-02
-- duplicate is removed).
--
-- IDEMPOTENT: safe to run multiple times; after the first run the DELETE
-- matches zero rows.
--
-- NOTE: specials (13) and OVAs (34) already have ZERO duplicates — the
-- (type, title) filter leaves them untouched. The 6 OTHER_MOVIE_SLUGS rows
-- (mov-19 Shark & Jewel, mov-22, mov-33, mov-37, mov-41, mov-46) are all
-- unique titles — also untouched.
-- =============================================================================

-- 1) Delete duplicates: for each (type, title) group, keep the row with the
--    lowest canon_order and remove the later-seeded copies.
DELETE FROM content_entries a
USING content_entries b
WHERE a.type IN ('movie', 'special', 'ova')
  AND a.type = b.type
  AND a.title = b.title
  AND a.canon_order > b.canon_order;

-- 2) Verification: any (type, title) group with more than one row = remaining dupes.
--    Expected result: ZERO rows.
SELECT type, title, COUNT(*) AS n
FROM content_entries
WHERE type IN ('movie', 'special', 'ova')
GROUP BY type, title
HAVING COUNT(*) > 1
ORDER BY type, title;

-- 3) Post-cleanup inventory: movie rows ordered by movie_number.
--    Expected: 33 rows, unique titles, no gaps checked (gaps are fine).
SELECT movie_number, slug, title
FROM content_entries
WHERE type = 'movie'
ORDER BY movie_number;
