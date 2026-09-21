/**
 * The request-log read side: a port, its Supabase adapter, and the policy layer
 * over them, in the shape lib/ai/feedback/store.ts establishes.
 *
 * `ai_request_log` has been write-only since Phase 1 -- lib/ai/request-log.ts
 * inserts a row per chat request and no layer has ever read one. This module is
 * the reader. Three properties shape it.
 *
 * Every read is bounded, and the bounds are constants declared here, never
 * parameters a caller can widen (constraint 4). The table gains a row per chat
 * request and has no retention before Task 5, so an unbounded read of it is a
 * denial-of-service on its own database -- the failure this module exists to
 * prevent. The policy layer clamps whatever it is handed, so a caller that asks
 * for a year gets MAX_WINDOW_MS and the summary it gets back names the window
 * that was actually read.
 *
 * PostgREST has no GROUP BY, so the categorical breakdown is computed here, from
 * rows the port read, rather than by a SQL aggregate the adapter cannot express.
 * That row read is capped at PERCENTILE_SAMPLE_CAP, which is why the exact
 * request count is a separate head count and the summary reports whether the
 * breakdown was sampled. A cap that silently dropped rows would make every count
 * below it a lie.
 *
 * `null` is a value, not a gap. A row written before the pipeline shipped has a
 * null `plan_source` and a null `citations_valid`; a request that degraded for
 * no reason has a null `degraded_reason`. Each lands in its own named bucket,
 * because "no degradation" is a count the operator needs and a dropped bucket is
 * an invisible one.
 *
 * Zero I/O of its own: the client is declared structurally and injected, so a
 * test records the calls the store made instead of constructing a real client
 * with the live service-role key.
 */

/**
 * The window a caller gets when it names no edge: one day. The operator's
 * default question is "what happened today", it matches the daily cron cadence,
 * and it keeps a default page render to one day of an indexed read.
 */
export const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * The widest window a caller can get: thirty days. The retention age (Task 5) is
 * ninety days, so this is a third of the history that can exist -- wide enough
 * to see a trend, narrow enough that the `(created_at desc)` index still does
 * the work. A wider window is a table scan wearing a date filter.
 */
export const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/**
 * The newest rows `recent` returns, and the default when a caller names none. It
 * is both the default and the ceiling on purpose: one constant means a caller
 * cannot ask for more rows than the operator page can show, and one that omits
 * the limit gets the whole page.
 */
export const RECENT_ROW_LIMIT = 200

/**
 * The rows a summary reads to build its breakdown and its percentiles. p50 and
 * p95 over the newest thousand values in a window move by less than the
 * run-to-run noise of a free-tier provider, so reading further buys a more
 * precise number for no better decision. The exact request count is a head
 * count, so capping the row read here loses nothing about how much traffic
 * there was -- only how finely it was classified, which the summary reports.
 */
export const PERCENTILE_SAMPLE_CAP = 1000

/**
 * The key a null `degraded_reason` or `plan_source` lands under. Neither column
 * can hold this text -- the writers emit "router"/"model"/"fallback" and the
 * degrade ladder -- so the bucket cannot collide with a real value.
 */
export const NULL_BUCKET = "none"

/**
 * The default retention age: ninety days. The log is the operator's window into
 * recent behaviour, not an archive; a quarter is long enough to see a slow
 * regression and short enough that the table stays a few million rows on a free
 * tier. `AI_LOG_RETENTION_DAYS` overrides it per deployment.
 */
export const DEFAULT_RETENTION_DAYS = 90

/**
 * The ids one delete batch names, and the size of the read that fills it.
 * PostgREST carries an `.in()` list in the query string, so 200 UUIDs (~7.4 kB)
 * stay inside the proxy URL limit while keeping one statement a short
 * transaction. Read and delete are the same size, so a batch is one read and one
 * delete with no partial batch left behind.
 */
export const RETENTION_BATCH_ROWS = 200

/**
 * The batches one invocation may run. Twenty batches bound a single sweep to
 * 4,000 rows: enough that a daily cron drains ordinary growth, small enough that
 * one request cannot hold a connection open deleting an unbounded backlog. When
 * the cap is reached the report says `exhausted: false`, so a partial sweep is
 * never presented as a complete one.
 */
