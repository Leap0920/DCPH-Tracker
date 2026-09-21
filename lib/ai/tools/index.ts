/**
 * The tool registry: one dispatch table, one runner.
 *
 * Every entry is a structured probe of the corpus or the tracker, never a model
 * guess, and the runner's contract is what the answer assembler (Plan 4) builds
 * on: every request runs in parallel, the results stay in request order, and
 * the call cannot reject. A failure travels as `{ ok: false, error }` so a
 * broken tool degrades one citation instead of failing the whole request.
 */
import type { CorpusDocument } from "@/lib/ai/corpus/types"
import type { DocumentSource } from "@/lib/ai/retrieval/source"
import type { WikiCache } from "@/lib/ai/wiki-cache"
import { arcForRange } from "@/lib/ai/tools/arc-for-range"
import { classifyEpisode } from "@/lib/ai/tools/classify-episode"
import { lookupCharacter } from "@/lib/ai/tools/lookup-character"
import { nextUnwatched, type WatchClient } from "@/lib/ai/tools/next-unwatched"
import { searchCatalog } from "@/lib/ai/tools/search-catalog"
import { searchCases } from "@/lib/ai/tools/search-cases"
import {
  searchConversations,
  type ConversationSearchContext,
} from "@/lib/ai/tools/search-conversations"
import { wikiLookup } from "@/lib/ai/tools/wiki-lookup"

export const TOOL_NAMES = [
  "search_catalog",
  "search_cases",
  "lookup_character",
  "classify_episode",
  "arc_for_range",
  "next_unwatched",
  "wiki_lookup",
  "search_conversations",
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

export interface ToolContext {
  source: DocumentSource
  wiki: WikiCache
  /** Required by next_unwatched only. */
  watch?: { client: WatchClient; userId: string }
  /** Required by search_conversations only. */
  conversations?: ConversationSearchContext
}

export interface ToolRequest {
  name: ToolName
  args: Record<string, unknown>
}

export interface ToolResult {
  name: ToolName
  ok: boolean
  ms: number
  /** Corpus documents the tool used, for the citation contract. */
  docs: CorpusDocument[]
  /** Structured payload for the assembler; never handed to the model raw. */
  data: unknown
  error: string | null
}

/**
 * What a handler produces: the documents the citation contract may cite, and
 * the payload for the assembler. A failure is a value, not a throw — expected
 * failures (a missing argument, no watch client) are answers about the request.
 */
type ToolOutcome =
  | { ok: true; docs: CorpusDocument[]; data: unknown }
  | { ok: false; error: string }

type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext
) => Promise<ToolOutcome>

/** A validated argument, or the failed result the handler returns verbatim. */
type ArgResult<T> = { ok: true; value: T } | { ok: false; error: string }

function readString(
  tool: ToolName,
  args: Record<string, unknown>,
  key: string
): ArgResult<string> {
  const value = args[key]
  // A blank string is a missing argument in a different coat: "look up '   '"
  // is a caller bug, not a request for the empty name.
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: `${tool}: "${key}" must be a non-empty string` }
  }
  return { ok: true, value }
}

function readNumber(
  tool: ToolName,
  args: Record<string, unknown>,
  key: string
): ArgResult<number> {
  const value = args[key]
  // No coercion: `Number("five")` is NaN and `Number(null)` is 0, so a cast
  // would answer a different question than the caller asked.
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, error: `${tool}: "${key}" must be a finite number` }
  }
  return { ok: true, value }
}

function readOptionalNumber(
  tool: ToolName,
  args: Record<string, unknown>,
  key: string
): ArgResult<number | undefined> {
  if (args[key] === undefined) return { ok: true, value: undefined }
  return readNumber(tool, args, key)
}

/** The character's own document leads; six neighbours follow at most. */
const MAX_RELATED_CHARACTER_DOCS = 6

