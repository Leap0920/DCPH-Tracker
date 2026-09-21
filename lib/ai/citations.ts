import type { EvidenceRef } from "@/lib/ai/pipeline/assemble"

/**
 * The citation contract: what the model was asked to write, and whether it did.
 *
 * The assembler numbers every admitted evidence block `[E1]`, `[E2]`, … and
 * `citationInstruction` asks the answer to cite the blocks it used. This module
 * is the other half: it parses the finished answer and checks the numbers
 * against the evidence that was actually supplied. The route (Task 12) calls
 * `validateCitations` after the stream completes, records `citations_valid` and
 * flags `degraded_reason: "uncited"` (D3, spec §8.4) — which is how retrieval
 * and grounding quality become measurable instead of anecdotal.
 *
 * Three properties the rest of Plan 4 reads:
 *
 * 1. **The answer is never rewritten.** `validateCitations` reads the text and
 *    returns a report; nothing here edits, strips or annotates a single
 *    character of the model's output. Phase 4 records, Phase 5 renders chips.
 *    Rewriting model output in the route would be a second, unreviewed
 *    generation step and would break the plain-text stream contract (D3).
 * 2. **Strictness is deliberate.** A lenient parser would validate citations
 *    the model did not actually make, so the grammar is narrow and the reject
 *    list is long. The grammar, in full:
 *
 *        citation := "[" "E" digit digit? "]"
 *        digit    := "1" | "2" | … | "9" | "0", but not as the first digit
 *
 *    and the brackets must be a single pair: the `[` may not be preceded by
 *    `[`, nor the `]` followed by `]`. `CITATION_PATTERN` matches it linearly —
 *    fixed-width look-around, no alternation, nothing to backtrack into.
 *
 *    Therefore these are **not** citations:
 *
 *        [E1, E2]  two ids in one bracket — the shape the instruction forbids
 *        [e1]      case matters; the marker is uppercase
 *        (E1)      parentheses are not brackets
 *        [E1 ]     nothing may sit between the digits and `]`
 *        [E0]      ids are 1-based, so zero was never supplied
 *        [E-1]     no sign — and `[E1.5]` is no decimal either
 *        [E123]    three digits: the grammar stops at two
 *        [[E1]]    a doubled bracket is someone else's syntax, not ours
 *
 *    `[E12]` when only five documents were supplied **is** a citation — syntax
 *    and resolution are separate stages, so it parses and then fails to resolve
 *    (it lands in `unknown`, it is not silently dropped).
 * 3. **Fenced code blocks are not special-cased.** The prompt forbids code, so
 *    fences are rare; a fence-aware pass would re-implement Markdown for no
 *    product gain, and a citation the model emitted is a citation whether or
 *    not it fenced it. `[E1]` inside a fence counts like any other.
 */

/**
 * The ids `citationInstruction` tells the model it may cite. Not a parse limit:
 * `CITATION_PATTERN` accepts two digits, and validation resolves against the
 * evidence actually supplied, whatever its size.
 */
export const MAX_CITATIONS = 12

/**
 * A whole `[E#]` bracket pair with a 1-based id of at most two digits. The
 * look-around is what keeps `[[E1]]` and `[E1]]` from matching halfway through.
 *
 * Global because callers scan a whole answer. A global regex carries
 * `lastIndex`, and `matchAll` copies it from the receiver, so a caller that ran
 * `exec`/`test` on this pattern first would otherwise shift the parse:
 * `parseCitations` resets it before scanning.
 */
export const CITATION_PATTERN = /(?<!\[)\[E([1-9]\d?)\](?!\])/g

/**
 * The numbers cited in `text`, unique, in first-appearance order.
 *
 * Syntax only — no evidence is consulted, so this never decides whether a
 * citation is real. That is `validateCitations`'s job, and keeping the two
 * stages apart is what lets `[E12]` be reported as `unknown` rather than
 * disappearing as a parse error.
 */
