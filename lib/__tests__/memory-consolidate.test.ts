/**
 * Consolidation is policy over the port: a pure decision and the IO that applies
 * it. `decide` is tested with no fake at all — its whole input is the candidate
 * and the row it collides with — while `consolidate` is tested against a
 * recording port, so the reads, the writes and their absence are assertions
 * rather than assumptions.
 *
 * The port is a hand-written fake (constraint 11): nothing here reaches a
 * network, a database or a real timer, and the clock is the injected `now`.
 */

import { describe, expect, it } from "vitest"
import type { MemoryCandidate } from "@/lib/ai/memory/extract"
import { CONFIDENCE_FLOOR } from "@/lib/ai/memory/extract"
import { MEMORY_KINDS, SLOT_KEYS } from "@/lib/ai/memory/slots"
import type { MemoryFact, MemoryPort, NewFact } from "@/lib/ai/memory/port"
import { MAX_ACTIVE_FACTS, createConsolidator, decide } from "@/lib/ai/memory/consolidate"

const NOW = Date.parse("2026-09-19T10:00:00.000Z")
const DAY_MS = 24 * 60 * 60 * 1000
const NINETY_DAYS = 90 * DAY_MS

function candidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return { kind: "preference", key: "favorite_character", value: "Haibara", confidence: 0.9, ...overrides }
}

function fact(overrides: Partial<MemoryFact> & { id: string }): MemoryFact {
  return {
    userId: "u1",
    kind: "preference",
    key: "favorite_character",
    value: "Haibara",
    confidence: 0.7,
    status: "active",
    supersededBy: null,
    sourceMessageId: null,
    evidenceCount: 1,
    lastConfirmedAt: NOW,
    expiresAt: null,
    ...overrides,
  }
}

type FactPatch = Parameters<MemoryPort["update"]>[2]

interface RecordedCall {
  method: keyof MemoryPort
  args: unknown[]
}

interface FakeMemoryPort {
  port: MemoryPort
  /** Every call the consolidator made, in order. */
  calls: RecordedCall[]
  callsOf(method: keyof MemoryPort): RecordedCall[]
  /** The fake's rows, so a test can see what a write actually did. */
  rows: MemoryFact[]
  inserts: { userId: string; fact: NewFact; now: number }[]
  updates: { userId: string; id: string; patch: FactPatch; now: number }[]
  supersedes: { userId: string; oldId: string; replacement: NewFact; now: number }[]
  /** Fails the method from its `occurrence`-th call on, to test isolation. */
  failFrom(method: keyof MemoryPort, error: Error, occurrence?: number): void
}

function memoryPort(rows: MemoryFact[] = []): FakeMemoryPort {
  const calls: RecordedCall[] = []
  const store = rows.map((row) => ({ ...row }))
  const inserts: FakeMemoryPort["inserts"] = []
  const updates: FakeMemoryPort["updates"] = []
  const supersedes: FakeMemoryPort["supersedes"] = []
  const seen = new Map<string, number>()
  let failure: { method: keyof MemoryPort; error: Error; occurrence: number } | null = null
  let nextId = store.length + 1

  const note = (method: keyof MemoryPort, args: unknown[]): void => {
    calls.push({ method, args })
    const occurrence = (seen.get(method) ?? 0) + 1
    seen.set(method, occurrence)
    if (failure !== null && failure.method === method && occurrence >= failure.occurrence) {
      throw failure.error
    }
  }

  const create = (userId: string, newFact: NewFact, now: number): MemoryFact => {
    const created: MemoryFact = {
      id: `new-${nextId++}`,
      userId,
      kind: newFact.kind,
      key: newFact.key,
      value: newFact.value,
      confidence: newFact.confidence,
      status: "active",
      supersededBy: null,
      sourceMessageId: newFact.sourceMessageId,
      evidenceCount: 1,
      lastConfirmedAt: now,
      expiresAt: newFact.expiresAt,
    }
    store.push(created)
    return created
  }

  const active = (userId: string): MemoryFact[] =>
    store.filter((row) => row.status === "active" && row.userId === userId)

  const port: MemoryPort = {
    async loadActive(userId) {
      note("loadActive", [userId])
      return active(userId).map((row) => ({ ...row }))
    },
    async countActive(userId) {
      note("countActive", [userId])
      return active(userId).length
    },
    async insert(userId, newFact, now) {
      note("insert", [userId, newFact, now])
      inserts.push({ userId, fact: newFact, now })
      return { ...create(userId, newFact, now) }
    },
    async update(userId, id, patch, now) {
      note("update", [userId, id, patch, now])
      updates.push({ userId, id, patch, now })
      const row = store.find((entry) => entry.id === id)
      if (row !== undefined) Object.assign(row, patch)
    },
    async supersede(userId, oldId, replacement, now) {
      note("supersede", [userId, oldId, replacement, now])
      supersedes.push({ userId, oldId, replacement, now })
      const created = create(userId, replacement, now)
      const old = store.find((entry) => entry.id === oldId)
      if (old !== undefined) {
        old.status = "superseded"
        old.supersededBy = created.id
      }
      return { ...created }
    },
    async list(userId, limit) {
      note("list", [userId, limit])
      return store.filter((row) => row.userId === userId).slice(0, limit).map((row) => ({ ...row }))
    },
    async delete(userId, id) {
      note("delete", [userId, id])
      return false
    },
  }

  return {
    port,
    calls,
    callsOf: (method) => calls.filter((call) => call.method === method),
    rows: store,
    inserts,
    updates,
    supersedes,
    failFrom: (method, error, occurrence = 1) => {
      failure = { method, error, occurrence }
    },
  }
}