export const RETENTION_MAX_BATCHES = 20

/**
 * The configured retention age, in days. An absent, unparseable, non-integer,
 * zero or negative value falls back to DEFAULT_RETENTION_DAYS — never to zero,
 * because a zero cutoff would delete the whole table. Only a plain positive
 * integer string is accepted; `""`, `"1.5"`, `"90d"` and `"-1"` are all refused,
 * and a value too large to be a safe integer is refused too rather than becoming
 * a cutoff outside the range `Date` can represent.
 */
export function retentionDays(): number {
  const raw = process.env.AI_LOG_RETENTION_DAYS
  if (raw === undefined) return DEFAULT_RETENTION_DAYS
  const text = raw.trim()
  if (!/^\d+$/.test(text)) return DEFAULT_RETENTION_DAYS
  const parsed = Number(text)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_RETENTION_DAYS
  return parsed
}

/** One row of `ai_request_log`, as the read side sees it. Times are epoch ms. */
export interface RequestLogRow {
  id: string
  createdAt: number
  outcome: string
  targetId: string | null
  planSource: string | null
  degradedReason: string | null
  planMs: number | null
  retrieveMs: number | null
  ttftMs: number | null
  totalMs: number | null
  docCount: number | null
  citationsValid: boolean | null
  /** `[]` means no tool ran; `null` means the column predates the pipeline. */
  tools: string[] | null
  promptTokens: number | null
  completionTokens: number | null
  userId: string | null
  conversationId: string | null
}

export interface RequestWindow {
  sinceMs: number
  untilMs: number
}

export interface RequestListQuery {
  /** Omitted by `recent`, which reads the newest rows regardless of age. */
  sinceMs?: number
  untilMs?: number
  limit: number
}

export interface FeedbackCountQuery extends RequestWindow {
  /** `1` for up, `-1` for down; omitted counts every vote. */
  value?: 1 | -1
  /** True narrows to the votes that carry a note. */
  hasNote?: boolean
}

/**
 * The oldest expired rows, bounded. `beforeMs` is exclusive — a row written
 * exactly on the cutoff survives — so the sweep and a re-run agree about which
 * rows are eligible. Unwindowed by design: the cutoff is the entire predicate,
 * and `limit` is the only bound (F2 — a windowed read would clamp the cutoff).
 */
export interface ExpiredIdQuery {
  beforeMs: number
  limit: number
}

export interface RetentionInput {
  /** Absent or `true` counts only; `false` performs the delete. */
  dryRun?: boolean
}

/**
 * What one sweep did. `exhausted` is the field that keeps a partial sweep from
 * being read as a complete one: `false` means the run stopped at
 * RETENTION_MAX_BATCHES (or, in a dry run, filled its one batch) with expired
 * rows still present.
 */
export interface RetentionReport {
  /** The age actually used, after the env fallback. */
  retentionDays: number
  /** Rows written before this instant are expired. Never clamped by MAX_WINDOW_MS. */
  cutoffMs: number
  dryRun: boolean
  /**
   * Rows deleted, or — in a dry run — the rows its one bounded batch found and
   * a real run would remove first.
   */
  removed: number
  /** Read/delete batches run. */
  batches: number
  /** False when expired rows remain because a bound was reached. */
  exhausted: boolean
}

export interface ObservabilityPort {
  /** Exact row count in the window: a head count, no rows transferred. */
  countRequests(window: RequestWindow): Promise<number>
  /** Newest-first rows in the window, or overall when no window is given. */
  listRequests(query: RequestListQuery): Promise<RequestLogRow[]>
  /** Exact vote count in the window, optionally narrowed to one value or to noted votes. */
  countFeedback(query: FeedbackCountQuery): Promise<number>
  /** The oldest ids older than the cutoff, ascending, bounded by `limit`. */
  listExpiredIds(query: ExpiredIdQuery): Promise<string[]>
  /** Deletes exactly these rows. A no-op for an empty list. */
  deleteRequests(ids: string[]): Promise<void>
}

export interface WindowInput {
  sinceMs?: number
  untilMs?: number
}

