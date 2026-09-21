import { describe, expect, it } from "vitest"
import { CANON_TYPE_LABELS, MAX_EPISODE, canonTypeForEpisode } from "@/lib/canon-guide"
import { STORY_ARCS, type StoryArc } from "@/lib/arcs-guide"
import type { TranscriptPort, TranscriptTurn } from "@/lib/ai/conversations/port"
import type { CorpusDocument } from "@/lib/ai/corpus/types"
import type { WikiEvidence } from "@/lib/ai/retrieval/ladder"
import { createStaticSource, type DocumentSource } from "@/lib/ai/retrieval/source"
import type { WikiCache } from "@/lib/ai/wiki-cache"
import type { ArcOverlap } from "@/lib/ai/tools/arc-for-range"
import type { EpisodeClassification } from "@/lib/ai/tools/classify-episode"
import type { CharacterLookup } from "@/lib/ai/tools/lookup-character"
import {
  nextUnwatched,
  type NextUnwatchedItem,
  type WatchClient,
  type WatchResult,
} from "@/lib/ai/tools/next-unwatched"
import { wikiLookup } from "@/lib/ai/tools/wiki-lookup"
import {
  TOOL_NAMES,
  runTools,
  type ToolContext,
  type ToolName,
  type ToolRequest,
} from "@/lib/ai/tools"

/**
 * The tool registry's contract with the answer assembler (Plan 4).
 *
 * Three rules these tests pin, none of them visible from any single tool:
 *
 * 1. `runTools` never rejects and never reorders. Every request gets a result,
 *    in request order, and a failure is a result with `ok: false` — a rejection
 *    here would surface as a 500 in the route that asked for an answer.
 * 2. The citation contract travels with the result. A tool that quotes corpus
 *    data hydrates the documents it used through `ctx.source.fetch`, so the
 *    assembler has ids to cite; a tool whose answer is not a corpus document
 *    (wiki extracts, the watch list) returns `docs: []` honestly instead of
 *    padding the list.
 * 3. Arguments are validated, never coerced. `{ episode: "five" }` is a caller
 *    bug, and `Number("five")` would only turn it into a different bug.
 */

const USER_ID = "user-1"

/** The arcs overlapping one episode, derived from STORY_ARCS rather than a slug list. */
function overlappingArcs(episode: number): StoryArc[] {
  return [...STORY_ARCS]
    .sort((a, b) => a.order - b.order)
    .filter((arc) => arc.episodeStart <= episode && (arc.episodeEnd ?? MAX_EPISODE) >= episode)
}

/** Small mixed corpus: one catalog entry, one case, one character, the canon guide. */
const FIXTURE: CorpusDocument[] = [
  {
    id: "entry:ep-001",
    source: "content_entries",
    title: "Roller Coaster Murder Case",
    body: "A murder on a roller coaster at Tropical Land.",
    url: "/tracker/ep-001",
    metadata: { air_date: "1996-01-08" },
    episodeNumber: 1,
  },
  {
    id: "case:roller-coaster-murder-case#0",
    source: "dcw_cases",
    title: "Roller Coaster Murder Case",
    body: "Victim: Kishida. The victim was killed on the roller coaster.",
    url: "/cases/roller-coaster-murder-case",
    metadata: { page_title: "Roller Coaster Murder Case", victim: "Kishida", case_index: 0 },
  },
  {
    id: "character:ai-haibara",
    source: "characters",
    title: "Ai Haibara",
    body: "A former Black Organization chemist who also answers to Sherry.",
    url: "/characters/ai-haibara",
    metadata: {},
    aliases: ["sherry", "shiho"],
  },
  {
    id: "guide:canon",
    source: "canon",
    title: "Canon, filler and anime-original episodes",
    body: `Tracked range: episodes 1-${MAX_EPISODE}.`,
    url: "/tracker",
    metadata: { kind: "canon_guide" },
  },
  ...overlappingArcs(1).map(
    (arc): CorpusDocument => ({
      id: `arc:${arc.slug}`,
      source: "arcs",
      title: arc.title,
      body: arc.summary,
      url: `/arcs/${arc.slug}`,
      metadata: { slug: arc.slug },
    })
  ),
]

