/**
 * D6's memory kill switch, kept on its own.
 *
 * Deliberately import-free (no "server-only", no Supabase, no gateway): the
 * transparency route (app/api/ai-chat/memory/route.ts) has to report whether
 * memory is on, and reaching through `lib/chat/persistence.ts` for one boolean
 * would drag in the provider, health and quota graph behind it. The chat seam
 * re-exports both names, so its public surface is unchanged.
 */

/** The one value that means "memory is off" (D6). */
export const MEMORY_OFF = "off"

/**
 * D6's second kill switch: transcripts keep working, every memory read and the
 * memory write stop. Absence is not off — an unset variable is the normal
 * production state, and a kill switch that has to be written down is one that
 * gets forgotten.
 */
export function isMemoryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AI_MEMORY !== MEMORY_OFF
}