/**
 * A latency field's summary. `count` is the non-null samples the percentiles
 * were computed from, never the window's row count: a stage that did not run
 * (`retrieve_ms` on a v1 request) has no latency, and counting it as zero would
 * make the median of a window that never retrieved anything look fast.
 */
export interface LatencySummary {
  count: number
  /** Null when no row in the window carried this measurement. */
  p50: number | null
  p95: number | null
}

export interface CitationSummary {
  valid: number
  invalid: number
  /** `citations_valid is null`: a v1 request, which had no citations to check. */
  unmeasured: number
}

export interface WindowSummary {
  /** The window actually read, after clamping: the caller's answer, not its ask. */
  sinceMs: number
  untilMs: number
  /** Exact over the window; a head count. */
  requestCount: number
  /** Rows the breakdown and the latency below were computed from. */
  sampledRows: number
  /** True when the window held more rows than the sample cap. */
  sampled: boolean
  byOutcome: Record<string, number>
  /** A null reason is counted under NULL_BUCKET, not dropped. */
  byDegradedReason: Record<string, number>
  /** A null source (a v1 request) is counted under NULL_BUCKET, not dropped. */
  byPlanSource: Record<string, number>
  citations: CitationSummary
  latency: {
    retrieveMs: LatencySummary
    ttftMs: LatencySummary
    totalMs: LatencySummary
  }
}

export interface FeedbackSummary {
  sinceMs: number
  untilMs: number
  up: number
  down: number
  noted: number
}

export interface ObservabilityStore {
  summary(input?: WindowInput): Promise<WindowSummary>
  recent(input?: { limit?: number }): Promise<RequestLogRow[]>
  feedbackSummary(input?: WindowInput): Promise<FeedbackSummary>
  /** Deletes expired rows in bounded batches; dry by default. */
  retention(input?: RetentionInput): Promise<RetentionReport>
}

export interface ObservabilityStoreDeps {
  port: ObservabilityPort
  /**
   * Fills an omitted window edge. Injected so a test pins "now" instead of
   * reading a real clock, exactly as the memory and transcript ports take one.
   */
  now?: () => number
}

/**
 * The percentile of a numeric sample, by linear interpolation between the two
 * ranks the quantile falls between (`n - 1` spacing, the definition a stats
 * library uses). A nearest-rank definition would make p50 of an even sample
 * either the lower or the upper middle value depending on an off-by-one, which
 * is a difference a test cannot pin and an operator cannot reason about.
 *
 * The input is not sorted in place: the caller's array is its own data.
 */
export function percentile(values: number[], q: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.min(Math.max(q, 0), 1) * (sorted.length - 1)
  const low = Math.floor(rank)
  const high = Math.ceil(rank)
  if (low === high) return sorted[low]
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low)
}

function emptyLatency(): LatencySummary {
  return { count: 0, p50: null, p95: null }
}

function latencySummary(values: number[]): LatencySummary {
  return { count: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95) }
}

function pushNumber(target: number[], value: number | null): void {
  if (value !== null && Number.isFinite(value)) target.push(value)
}

function tally(buckets: Record<string, number>, key: string): void {
  buckets[key] = (buckets[key] ?? 0) + 1
}

function emptySummary(sinceMs: number, untilMs: number): WindowSummary {
  return {
    sinceMs,
    untilMs,
    requestCount: 0,
    sampledRows: 0,
    sampled: false,
    byOutcome: {},
    byDegradedReason: {},
    byPlanSource: {},
    citations: { valid: 0, invalid: 0, unmeasured: 0 },
    latency: { retrieveMs: emptyLatency(), ttftMs: emptyLatency(), totalMs: emptyLatency() },
  }
}

/**
 * The window the caller actually asked about, with both edges finite and the
 * width capped. An omitted edge falls back to the clock and to
 * DEFAULT_WINDOW_MS; the *older* edge is what moves when the width is capped,
 * because the caller asked about "up to `until`" and moving `until` would
 * silently answer a different question.
 */
function resolveWindow(input: WindowInput, now: number): RequestWindow {
  const rawUntil = input.untilMs
  const untilMs = rawUntil === undefined || !Number.isFinite(rawUntil) ? now : rawUntil
  const rawSince = input.sinceMs
  const sinceMs =
    rawSince === undefined || !Number.isFinite(rawSince) ? untilMs - DEFAULT_WINDOW_MS : rawSince
  return { sinceMs: Math.max(sinceMs, untilMs - MAX_WINDOW_MS), untilMs }
}