const WIKI_EVIDENCE: WikiEvidence[] = [
  {
    title: "Conan Edogawa",
    url: "https://detectiveconanworld.com/wiki/Conan_Edogawa",
    extract:
      "Conan Edogawa is the protagonist of Detective Conan, a high school detective shrunk by APTX 4869.",
    source: "dcw",
  },
]

interface RecordingSource {
  source: DocumentSource
  /** One entry per fetch call: the ids the tool asked to hydrate, in order. */
  fetches: string[][]
}

/** A static source that records what each tool asked it to hydrate. */
function recordingSource(docs: CorpusDocument[]): RecordingSource {
  const base = createStaticSource(docs)
  const fetches: string[][] = []

  return {
    fetches,
    source: {
      ...base,
      async fetch(ids) {
        fetches.push([...ids])
        return base.fetch(ids)
      },
    },
  }
}

function fakeWikiCache(evidence: WikiEvidence[]): { cache: WikiCache; lookups: string[] } {
  const lookups: string[] = []

  return {
    lookups,
    cache: {
      async lookup(query) {
        lookups.push(query)
        return evidence
      },
      async put() {},
    },
  }
}

/** One hit is enough: this file asserts dispatch, not search quality. */
const CONVERSATION_TURNS: TranscriptTurn[] = [
  {
    id: "msg-1",
    role: "assistant",
    content: "We settled on episode 500.",
    createdAt: Date.parse("2026-09-19T10:00:00.000Z"),
    conversationId: "conv-1",
  },
]

/**
 * The transcript port as far as the registry is concerned: one canned search,
 * empty answers everywhere else. The tool's own contract (the ownership id, the
 * body cap, the rejection path) is pinned in ai-tools-conversations.test.ts.
 */
function fakeTranscriptPort(turns: TranscriptTurn[]): TranscriptPort {
  return {
    async conversationOwnedBy() {
      return null
    },
    async recentConversation() {
      return null
    },
    async createConversation() {
      throw new Error("the registry never creates a conversation")
    },
    async updateConversation() {},
    async lastMessages() {
      return []
    },
    async messagesRange() {
      return []
    },
    async appendMessages() {},
    async listConversations() {
      return []
    },
    async searchMessages() {
      return turns
    },
  }
}

interface FakeWatchOptions {
  watched?: Record<string, unknown>[]
  episodes?: Record<string, unknown>[]
  watchError?: { message: string } | null
  entryError?: { message: string } | null
}

interface FakeWatch {
  client: WatchClient
  /** Every limit() the episode read was asked for, in call order. */
  entryLimits: number[]
  /** Every select() column list, in call order. */
  selects: string[]
  /** Every order() the episode read applied, as [column, ascending]. */
  orders: Array<[string, boolean]>
}

/**
 * A stand-in for PostgREST: filters by the `eq` it is given, sorts by the
 * `order` it is given, and slices to the `limit` — which is what makes the
 * episodes fixture's shuffle a real test of canon order rather than of the
 * order the rows happen to be written in.
 */
