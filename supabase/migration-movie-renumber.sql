-- Migration: Canonical Detective Conan movie numbering (1-29) + Movie 28/29 inserts
-- Mirrors the REST fix applied via service-role key on 2026-08-14.
-- Background: movie_number was polluted (1,3,5,...,50) by earlier seeds. Official
-- movies are renumbered to canonical 1-27; non-mainline movies (Conan vs Kid
-- crossovers, Lupin III movie, Magician of Starlight, Manner, Scarlet Alibi) get
-- movie_number = NULL so the UI subcategory grouping can separate them; Movies
-- 28 & 29 are inserted (absent from Kitsu).

BEGIN;

-- 1) Renumber official movies to canonical order 1-27
UPDATE content_entries SET movie_number = 1  WHERE slug = 'mov-01';
UPDATE content_entries SET movie_number = 2  WHERE slug = 'mov-03';
UPDATE content_entries SET movie_number = 3  WHERE slug = 'mov-05';
UPDATE content_entries SET movie_number = 4  WHERE slug = 'mov-07';
UPDATE content_entries SET movie_number = 5  WHERE slug = 'mov-09';
UPDATE content_entries SET movie_number = 6  WHERE slug = 'mov-11';
UPDATE content_entries SET movie_number = 7  WHERE slug = 'mov-13';
UPDATE content_entries SET movie_number = 8  WHERE slug = 'mov-15';
UPDATE content_entries SET movie_number = 9  WHERE slug = 'mov-17';
UPDATE content_entries SET movie_number = 10 WHERE slug = 'mov-20';
UPDATE content_entries SET movie_number = 11 WHERE slug = 'mov-23';
UPDATE content_entries SET movie_number = 12 WHERE slug = 'mov-25';
UPDATE content_entries SET movie_number = 13 WHERE slug = 'mov-27';
UPDATE content_entries SET movie_number = 14 WHERE slug = 'mov-29';
UPDATE content_entries SET movie_number = 15 WHERE slug = 'mov-31';
UPDATE content_entries SET movie_number = 16 WHERE slug = 'mov-34';
UPDATE content_entries SET movie_number = 17 WHERE slug = 'mov-36';
UPDATE content_entries SET movie_number = 18 WHERE slug = 'mov-38';
UPDATE content_entries SET movie_number = 19 WHERE slug = 'mov-40';
UPDATE content_entries SET movie_number = 20 WHERE slug = 'mov-42';
UPDATE content_entries SET movie_number = 21 WHERE slug = 'mov-43';
UPDATE content_entries SET movie_number = 22 WHERE slug = 'mov-44';
UPDATE content_entries SET movie_number = 23 WHERE slug = 'mov-45';
UPDATE content_entries SET movie_number = 24 WHERE slug = 'mov-47';
UPDATE content_entries SET movie_number = 25 WHERE slug = 'mov-48';
UPDATE content_entries SET movie_number = 26 WHERE slug = 'mov-49';
UPDATE content_entries SET movie_number = 27 WHERE slug = 'mov-50';

-- 2) Non-mainline movies: clear movie_number so they sort outside Official 1-29
UPDATE content_entries
SET movie_number = NULL
WHERE slug IN ('mov-19','mov-22','mov-33','mov-37','mov-41','mov-46');

-- 3) Insert Movie 28 & 29 (not present in Kitsu, added manually)
INSERT INTO content_entries (slug, type, title, movie_number, air_date, canon_order, runtime_minutes)
VALUES ('mov-51', 'movie', 'Detective Conan: One-eyed Flashback', 28, '2025-04-18', 1051, 110)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO content_entries (slug, type, title, movie_number, air_date, canon_order, runtime_minutes)
VALUES ('mov-52', 'movie', 'Detective Conan: Fallen Angel of the Highway', 29, '2026-04-17', 1052, 110)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