function consolidator(fake: FakeMemoryPort, logs: string[] = []) {
  return createConsolidator({
    port: fake.port,
    now: () => NOW,
    log: (message) => logs.push(message),
  })
}

/** The four writes a candidate could cause; the assertion rule 4 turns on. */
const WRITES = ["insert", "update", "supersede", "delete"] as const

function writeCalls(fake: FakeMemoryPort): RecordedCall[] {
  return fake.calls.filter((call) => (WRITES as readonly string[]).includes(call.method))
}

describe("decide", () => {
  it("adds when the slot has no row", () => {
    expect(decide({ candidate: candidate(), existing: null })).toMatchObject({ action: "add" })
  })

  it("updates a restated fact, confirming it once more and nudging confidence up", () => {
    const decision = decide({
      candidate: candidate({ value: "Haibara", confidence: 0.9 }),
      existing: { value: "Haibara", confidence: 0.7, evidenceCount: 1 },
    })
    expect(decision.action).toBe("update")
    expect(decision.evidenceCount).toBe(2)
    expect(decision.confidence).toBe(0.95)
  })

  it("caps the confirmation bump at 0.95: a repeated fact is never certain", () => {
    const decision = decide({
      candidate: candidate({ confidence: 0.94 }),
      existing: { value: "Haibara", confidence: 0.94, evidenceCount: 4 },
    })
    expect(decision.confidence).toBe(0.95)
    expect(decision.evidenceCount).toBe(5)
  })

  it("keeps the stored confidence when the new telling is the less confident one", () => {
    // 0.8 survives the max(), then takes the bump: 0.85, not 0.6.
    const decision = decide({
      candidate: candidate({ confidence: 0.55 }),
      existing: { value: "Haibara", confidence: 0.8, evidenceCount: 3 },
    })
    expect(decision.confidence).toBeCloseTo(0.85, 10)
    expect(decision.evidenceCount).toBe(4)
  })

  it("compares values through normalizeText, so case and punctuation do not split a slot", () => {
    const decision = decide({
      candidate: candidate({ value: "  HAIBARA!  " }),
      existing: { value: "haibara", confidence: 0.7, evidenceCount: 1 },
    })
    expect(decision.action).toBe("update")
  })

  it("supersedes when the value changed", () => {
    const decision = decide({
      candidate: candidate({ value: "Ran" }),
      existing: { value: "Haibara", confidence: 0.9, evidenceCount: 2 },
    })
    expect(decision.action).toBe("supersede")
  })

  it("skips a candidate below the floor, which is overridable", () => {
    const weak = candidate({ confidence: 0.49 })
    expect(decide({ candidate: weak, existing: null }).action).toBe("noop")
    expect(decide({ candidate: weak, existing: null, floor: 0.4 }).action).toBe("add")
  })

  it("treats a candidate exactly at the floor as good enough", () => {
    expect(decide({ candidate: candidate({ confidence: CONFIDENCE_FLOOR }), existing: null }).action).toBe("add")
  })

  it("is pure: equal inputs give equal decisions, with no clock or state behind them", () => {
    const input = {
      candidate: candidate({ confidence: 0.62 }),
      existing: { value: "Haibara", confidence: 0.8, evidenceCount: 2 },
    }
    const first = decide({ ...input })
    const second = decide({ ...input })
    expect(second).toEqual(first)
    expect(decide({ ...input })).toEqual(first)
  })
})

