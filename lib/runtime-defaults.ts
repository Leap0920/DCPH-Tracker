/**
 * Canonical fallback runtimes, in minutes, per content_entries.type.
 *
 * Single source of truth shared by the sync route and any future importer.
 * These MUST stay in step with supabase/seed.sql's RUNTIMES section and with
 * the runtime migrations under supabase/ — three copies of "25" that can drift
 * is how content_entries ended up with source IDs in a duration column.
 *
 * Why fallbacks exist at all: Jikan exposes no per-episode duration, so sync
 * used to insert NULL. Analytics SUMs this column, so NULL silently counts as
 * zero minutes and a user who watched 500 episodes showed ~0 watch time.
 *
 * These are STANDARD-LENGTH defaults. Episodes that occupy more than one
 * broadcast slot are not distinguishable from the sync payload; every known one
 * is corrected per episode number in
 * supabase/migration-fix-runtime-minutes-2.sql. One broadcast hour is 46 content
 * minutes (60 minus ads), 2 hours 92, 2.5 hours 115.
 *
 * live_action is the one type whose default does not describe its rows: the four
 * TV specials run 104-108 minutes and the 2011 series runs 40 per episode, all
 * set explicitly. 46 is left as the fallback for a new unknown special.
 */
export const DEFAULT_RUNTIME_MINUTES = {
  episode: 25,
  special: 46,
  ova: 25,
  movie: 110,
  live_action: 46,
  magic_kaito: 24,
  hanzawa: 10,
  zero_tea_time: 15,
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
