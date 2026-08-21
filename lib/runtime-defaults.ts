/**
 * Canonical fallback runtimes, in minutes, per content_entries.type.
 *
 * Single source of truth shared by the sync route and any future importer.
 * These MUST stay in step with supabase/seed.sql's RUNTIMES section and with
 * supabase/migration-fix-runtime-minutes.sql — three copies of "25" that can
 * drift is how content_entries ended up with source IDs in a duration column.
 *
 * Why fallbacks exist at all: Jikan exposes no per-episode duration, so sync
 * used to insert NULL. Analytics SUMs this column, so NULL silently counts as
 * zero minutes and a user who watched 500 episodes showed ~0 watch time.
 *
 * These are STANDARD-LENGTH defaults. Detective Conan's confirmed hour-long and
 * 2-hour specials (~46 and ~92 content minutes) are not distinguishable from the
 * sync payload; they are corrected per episode number in step 2a-b of
 * supabase/migration-fix-runtime-minutes.sql (23 entries, owner-curated list).
 */
export const DEFAULT_RUNTIME_MINUTES = {
  episode: 25,
  special: 46,
  ova: 25,
  movie: 110,
  live_action: 46,
  magic_kaito: 24,
  hanzawa: 2,
  zero_tea_time: 3,
} as const

/** Upper bound on a believable runtime. Anything above is an imported ID. */
export const MAX_PLAUSIBLE_RUNTIME_MINUTES = 200

/**
 * Fallback for a type, or 25 when the type is unknown. Never returns null:
 * a wrong-but-bounded runtime keeps analytics approximately right, whereas NULL
 * makes it silently and precisely wrong.
 */
export function defaultRuntimeMinutes(type: string): number {
  return (
    DEFAULT_RUNTIME_MINUTES[type as keyof typeof DEFAULT_RUNTIME_MINUTES] ?? 25
  )
}

/** True when a value is a usable runtime rather than a NULL, 0, or an ID. */
export function isPlausibleRuntime(value: number | null | undefined): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_PLAUSIBLE_RUNTIME_MINUTES
  )
}