function fakeWatchClient(options: FakeWatchOptions = {}): FakeWatch {
  const watched = options.watched ?? []
  const episodes = options.episodes ?? []
  const entryLimits: number[] = []
  const selects: string[] = []
  const orders: Array<[string, boolean]> = []

  /** PostgREST's builder: awaited directly (`eq`) or chained (`order().limit()`). */
  function query(result: WatchResult) {
    const promise = Promise.resolve(result)
    return Object.assign(promise, {
      order: () => ({ limit: () => promise }),
    })
  }

  const client: WatchClient = {
    from(table) {
      return {
        select(columns) {
          selects.push(columns)
          return {
            eq(column, value) {
              if (table === "watch_status") {
                return query({
                  data: options.watchError
                    ? null
                    : watched.filter((row) => row[column] === value),
                  error: options.watchError ?? null,
                })
              }

              return Object.assign(Promise.resolve<WatchResult>({ data: null, error: null }), {
                order(orderColumn: string, orderOptions: { ascending: boolean }) {
                  orders.push([orderColumn, orderOptions.ascending])
                  return {
                    limit(count: number) {
                      entryLimits.push(count)
                      const data = options.entryError
                        ? null
                        : episodes
                            .filter((row) => row[column] === value)
                            .sort((a, b) => {
                              const left = Number(a[orderColumn])
                              const right = Number(b[orderColumn])
                              return orderOptions.ascending ? left - right : right - left
                            })
                            .slice(0, count)
                      return Promise.resolve<WatchResult>({
                        data,
                        error: options.entryError ?? null,
                      })
                    },
                  }
                },
              })
            },
          }
        },
      }
    },
  }

  return { client, entryLimits, selects, orders }
}

/** Deliberately out of canon order, with a movie row the episodes read must drop. */
const EPISODES: Record<string, unknown>[] = [
  {
    id: "e3",
    slug: "ep-003",
    title: "Episode Three",
    type: "episode",
    episode_number: 3,
    air_date: "1996-01-22",
    canon_order: 30,
  },
  {
    id: "e1",
    slug: "ep-001",
    title: "Roller Coaster Murder Case",
    type: "episode",
    episode_number: 1,
    air_date: "1996-01-08",
    canon_order: 10,
  },
  {
    id: "m1",
    slug: "movie-001",
    title: "The Time-Bombed Skyscraper",
    type: "movie",
    episode_number: null,
    air_date: "1997-04-19",
    canon_order: 15,
  },
  {
    id: "e2",
    slug: "ep-002",
    title: "Episode Two",
    type: "episode",
    episode_number: 2,
    air_date: "1996-01-15",
    canon_order: 20,
  },
]

const EPISODE_ROWS_COLUMNS = "id, slug, title, type, episode_number, air_date"

interface Harness {
  ctx: ToolContext
  fetches: string[][]
  lookups: string[]
}

/** A context whose every dependency is a fake; `watch: null` omits the watch client. */
function harness(
  options: { docs?: CorpusDocument[]; evidence?: WikiEvidence[]; watch?: WatchClient | null } = {}
): Harness {
  const recording = recordingSource(options.docs ?? FIXTURE)
  const wiki = fakeWikiCache(options.evidence ?? WIKI_EVIDENCE)
  const ctx: ToolContext = { source: recording.source, wiki: wiki.cache }

  const watch = options.watch === undefined ? fakeWatchClient().client : options.watch
  if (watch) ctx.watch = { client: watch, userId: USER_ID }

  // Configured by default, so the sweep over TOOL_NAMES dispatches every name;
  // the unconfigured case is the failure the other file pins.
  ctx.conversations = { port: fakeTranscriptPort(CONVERSATION_TURNS), userId: USER_ID }

  return { ctx, fetches: recording.fetches, lookups: wiki.lookups }
}

/** A request for a name a test knows is real; the cast is only for the bogus one. */
function request(name: string, args: Record<string, unknown>): ToolRequest {
  return { name: name as ToolName, args }
}

const ARGS: Record<ToolName, Record<string, unknown>> = {
  search_catalog: { query: "roller coaster" },
  search_cases: { query: "kishida" },
  lookup_character: { name: "ai-haibara" },
  classify_episode: { episode: 500 },
  arc_for_range: { start: 1, end: 5 },
  next_unwatched: { limit: 3 },
  wiki_lookup: { topic: "Conan Edogawa" },
  search_conversations: { query: "episode 500" },
}