/**
 * The recent-row bound. A non-finite or absent limit is the default; a larger
 * one is the ceiling; a negative one is zero, which `recent` short-circuits
 * rather than turning into a query that returns nothing.
 */
function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return RECENT_ROW_LIMIT
  return Math.min(Math.max(Math.floor(limit), 0), RECENT_ROW_LIMIT)
}

/**
 * The policy layer. Every method resolves its window through `resolveWindow` and
 * its limit through `clampLimit`, so no caller can widen a bound, and a window
 * with no rows in it is answered without a round trip.
 */
export function createObservabilityStore(deps: ObservabilityStoreDeps): ObservabilityStore {
  const port = deps.port
  const clock = deps.now ?? Date.now

  return {
    async summary(input = {}) {
      const { sinceMs, untilMs } = resolveWindow(input, clock())
      // Nothing to read and nothing to aggregate: an empty window must not cost
      // two round trips (the `forMessages([])` precedent).
      if (sinceMs >= untilMs) return emptySummary(sinceMs, untilMs)

      // The two reads are independent, so they run together: the count is the
      // truth about volume and the rows are the sample the breakdown is built
      // from. The count is exact, so a capped sample cannot understate traffic.
      const [requestCount, rows] = await Promise.all([
        port.countRequests({ sinceMs, untilMs }),
        port.listRequests({ sinceMs, untilMs, limit: PERCENTILE_SAMPLE_CAP }),
      ])

      const byOutcome: Record<string, number> = {}
      const byDegradedReason: Record<string, number> = {}
      const byPlanSource: Record<string, number> = {}
      const citations: CitationSummary = { valid: 0, invalid: 0, unmeasured: 0 }
      const retrieveMs: number[] = []
      const ttftMs: number[] = []
      const totalMs: number[] = []

      for (const row of rows) {
        tally(byOutcome, row.outcome)
        tally(byDegradedReason, row.degradedReason ?? NULL_BUCKET)
        tally(byPlanSource, row.planSource ?? NULL_BUCKET)
        if (row.citationsValid === true) citations.valid += 1
        else if (row.citationsValid === false) citations.invalid += 1
        else citations.unmeasured += 1
        pushNumber(retrieveMs, row.retrieveMs)
        pushNumber(ttftMs, row.ttftMs)
        pushNumber(totalMs, row.totalMs)
      }

      return {
        sinceMs,
        untilMs,
        requestCount,
        sampledRows: rows.length,
        // Strictly less: a window that fit inside the cap was not sampled, and
        // saying otherwise would make every exact breakdown look approximate.
        sampled: rows.length < requestCount,
        byOutcome,
        byDegradedReason,
        byPlanSource,
        citations,
        latency: {
          retrieveMs: latencySummary(retrieveMs),
          ttftMs: latencySummary(ttftMs),
          totalMs: latencySummary(totalMs),
        },
      }
    },

    async recent(input = {}) {
      const limit = clampLimit(input.limit)
      if (limit <= 0) return []
      return port.listRequests({ limit })
    },

    async feedbackSummary(input = {}) {
      const { sinceMs, untilMs } = resolveWindow(input, clock())
      if (sinceMs >= untilMs) return { sinceMs, untilMs, up: 0, down: 0, noted: 0 }

      // Three head counts rather than a row read: the votes are exact answers
      // and the table is small, so there is nothing to sample here.
      const [up, down, noted] = await Promise.all([
        port.countFeedback({ sinceMs, untilMs, value: 1 }),
        port.countFeedback({ sinceMs, untilMs, value: -1 }),
        port.countFeedback({ sinceMs, untilMs, hasNote: true }),
      ])
      return { sinceMs, untilMs, up, down, noted }
    },

    async retention(input = {}) {
      const dryRun = input.dryRun !== false
      const days = retentionDays()
      // Deliberately NOT resolveWindow: it clamps every window to MAX_WINDOW_MS
      // (30 days), so a 90-day cutoff passed through it would silently become 30
      // and the sweep would look complete while leaving most of the expired
      // table behind (F2). The cutoff is its own arithmetic; the batch caps
      // below are what bound the run.
      const cutoffMs = clock() - days * MS_PER_DAY

      let removed = 0
      let batches = 0
      let exhausted = false

      while (batches < RETENTION_MAX_BATCHES) {
        const ids = await port.listExpiredIds({
          beforeMs: cutoffMs,
          limit: RETENTION_BATCH_ROWS,
        })
        // Nothing older than the cutoff remains: the sweep reached the end.
        if (ids.length === 0) {
          exhausted = true
          break
        }
        // A dry run cannot advance -- the next read would return the same ids --
        // so it stops after one bounded batch. A full batch means more expired
        // rows exist, which `exhausted: false` reports rather than hiding.
        if (dryRun) {
          removed = ids.length
          batches = 1
          exhausted = ids.length < RETENTION_BATCH_ROWS
          break
        }
        await port.deleteRequests(ids)
        removed += ids.length
        batches += 1
        // A short batch is the last one; a full batch may be followed by more,
        // and the loop's own cap decides when to stop.
        if (ids.length < RETENTION_BATCH_ROWS) {
          exhausted = true
          break
        }
      }

      return { retentionDays: days, cutoffMs, dryRun, removed, batches, exhausted }
    },
  }
}

