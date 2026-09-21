/**
 * Corpus assembly: every source, in one fixed order.
 *
 * Kept separate from the builders so the ingestion route, the eval fixture and
 * the ladder tests all assemble the corpus the same way -- and so the no-arg
 * call is a complete corpus rather than an empty one.
 */

import {
  buildArcDocs,
  buildCanonDoc,
  buildCharacterDocs,
  buildGadgetDocs,
  buildMovieDocs,
  buildRelationshipDocs,
  buildThreadDocs,
} from "@/lib/ai/corpus/curated"
import {
  buildCaseDocs,
  buildEntryDocs,
  type CaseRow,
  type ContentEntryRow,
} from "@/lib/ai/corpus/tracker"
import type { CorpusDocument } from "@/lib/ai/corpus/types"
import type { Character, Relationship } from "@/lib/characters-guide"
import type { RecurringThread, StoryArc } from "@/lib/arcs-guide"
import type { MainlineMovie } from "@/lib/movies-guide"

/**
 * What the caller has. Every field is optional, and a missing one means "use
 * the real curated source": that is what makes `buildCorpusDocuments()` the
 * full corpus while still letting a test swap a single source for a fixture.
 */
export interface CorpusInput {
  entries?: ContentEntryRow[]
  cases?: CaseRow[]
  characters?: Character[]
  relationships?: Relationship[]
  arcs?: StoryArc[]
  threads?: RecurringThread[]
  movies?: MainlineMovie[]
}

/** Every document the corpus holds, from every source. */
export function buildCorpusDocuments(input: CorpusInput = {}): CorpusDocument[] {
  const entries = input.entries ?? []
  const cases = input.cases ?? []

  const groups: CorpusDocument[][] = [
    buildEntryDocs(entries, cases),
    buildCaseDocs(cases),
    buildCharacterDocs(input.characters),
    buildRelationshipDocs(input.relationships, input.characters),
    buildArcDocs(input.arcs),
    buildThreadDocs(input.threads),
    buildCanonDoc(),
    buildMovieDocs(input.movies),
    buildGadgetDocs(),
  ]

  const seen = new Set<string>()
  const docs: CorpusDocument[] = []

  for (const group of groups) {
    // Sorted by id inside the group so the output -- and any hash taken over
    // it -- is stable regardless of the order a source handed its rows back.
    const sorted = [...group].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    for (const doc of sorted) {
      // Duplicate ids are a real hazard: ingestion upserts on the id, so a
      // collision would silently overwrite a document. First occurrence wins.
      if (seen.has(doc.id)) continue
      seen.add(doc.id)
      docs.push(doc)
    }
  }

  return docs
}