describe("wikiLookup", () => {
  const dcw: WikiEvidence = {
    title: "Conan Edogawa",
    url: "https://detectiveconanworld.com/wiki/Conan_Edogawa",
    extract:
      "Conan Edogawa is the protagonist of Detective Conan, a high school detective shrunk by APTX 4869.",
    source: "dcw",
  }
  const wikipedia: WikiEvidence = {
    title: "Detective Conan",
    url: "https://en.wikipedia.org/wiki/Detective_Conan",
    extract:
      "Detective Conan is a Japanese manga series written and illustrated by Gosho Aoyama since 1994.",
    source: "wikipedia",
  }
  const third: WikiEvidence = {
    title: "Shinichi Kudo",
    url: "https://detectiveconanworld.com/wiki/Shinichi_Kudo",
    extract:
      "Shinichi Kudo is a high school detective who solves cases while hiding behind Conan's identity.",
    source: "dcw",
  }

  it("returns the cache's extracts in the order the cache gave them", async () => {
    const { cache } = fakeWikiCache([dcw, wikipedia, third])
    expect(await wikiLookup("Conan Edogawa", cache)).toEqual([dcw, wikipedia, third])
  })

  it("drops extracts shorter than 40 characters", async () => {
    // A stub extract is a title restated; quoting it reads as a citation while
    // saying nothing, which is worse than having no wiki evidence at all.
    const stub: WikiEvidence = { ...dcw, title: "Stub", extract: "Conan Edogawa.", url: "u1" }
    const { cache } = fakeWikiCache([stub, dcw])

    expect(await wikiLookup("Conan", cache)).toEqual([dcw])
  })

  it("de-duplicates by url", async () => {
    const duplicate: WikiEvidence = { ...dcw, title: "Conan again", source: "wikipedia" }
    const { cache } = fakeWikiCache([dcw, duplicate, wikipedia])

    expect(await wikiLookup("Conan", cache)).toEqual([dcw, wikipedia])
  })

  it("keeps the first `limit` extracts that survived filtering", async () => {
    const stub: WikiEvidence = { ...dcw, url: "u1", extract: "Short." }
    const { cache } = fakeWikiCache([stub, dcw, wikipedia, third])

    expect(await wikiLookup("Conan", cache, 2)).toEqual([dcw, wikipedia])
  })

  it("returns [] for a blank topic without touching the cache", async () => {
    const { cache, lookups } = fakeWikiCache([dcw])

    expect(await wikiLookup("", cache)).toEqual([])
    expect(await wikiLookup("   ", cache)).toEqual([])
    // The cache keys on the topic, so an empty one would only burn a fetch on
    // the empty key and write a row nothing can ever hit.
    expect(lookups).toEqual([])
  })

  it("resolves to [] when the cache rejects", async () => {
    const cache: WikiCache = {
      async lookup() {
        throw new Error("wiki store is down")
      },
      async put() {},
    }

    expect(await wikiLookup("Conan Edogawa", cache)).toEqual([])
  })
})