export function parseCitations(text: string): number[] {
  if (typeof text !== "string" || text.length === 0) return []

  const seen = new Set<number>()
  const cited: number[] = []

  // `matchAll` clones the pattern but inherits its `lastIndex`, so the shared
  // exported constant must be put back at the start before every scan.
  CITATION_PATTERN.lastIndex = 0
  for (const match of text.matchAll(CITATION_PATTERN)) {
    const n = Number(match[1])
    if (!seen.has(n)) {
      seen.add(n)
      cited.push(n)
    }
  }

  return cited
}

export interface CitationInput {
  /** The finished answer, exactly as it streamed. */
  text: string
  /** The ids the assembler supplied and numbered — the set a citation resolves against. */
  evidence: EvidenceRef[]
  /** Whether evidence was supplied at all, i.e. whether a citation was required. */
  requireCitation: boolean
}

export interface CitationReport {
  /** The supplied refs the answer cited, in the order the answer cited them. */
  cited: EvidenceRef[]
  /** Cited numbers with no matching supplied ref — fabricated ids. */
  unknown: number[]
  /** Every cited number resolved, and a citation exists whenever one was required. */
  valid: boolean
  /** Evidence was supplied and nothing valid was cited: the state flagged `degraded` (D3). */
  uncited: boolean
}

/**
 * Check an answer's citations against the evidence it was given.
 *
 * Two independent conditions make `valid`: nothing was fabricated (`unknown`
 * is empty) and a citation exists when one was required. `uncited` is narrower
 * than `!valid` on purpose — it is exactly "evidence was supplied and nothing
 * valid was cited", the case the route flags. An answer with nothing to cite
 * (a chit-chat turn) is neither invalid nor uncited; an answer that cites a
 * number it was never given is invalid *even then*, because `requireCitation:
 * false` forgives a missing citation, not a fabricated one.
 */
export function validateCitations(input: CitationInput): CitationReport {
  const evidence = Array.isArray(input.evidence) ? input.evidence : []
  const requireCitation = Boolean(input.requireCitation)

  // Assembly numbers densely from 1 and never repeats a number; the guards are
  // for a hand-built list, and the first ref supplied wins a duplicate.
  const byNumber = new Map<number, EvidenceRef>()
  for (const ref of evidence) {
    if (!ref || !Number.isInteger(ref.n)) continue
    if (!byNumber.has(ref.n)) byNumber.set(ref.n, ref)
  }

  const cited: EvidenceRef[] = []
  const unknown: number[] = []

  for (const n of parseCitations(input.text)) {
    const ref = byNumber.get(n)
    if (ref) cited.push(ref)
    else unknown.push(n)
  }

  return {
    cited,
    unknown,
    valid: unknown.length === 0 && (!requireCitation || cited.length > 0),
    uncited: requireCitation && cited.length === 0,
  }
}

/**
 * The prompt fragment that states the citation rule. It is the single source of
 * the syntax: Task 10 embeds the return value verbatim, so the instruction the
 * model reads and the parser that checks it cannot drift.
 *
 * It is deliberately short. Weak free-tier models follow a short instruction,
 * so it carries the accepted shape, the adjacent form, the "only what you used"
 * rule and the honest-gap rule — and nothing else.
 */
export function citationInstruction(max: number): string {
  const ceiling = Number.isFinite(max) && max >= 1 ? Math.floor(max) : MAX_CITATIONS
  return `Cite the evidence you actually used. Every evidence block is numbered \`[E1]\` through \`[E${ceiling}]\`, and a citation is that number in square brackets, written right after the claim it supports, like \`... [E2]\`. To cite two blocks write \`[E1][E2]\` — not \`[E1, E2]\` and not \`(E1)\`. Cite only the blocks you used, never every id, and never a number you were not given. If the evidence does not contain the answer, say so plainly instead of citing anything.`
}

/**
 * The visible citation marker, if any. Phase 4 renders none: the answer streams
 * to the browser as plain text and the chips are Phase 5's work (D3). This
 * function exists so the route has one named place for that marker to grow, and
 * the test pins the `null` so the absence is deliberate rather than forgotten.
 *
 * The report is accepted — and unused — so the call site does not change when
 * Phase 5 starts returning a string.
 */
export function citationSuffix(_report: CitationReport): string | null {
  return null
}
