/**
 * System owner protection — defense in depth.
 *
 * The DB triggers in migration-protect-system-owner.sql are the real
 * enforcement; these helpers exist to produce clean, user-facing errors
 * in the server actions before the DB layer is hit.
 */

import { createAdminClient } from "@/utils/supabase/admin"

export const OWNER_EMAIL = "carlobaclao789@gmail.com"

/**
 * Cached owner lookup. We cache the *promise* so concurrent callers share one
 * round-trip, and we clear it on failure so errors are never cached.
 */
let ownerUserIdPromise: Promise<string | null> | null = null

async function resolveOwnerUserId(): Promise<string | null> {
  if (!ownerUserIdPromise) {
    ownerUserIdPromise = (async () => {
      const admin = createAdminClient()
      if (!admin) return null
      // system_owner_id is defined in migration-protect-system-owner.sql
      // but not in the generated Supabase types — cast to bypass the typed RPC constraint.
      const { data, error } = await (admin as any).rpc("system_owner_id")
      if (error) throw new Error(`owner lookup failed: ${error.message}`)
      return (data as string | null) ?? null
    })().catch((err) => {
      ownerUserIdPromise = null // don't cache failures
      throw err
    })
  }
  return ownerUserIdPromise
}

export async function isSystemOwner(userId: string): Promise<boolean> {
  const ownerId = await resolveOwnerUserId()
  return !!ownerId && ownerId === userId
}

/**
 * Returns an error string if `userId` must not be moderated, else null.
 * Fails CLOSED: if the owner lookup breaks, moderation is refused.
 */
export async function ownerGuard(userId: string): Promise<string | null> {
  try {
    if (await isSystemOwner(userId)) {
      return "This account belongs to the system owner and cannot be modified."
    }
    return null
  } catch {
    return "Could not verify account protection status. Action refused."
  }
}