describe("nextUnwatched", () => {
  it("returns the first unwatched episodes in canon order", async () => {
    const watch = fakeWatchClient({
      // A second user's row proves the read is scoped to the user asking.
      watched: [
        { user_id: USER_ID, content_id: "e1" },
        { user_id: "someone-else", content_id: "e3" },
      ],
      episodes: EPISODES,
    })

    const result = await nextUnwatched(watch.client, USER_ID, 2)

    expect(result).toEqual([
      {
        id: "e2",
        slug: "ep-002",
        title: "Episode Two",
        episodeNumber: 2,
        airDate: "1996-01-15",
      },
      {
        id: "e3",
        slug: "ep-003",
        title: "Episode Three",
        episodeNumber: 3,
        airDate: "1996-01-22",
      },
    ])
    // The movie row is in the fixture and must not be offered as "next episode".
    expect(result.some((item) => item.id === "m1")).toBe(false)
    expect(watch.selects).toContain("content_id")
    expect(watch.selects).toContain(EPISODE_ROWS_COLUMNS)
    expect(watch.orders).toEqual([["canon_order", true]])
  })

  it("widens the read when the head of canon order is already watched", async () => {
    const episodes = Array.from({ length: 600 }, (_, index) => ({
      id: `e${index}`,
      slug: `ep-${index}`,
      title: `Episode ${index}`,
      type: "episode",
      episode_number: index,
      air_date: null,
      canon_order: index,
    }))
    const watched = episodes
      .slice(0, 550)
      .map((row) => ({ user_id: USER_ID, content_id: row.id }))
    const watch = fakeWatchClient({ watched, episodes })

    const result = await nextUnwatched(watch.client, USER_ID, 5)

    // 500 rows were not enough — all watched — so the window had to grow.
    expect(watch.entryLimits).toEqual([500, 1000])
    expect(result.map((item) => item.id)).toEqual(["e550", "e551", "e552", "e553", "e554"])
  })

  it("stops after three pages", async () => {
    const episodes = Array.from({ length: 1600 }, (_, index) => ({
      id: `e${index}`,
      slug: `ep-${index}`,
      title: `Episode ${index}`,
      type: "episode",
      episode_number: index,
      air_date: null,
      canon_order: index,
    }))
    const watch = fakeWatchClient({
      watched: episodes.map((row) => ({ user_id: USER_ID, content_id: row.id })),
      episodes,
    })

    expect(await nextUnwatched(watch.client, USER_ID, 5)).toEqual([])
    // Unwatched episodes past 1,500 rows are not reachable by design: the read
    // is bounded so one very-behind user cannot scan the whole catalog.
    expect(watch.entryLimits).toEqual([500, 1000, 1500])
  })

  it("reads nothing for a zero limit", async () => {
    const watch = fakeWatchClient({ episodes: EPISODES })

    expect(await nextUnwatched(watch.client, USER_ID, 0)).toEqual([])
    expect(watch.entryLimits).toEqual([])
    expect(watch.selects).toEqual([])
  })

  it("resolves to [] when the watch read fails", async () => {
    const watch = fakeWatchClient({
      episodes: EPISODES,
      watchError: { message: "watch_status unavailable" },
    })

    await expect(nextUnwatched(watch.client, USER_ID)).resolves.toEqual([])
    expect(watch.entryLimits).toEqual([])
  })

  it("resolves to [] when the episode read fails", async () => {
    const watch = fakeWatchClient({ episodes: EPISODES, entryError: { message: "no such table" } })

    await expect(nextUnwatched(watch.client, USER_ID)).resolves.toEqual([])
  })

  it("resolves to [] when the client itself throws", async () => {
    const client: WatchClient = {
      from() {
        throw new Error("connection reset")
      },
    }

    await expect(nextUnwatched(client, USER_ID)).resolves.toEqual([])
  })
})

describe("TOOL_NAMES", () => {
  it("registers exactly the eight tools", () => {
    expect(TOOL_NAMES).toHaveLength(8)
    expect([...TOOL_NAMES]).toEqual([
      "search_catalog",
      "search_cases",
      "lookup_character",
      "classify_episode",
      "arc_for_range",
      "next_unwatched",
      "wiki_lookup",
      "search_conversations",
    ])
  })
})