export interface ObservabilityResult {
  data: Record<string, unknown>[] | null
  error: { message: string } | null
  /** PostgREST reports it only for a `count: "exact"` request. */
  count?: number | null
}

/**
 * PostgREST's builder is a thenable that also chains, so the structural type has
 * to be both -- the same shape `MemoryQuery` takes in
 * lib/ai/memory/supabase-port.ts. `not` is on the builder for the one predicate
 * SQL equality cannot express: `note is not null`, which `.neq` would turn into
 * a three-valued comparison that matches no row.
 */
export interface ObservabilityQuery extends PromiseLike<ObservabilityResult> {
  gte(column: string, value: string): ObservabilityQuery
  lt(column: string, value: string): ObservabilityQuery
  eq(column: string, value: string | number): ObservabilityQuery
  not(column: string, operator: string, value: unknown): ObservabilityQuery
  order(column: string, options: { ascending: boolean }): ObservabilityQuery
  limit(count: number): ObservabilityQuery
}

/**
 * The delete half of the builder. Deliberately narrow: the retention sweep
 * deletes by primary key and nothing else, so this exposes only the `.in()` it
 * uses rather than the whole filter surface the reads carry.
 */
export interface ObservabilityDeleteQuery extends PromiseLike<ObservabilityResult> {
  in(column: string, values: string[]): ObservabilityDeleteQuery
}

export interface ObservabilityClient {
  from(table: string): {
    select(columns: string, options?: { count: "exact"; head: boolean }): ObservabilityQuery
    delete(): ObservabilityDeleteQuery
  }
}

const LOG_TABLE = "ai_request_log"
const FEEDBACK_TABLE = "ai_message_feedback"

/** Milliseconds in a day, for the retention cutoff. */
const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Every column `recent` renders. `attempts` is deliberately absent: it is the
 * gateway's per-target trace (a jsonb array), the largest column in the row, and
 * the list shows the outcome and the degrade reason rather than replaying each
 * attempt.
 */
const LOG_COLUMNS =
  "id,created_at,outcome,target_id,plan_source,degraded_reason,plan_ms,retrieve_ms,ttft_ms,total_ms,doc_count,citations_valid,tools,prompt_tokens,completion_tokens,user_id,conversation_id"

/**
 * Epoch ms for a timestamptz column. PostgREST answers with ISO text; a number
 * or a `Date` is accepted as well so a driver change cannot silently produce
 * NaN, and an undatable value stays NaN rather than becoming 1970.
 */
function toEpochMs(value: unknown): number {
  if (typeof value === "number") return value
  if (value instanceof Date) return value.getTime()
  if (typeof value === "string") return Date.parse(value)
  return Number.NaN
}

function toIso(ms: number): string {
  return new Date(ms).toISOString()
}

