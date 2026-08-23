-- ============================================================================
-- Fix: Clear incorrect episode dcw_title values set by previous migration.
--
-- DCW pages are NOT titled "Episode 1", "Episode 2" etc. They use actual
-- titles like "Roller Coaster Murder Case". The previous migration set
-- dcw_title = 'Episode ' || episode_number which broke crime sync matching.
--
-- Run manually in the Supabase Dashboard SQL Editor. Idempotent.
-- ============================================================================

-- Clear the incorrect "Episode N" dcw_title values for episodes.
-- The crime sync will use normalized title matching against content_entries.title
-- to find the right entry.
UPDATE content_entries
SET dcw_title = NULL
WHERE type = 'episode'
  AND dcw_title = 'Episode ' || episode_number;

-- Verify: should return 0 rows after running
SELECT count(*) as still_wrong
FROM content_entries
WHERE type = 'episode'
  AND dcw_title = 'Episode ' || episode_number;