async function runSearchCatalog(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolOutcome> {
  const query = readString("search_catalog", args, "query")
  if (!query.ok) return query
  const limit = readOptionalNumber("search_catalog", args, "limit")
  if (!limit.ok) return limit

  const hits = await searchCatalog(query.value, ctx.source, { limit: limit.value })

  return {
    ok: true,
    docs: hits.map((hit) => hit.doc),
    data: hits.map((hit) => ({ id: hit.doc.id, score: hit.score })),
  }
}

async function runSearchCases(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolOutcome> {
  const query = readString("search_cases", args, "query")
  if (!query.ok) return query
  const limit = readOptionalNumber("search_cases", args, "limit")
  if (!limit.ok) return limit

  const hits = await searchCases(query.value, ctx.source, { limit: limit.value })

  return {
    ok: true,
    docs: hits.map((hit) => hit.doc),
    data: hits.map((hit) => ({ id: hit.doc.id, score: hit.score })),
  }
}

async function runLookupCharacter(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolOutcome> {
  const name = readString("lookup_character", args, "name")
  if (!name.ok) return name

  const found = lookupCharacter(name.value)
  // Nobody by that name is an empty answer, not a failure: `data: null` reads
  // as "the tool ran and found no one", while `ok: false` would read as "the
  // lookup is broken". No document was used, so nothing is cited.
  if (!found) return { ok: true, docs: [], data: null }

  const related = new Set<string>()
  for (const relationship of found.relationships) related.add(`character:${relationship.otherId}`)
  related.delete(found.docId)

  // The neighbours come along so a relationship can be cited, capped so one
  // well-connected character cannot turn a lookup into a corpus dump.
  const ids = [found.docId, ...[...related].slice(0, MAX_RELATED_CHARACTER_DOCS)]

  return { ok: true, docs: await ctx.source.fetch(ids), data: found }
}

async function runClassifyEpisode(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolOutcome> {
  const episode = readNumber("classify_episode", args, "episode")
  if (!episode.ok) return episode

  const classification = classifyEpisode(episode.value)
  // The canon guide is the document behind the classification; the overlapping
  // arcs come along so the answer can cite what made it an arc episode.
  const ids = ["guide:canon", ...classification.arcs.map((arc) => `arc:${arc.slug}`)]

  return { ok: true, docs: await ctx.source.fetch(ids), data: classification }
}

async function runArcForRange(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolOutcome> {
  const start = readNumber("arc_for_range", args, "start")
  if (!start.ok) return start
  const end = readOptionalNumber("arc_for_range", args, "end")
  if (!end.ok) return end

  const overlaps = arcForRange(start.value, end.value)

  return {
    ok: true,
    docs: await ctx.source.fetch(overlaps.map((arc) => `arc:${arc.slug}`)),
    data: overlaps,
  }
}

async function runNextUnwatched(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolOutcome> {
  const limit = readOptionalNumber("next_unwatched", args, "limit")
  if (!limit.ok) return limit

  const watch = ctx.watch
  if (!watch) {
    return { ok: false, error: "next_unwatched: no watch client in the tool context" }
  }

  // The watch list is not a corpus document, so there is nothing to cite.
  return { ok: true, docs: [], data: await nextUnwatched(watch.client, watch.userId, limit.value) }
}

async function runWikiLookup(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolOutcome> {
  const topic = readString("wiki_lookup", args, "topic")
  if (!topic.ok) return topic
  const limit = readOptionalNumber("wiki_lookup", args, "limit")
  if (!limit.ok) return limit

  // A wiki extract is evidence, not a corpus document: the id set is closed and
  // the assembler cites these by url.
  return { ok: true, docs: [], data: await wikiLookup(topic.value, ctx.wiki, limit.value) }
}

async function runSearchConversations(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolOutcome> {
  const query = readString("search_conversations", args, "query")
  if (!query.ok) return query
  const limit = readOptionalNumber("search_conversations", args, "limit")
  if (!limit.ok) return limit

  const conversations = ctx.conversations
  // An unconfigured tool is a failure, not an empty history: `ok: false` shows
  // up in the execution report, while a silent `[]` would hide the wiring bug
  // for the life of the feature.
  if (!conversations) return { ok: false, error: "conversations_unavailable" }

  const hits = await searchConversations(query.value, conversations, limit.value)

  // The documents travel for the citation contract; the payload is the id list
  // because every score is 0 by construction and repeating zeros says nothing.
  return {
    ok: true,
    docs: hits.map((hit) => hit.doc),
    data: hits.map((hit) => hit.doc.id),
  }
}

/** Every name in TOOL_NAMES has a handler; the Record type is what enforces it. */
const HANDLERS: Record<ToolName, ToolHandler> = {
  search_catalog: runSearchCatalog,
  search_cases: runSearchCases,
  lookup_character: runLookupCharacter,
  classify_episode: runClassifyEpisode,
  arc_for_range: runArcForRange,
  next_unwatched: runNextUnwatched,
  wiki_lookup: runWikiLookup,
  search_conversations: runSearchConversations,
}

function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && (TOOL_NAMES as readonly string[]).includes(value)
}

/** One request, one result. Every path here returns a result; none throws. */
async function runOne(request: ToolRequest, ctx: ToolContext): Promise<ToolResult> {
  const started = Date.now()
  const name = request.name

  const failed = (error: string): ToolResult => ({
    name,
    ok: false,
    ms: Date.now() - started,
    docs: [],
    data: null,
    error,
  })

  if (!isToolName(name)) return failed(`unknown tool "${String(name)}"`)

  try {
    const outcome = await HANDLERS[name](request.args ?? {}, ctx)
    if (!outcome.ok) return failed(outcome.error)

    return {
      name,
      ok: true,
      ms: Date.now() - started,
      docs: outcome.docs,
      data: outcome.data,
      error: null,
    }
  } catch (err) {
    // A tool that throws is a failed result, not a rejected run: the assembler
    // can still answer from the tools that worked.
    return failed(err instanceof Error ? err.message : String(err))
  }
}

/**
 * Runs every request and returns one result per request, in request order.
 *
 * `Promise.all` is safe precisely because `runOne` cannot reject; the array is
 * always complete, so the caller can index into it by request index.
 */
export async function runTools(requests: ToolRequest[], ctx: ToolContext): Promise<ToolResult[]> {
  return Promise.all(requests.map((request) => runOne(request, ctx)))
}