/** `null` is a real value for every nullable column here, so it survives as null. */
function nullableString(value: unknown): string | null {
  return value == null ? null : String(value)
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function rowToRequestLogRow(row: Record<string, unknown>): RequestLogRow {
  return {
    id: String(row.id),
    createdAt: toEpochMs(row.created_at),
    outcome: String(row.outcome ?? ""),
    targetId: nullableString(row.target_id),
    planSource: nullableString(row.plan_source),
    degradedReason: nullableString(row.degraded_reason),
    planMs: nullableNumber(row.plan_ms),
    retrieveMs: nullableNumber(row.retrieve_ms),
    ttftMs: nullableNumber(row.ttft_ms),
    totalMs: nullableNumber(row.total_ms),
    docCount: nullableNumber(row.doc_count),
    // `== null` keeps a real `false` a false rather than reading it as
    // "not measured" (the request-log writer's own rule).
    citationsValid: row.citations_valid == null ? null : Boolean(row.citations_valid),
    tools: Array.isArray(row.tools) ? row.tools.map(String) : null,
    promptTokens: nullableNumber(row.prompt_tokens),
    completionTokens: nullableNumber(row.completion_tokens),
    userId: nullableString(row.user_id),
    conversationId: nullableString(row.conversation_id),
  }
}

/**
 * The database's own message, prefixed with the call that produced it: the
 * caller chooses how to degrade, but its log line has to say which query failed
 * (the `[ai-feedback]` precedent).
 */
function fail(method: string, message: string): never {
  throw new Error(`[ai-observability] ${method}: ${message}`)
}

export function createSupabaseObservabilityPort(
  client: ObservabilityClient
): ObservabilityPort {
  return {
    async countRequests(window) {
      // A head request: the operator needs the number, not the rows, and this
      // is the only read here that is exact over a window of any size.
      const { count, error } = await client
        .from(LOG_TABLE)
        .select("id", { count: "exact", head: true })
        .gte("created_at", toIso(window.sinceMs))
        .lt("created_at", toIso(window.untilMs))
      if (error) fail("countRequests", error.message)
      // A count PostgREST omits reads as zero, as in the memory port: NaN would
      // poison every comparison against it.
      return count ?? 0
    },

    async listRequests(query) {
      let builder = client.from(LOG_TABLE).select(LOG_COLUMNS)
      // A half-open interval [since, until): two adjacent windows must not both
      // claim the row written exactly on the boundary.
      if (query.sinceMs !== undefined) builder = builder.gte("created_at", toIso(query.sinceMs))
      if (query.untilMs !== undefined) builder = builder.lt("created_at", toIso(query.untilMs))
      const { data, error } = await builder
        .order("created_at", { ascending: false })
        .limit(query.limit)
      if (error) fail("listRequests", error.message)
      return (data ?? []).map(rowToRequestLogRow)
    },

    async countFeedback(query) {
      let builder = client
        .from(FEEDBACK_TABLE)
        .select("id", { count: "exact", head: true })
        .gte("created_at", toIso(query.sinceMs))
        .lt("created_at", toIso(query.untilMs))
      if (query.value !== undefined) builder = builder.eq("value", query.value)
      // `is not null`, not `neq null`: SQL's `<>` against null matches no row,
      // so the obvious filter would report every vote as un-noted.
      if (query.hasNote === true) builder = builder.not("note", "is", null)
      const { count, error } = await builder
      if (error) fail("countFeedback", error.message)
      return count ?? 0
    },

    async listExpiredIds(query) {
      // Oldest first, so the sweep always removes the rows closest to falling
      // off the end. Unwindowed by design: the cutoff is the whole predicate and
      // `limit` is the only bound (F2).
      const { data, error } = await client
        .from(LOG_TABLE)
        .select("id")
        .lt("created_at", toIso(query.beforeMs))
        .order("created_at", { ascending: true })
        .limit(query.limit)
      if (error) fail("listExpiredIds", error.message)
      return (data ?? []).map((row) => String(row.id))
    },

    async deleteRequests(ids) {
      // An empty `.in()` would be an invalid predicate; nothing to delete is not
      // a query, so it costs no round trip.
      if (ids.length === 0) return
      const { error } = await client.from(LOG_TABLE).delete().in("id", ids)
      if (error) fail("deleteRequests", error.message)
    },
  }
}