describe("createConsolidator", () => {
  it("inserts a new slot with the source message and no expiry", async () => {
    const fake = memoryPort()
    const logs: string[] = []

    const report = await consolidator(fake, logs).consolidate({
      userId: "u1",
      candidates: [candidate()],
      sourceMessageId: "m9",
    })

    expect(report).toEqual({ added: 1, updated: 0, superseded: 0, skipped: 0 })
    expect(fake.inserts).toEqual([
      {
        userId: "u1",
        fact: {
          userId: "u1",
          kind: "preference",
          key: "favorite_character",
          value: "Haibara",
          confidence: 0.9,
          sourceMessageId: "m9",
          expiresAt: null,
        },
        now: NOW,
      },
    ])
    expect(logs).toEqual([])
  })

  it("confirms a restated fact in place, leaving the stored rendering of the value alone", async () => {
    const fake = memoryPort([fact({ id: "f1", value: "Haibara", confidence: 0.7, evidenceCount: 1 })])

    const report = await consolidator(fake).consolidate({
      userId: "u1",
      candidates: [candidate({ value: "haibara", confidence: 0.9 })],
      sourceMessageId: "m9",
    })

    expect(report).toEqual({ added: 0, updated: 1, superseded: 0, skipped: 0 })
    expect(fake.updates).toHaveLength(1)
    expect(fake.updates[0].userId).toBe("u1")
    expect(fake.updates[0].id).toBe("f1")
    expect(fake.updates[0].patch).toEqual({ confidence: 0.95, evidenceCount: 2, lastConfirmedAt: NOW })
    expect(fake.updates[0].patch.value).toBeUndefined()
    expect(fake.inserts).toHaveLength(0)
  })

  it("supersedes a changed value by marking the old row, never deleting it", async () => {
    const fake = memoryPort([fact({ id: "f1", value: "Haibara" })])

    const report = await consolidator(fake).consolidate({
      userId: "u1",
      candidates: [candidate({ value: "Ran" })],
      sourceMessageId: "m9",
    })

    expect(report).toEqual({ added: 0, updated: 0, superseded: 1, skipped: 0 })
    expect(fake.supersedes).toHaveLength(1)
    expect(fake.supersedes[0].oldId).toBe("f1")
    expect(fake.supersedes[0].replacement.value).toBe("Ran")
    expect(fake.inserts).toHaveLength(0)
    expect(fake.callsOf("delete")).toHaveLength(0)

    // Provenance survives: the old row is still there, pointing at its replacement.
    expect(fake.rows).toHaveLength(2)
    expect(fake.rows[0].status).toBe("superseded")
    expect(fake.rows[0].supersededBy).toBe(fake.rows[1].id)
    expect(fake.rows[1].status).toBe("active")
  })

  it("skips a below-floor candidate without writing anything", async () => {
    const fake = memoryPort()

    const report = await consolidator(fake).consolidate({
      userId: "u1",
      candidates: [candidate({ confidence: 0.4 })],
      sourceMessageId: null,
    })

    expect(report).toEqual({ added: 0, updated: 0, superseded: 0, skipped: 1 })
    expect(writeCalls(fake)).toEqual([])
  })

  it("expires a progress slot in 90 days and leaves every other slot without an expiry", async () => {
    const fake = memoryPort()

    await consolidator(fake).consolidate({
      userId: "u1",
      candidates: [
        candidate({ kind: "progress", key: "watch_progress", value: "episode 12", confidence: 0.8 }),
        candidate({ kind: "preference", key: "favorite_character", value: "Haibara", confidence: 0.9 }),
      ],
      sourceMessageId: null,
    })

    expect(fake.inserts).toHaveLength(2)
    expect(fake.inserts[0].fact.key).toBe("watch_progress")
    expect(fake.inserts[0].fact.expiresAt).toBe(NOW + NINETY_DAYS)
    expect(fake.inserts[1].fact.expiresAt).toBeNull()
  })

  it("skips a new slot at the cap, but still updates and supersedes", async () => {
    // Distinct (kind, key) per filler, so the index consolidation builds is the
    // one a real user at the cap would have.
    const filler = Array.from({ length: MAX_ACTIVE_FACTS - 2 }, (_, index) =>
      fact({
        id: `filler-${index}`,
        kind: MEMORY_KINDS[Math.floor(index / SLOT_KEYS.length)],
        key: SLOT_KEYS[index % SLOT_KEYS.length],
        value: `value ${index}`,
      })
    )
    const fake = memoryPort([
      ...filler,
      fact({ id: "f-char", kind: "constraint", key: "favorite_character", value: "Haibara" }),
      fact({ id: "f-arc", kind: "constraint", key: "favorite_arc", value: "Vermouth arc" }),
    ])
    const logs: string[] = []

    const report = await consolidator(fake, logs).consolidate({
      userId: "u1",
      candidates: [
        candidate({ kind: "constraint", key: "favorite_episode", value: "episode 5", confidence: 0.9 }),
        candidate({ kind: "constraint", key: "favorite_character", value: "Haibara", confidence: 0.9 }),
        candidate({ kind: "constraint", key: "favorite_arc", value: "Bourbon arc", confidence: 0.9 }),
      ],
      sourceMessageId: "m9",
    })

    expect(report).toEqual({ added: 0, updated: 1, superseded: 1, skipped: 1 })
    expect(fake.inserts).toHaveLength(0)
    expect(fake.updates[0].id).toBe("f-char")
    expect(fake.supersedes[0].oldId).toBe("f-arc")
    expect(logs.some((line) => line.includes("cap"))).toBe(true)

    // The cap is a batch property, so the count is read once for the whole batch.
    expect(fake.callsOf("countActive")).toHaveLength(1)
    expect(fake.callsOf("loadActive")).toHaveLength(1)
  })

  it("reads the active facts and their count once, not once per candidate", async () => {
    const fake = memoryPort()

    await consolidator(fake).consolidate({
      userId: "u1",
      candidates: [
        candidate({ key: "favorite_character" }),
        candidate({ key: "favorite_movie", value: "Movie 6" }),
        candidate({ kind: "progress", key: "watch_progress", value: "episode 12", confidence: 0.8 }),
      ],
      sourceMessageId: null,
    })

    expect(fake.callsOf("loadActive")).toHaveLength(1)
    expect(fake.callsOf("countActive")).toHaveLength(1)
    expect(fake.inserts).toHaveLength(3)
  })

  it("passes the source message through every write, including the superseding insert", async () => {
    const fake = memoryPort([fact({ id: "f1", value: "Haibara" })])

    await consolidator(fake).consolidate({
      userId: "u1",
      candidates: [
        candidate({ key: "favorite_movie", value: "Movie 6" }),
        candidate({ key: "favorite_character", value: "Ran" }),
      ],
      sourceMessageId: "m42",
    })

    expect(fake.inserts[0].fact.sourceMessageId).toBe("m42")
    expect(fake.supersedes[0].replacement.sourceMessageId).toBe("m42")
  })

  it("touches the port not at all for an empty batch", async () => {
    const fake = memoryPort()

    const report = await consolidator(fake).consolidate({ userId: "u1", candidates: [], sourceMessageId: null })

    expect(report).toEqual({ added: 0, updated: 0, superseded: 0, skipped: 0 })
    expect(fake.calls).toEqual([])
  })

  it("returns the counts accumulated before a port rejection, logging once, never throwing", async () => {
    const fake = memoryPort()
    fake.failFrom("insert", new Error("db down"), 2)
    const logs: string[] = []

    const report = await consolidator(fake, logs).consolidate({
      userId: "u1",
      candidates: [
        candidate({ key: "favorite_movie", value: "Movie 6" }),
        candidate({ key: "favorite_arc", value: "Vermouth arc" }),
        candidate({ key: "favorite_episode", value: "episode 5" }),
      ],
      sourceMessageId: null,
    })

    expect(report).toEqual({ added: 1, updated: 0, superseded: 0, skipped: 0 })
    expect(fake.inserts).toHaveLength(1)
    expect(logs).toHaveLength(1)
    expect(logs[0].startsWith("[ai-memory]")).toBe(true)
    expect(logs[0]).toContain("db down")
  })

  it("returns an all-zero report when the opening reads reject", async () => {
    const fake = memoryPort()
    fake.failFrom("loadActive", new Error("timeout"))
    const logs: string[] = []

    const report = await consolidator(fake, logs).consolidate({
      userId: "u1",
      candidates: [candidate()],
      sourceMessageId: "m9",
    })

    expect(report).toEqual({ added: 0, updated: 0, superseded: 0, skipped: 0 })
    expect(writeCalls(fake)).toEqual([])
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain("[ai-memory]")
  })
})