describe("runTools", () => {
  it("dispatches every registered name without an unknown-tool error", async () => {
    const { ctx } = harness()

    const results = await runTools(
      TOOL_NAMES.map((name) => request(name, ARGS[name])),
      ctx
    )

    expect(results.map((result) => result.name)).toEqual([...TOOL_NAMES])
    for (const result of results) {
      expect(result.error ?? "", result.name).not.toMatch(/unknown tool/i)
      expect(result.ok, `${result.name}: ${result.error}`).toBe(true)
      expect(result.ms).toBeGreaterThanOrEqual(0)
    }
  })

  it("returns the catalog hits as ids with scores", async () => {
    const { ctx } = harness()

    const [result] = await runTools([request("search_catalog", ARGS.search_catalog)], ctx)

    expect(result.ok).toBe(true)
    expect(result.docs.map((doc) => doc.id)).toEqual(["entry:ep-001"])
    expect(result.data).toEqual([{ id: "entry:ep-001", score: expect.any(Number) }])
    expect(result.error).toBeNull()
  })

  it("returns the case hits as ids with scores", async () => {
    const { ctx } = harness()

    const [result] = await runTools([request("search_cases", ARGS.search_cases)], ctx)

    expect(result.ok).toBe(true)
    expect(result.docs.map((doc) => doc.id)).toEqual(["case:roller-coaster-murder-case#0"])
    expect(result.data).toEqual([
      { id: "case:roller-coaster-murder-case#0", score: expect.any(Number) },
    ])
  })

  it("returns the character lookup and hydrates its corpus document", async () => {
    const { ctx, fetches } = harness()

    const [result] = await runTools([request("lookup_character", ARGS.lookup_character)], ctx)

    expect(result.ok).toBe(true)
    expect(result.docs.map((doc) => doc.id)).toEqual(["character:ai-haibara"])

    const lookup = result.data as CharacterLookup
    expect(lookup.character.id).toBe("ai-haibara")
    expect(lookup.docId).toBe("character:ai-haibara")
    expect(lookup.relationships.length).toBeGreaterThan(0)

    // The neighbours come along so a relationship can be cited, capped at six
    // so one well-connected character cannot turn a lookup into a corpus dump.
    const related = new Set(lookup.relationships.map((entry) => `character:${entry.otherId}`))
    related.delete(lookup.docId)
    expect(fetches[0][0]).toBe("character:ai-haibara")
    expect(fetches[0]).toHaveLength(1 + Math.min(6, related.size))
    for (const id of fetches[0].slice(1)) expect(id).toMatch(/^character:/)
  })

  it("classifies an episode and cites guide:canon", async () => {
    const { ctx, fetches } = harness()

    const [result] = await runTools([request("classify_episode", { episode: 500 })], ctx)

    expect(result.ok).toBe(true)
    const classification = result.data as EpisodeClassification
    expect(classification.episode).toBe(500)
    // Derived from the guide, not hardcoded: the label is the tool's own
    // vocabulary and must not drift from lib/canon-guide.
    const canonType = canonTypeForEpisode(500) as keyof typeof CANON_TYPE_LABELS
    expect(classification.canonLabel).toBe(CANON_TYPE_LABELS[canonType])
    expect(result.docs.map((doc) => doc.id)).toContain("guide:canon")
    expect(fetches[0]).toEqual([
      "guide:canon",
      ...classification.arcs.map((arc) => `arc:${arc.slug}`),
    ])
  })

  it("returns the arcs overlapping a range and hydrates them", async () => {
    const { ctx, fetches } = harness()

    const [result] = await runTools([request("arc_for_range", { start: 1, end: 5 })], ctx)

    expect(result.ok).toBe(true)
    expect(Array.isArray(result.data)).toBe(true)
    const arcs = result.data as ArcOverlap[]
    expect(arcs.length).toBeGreaterThan(0)
    expect(fetches[0]).toEqual(arcs.map((arc) => `arc:${arc.slug}`))
    // Every requested arc that the fixture carries comes back as a citable doc.
    expect(result.docs.map((doc) => doc.id)).toEqual(
      FIXTURE.filter((doc) => fetches[0].includes(doc.id)).map((doc) => doc.id)
    )
  })

  it("returns the next unwatched episodes with no documents to cite", async () => {
    const watch = fakeWatchClient({
      watched: [{ user_id: USER_ID, content_id: "e1" }],
      episodes: EPISODES,
    })
    const { ctx } = harness({ watch: watch.client })

    const [result] = await runTools([request("next_unwatched", { limit: 2 })], ctx)

    expect(result.ok).toBe(true)
    expect(result.docs).toEqual([])
    const items = result.data as NextUnwatchedItem[]
    expect(items.map((item) => item.slug)).toEqual(["ep-002", "ep-003"])
  })

  it("returns the wiki extracts with no documents to cite", async () => {
    const { ctx, lookups } = harness()

    const [result] = await runTools([request("wiki_lookup", ARGS.wiki_lookup)], ctx)

    expect(result.ok).toBe(true)
    expect(result.docs).toEqual([])
    expect(result.data).toEqual(WIKI_EVIDENCE)
    expect(lookups).toEqual(["Conan Edogawa"])
  })

  it("fails next_unwatched without a watch client", async () => {
    const { ctx } = harness({ watch: null })

    const [result] = await runTools([request("next_unwatched", {})], ctx)

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/next_unwatched/)
    expect(result.docs).toEqual([])
    expect(result.data).toBeNull()
  })

  it("fails an unknown tool name without touching the rest of the batch", async () => {
    const { ctx } = harness()

    const results = await runTools(
      [request("not_a_tool", {}), request("classify_episode", { episode: 1 })],
      ctx
    )

    expect(results[0].ok).toBe(false)
    expect(results[0].error).toContain("not_a_tool")
    expect(results[0].docs).toEqual([])
    expect(results[1].ok).toBe(true)
  })

  it("fails a mistyped argument instead of coercing it", async () => {
    const { ctx } = harness()

    const [result] = await runTools([request("classify_episode", { episode: "five" })], ctx)

    expect(result.ok).toBe(false)
    expect(result.error).toContain("classify_episode")
    expect(result.error).toContain("episode")
    expect(result.data).toBeNull()
    expect(result.ms).toBeGreaterThanOrEqual(0)
  })

  it("fails a missing argument and names the tool and the argument", async () => {
    const { ctx } = harness()

    const [result] = await runTools([request("search_catalog", {})], ctx)

    expect(result.ok).toBe(false)
    expect(result.error).toContain("search_catalog")
    expect(result.error).toContain("query")
  })

  it("turns a rejecting source into a failed result, not a rejection", async () => {
    const broken: DocumentSource = {
      ...createStaticSource(FIXTURE),
      async fetch() {
        throw new Error("hydration unavailable")
      },
    }
    const ctx: ToolContext = { source: broken, wiki: fakeWikiCache(WIKI_EVIDENCE).cache }

    const results = await runTools(
      [request("lookup_character", ARGS.lookup_character), request("arc_for_range", { start: 1 })],
      ctx
    )

    for (const result of results) {
      expect(result.ok).toBe(false)
      expect(result.error).toBe("hydration unavailable")
      expect(result.ms).toBeGreaterThanOrEqual(0)
    }
  })

  it("keeps request order when a later tool settles first", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const base = createStaticSource(FIXTURE)
    const ctx: ToolContext = {
      source: {
        ...base,
        async fetch(ids) {
          await gate
          return base.fetch(ids)
        },
      },
      wiki: fakeWikiCache(WIKI_EVIDENCE).cache,
    }

    const pending = runTools(
      [request("arc_for_range", { start: 1 }), request("wiki_lookup", ARGS.wiki_lookup)],
      ctx
    )
    // The wiki lookup never touches the source, so it finishes while the arc
    // tool is still parked on the gate.
    await new Promise((resolve) => setTimeout(resolve, 0))
    release()
    const results = await pending

    expect(results.map((result) => result.name)).toEqual(["arc_for_range", "wiki_lookup"])
    expect(results[0].ok).toBe(true)
    expect(results[1].ok).toBe(true)
    expect(results[1].data).toEqual(WIKI_EVIDENCE)
  })
})
