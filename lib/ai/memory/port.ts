/**
 * The memory port: the contract the long-term fact store implements.
 *
 * Types only, and deliberately so. Consolidation, the store's policy, decay
 * scoring and the async writer all depend on this interface and never on
 * PostgREST, so a test injects a recording fake through the same seam the
 * production adapter passes, and no test ever constructs a Supabase client
 * (constraint 10). Nothing in this file may import one.
 *
 * Every method takes `userId`, the same rule the transcript port states (D1):
 * a memory read without a user filter is a cross-user leak, and a remembered
 * fact is personal enough that the predicate belongs in the port's shape
 * rather than in each caller's discipline.
 *
 * Times are epoch ms on this side of the port; the adapter owns the conversion
 * to and from the database's timestamptz, exactly as the transcript adapter
 * does.
 */

import type { MemoryKind } from "@/lib/ai/memory/slots"

export interface MemoryFact {
  id: string
  userId: string
  kind: MemoryKind
  key: string
  value: string
  confidence: number
  status: "active" | "superseded" | "expired"
  supersededBy: string | null
  sourceMessageId: string | null
  evidenceCount: number
  lastConfirmedAt: number
  expiresAt: number | null
}

/** What a write supplies; the row's id, status and timestamps are the store's. */
export interface NewFact {
  userId: string
  kind: MemoryKind
  key: string
  value: string
  confidence: number
  sourceMessageId: string | null
  expiresAt: number | null
}

export interface MemoryPort {
  loadActive(userId: string): Promise<MemoryFact[]>
  countActive(userId: string): Promise<number>
  insert(userId: string, fact: NewFact, now: number): Promise<MemoryFact>
  update(
    userId: string,
    id: string,
    patch: { value?: string; confidence: number; evidenceCount: number; lastConfirmedAt: number },
    now: number
  ): Promise<void>
  supersede(userId: string, oldId: string, replacement: NewFact, now: number): Promise<MemoryFact>
  list(userId: string, limit: number): Promise<MemoryFact[]>
  delete(userId: string, id: string): Promise<boolean>
}
