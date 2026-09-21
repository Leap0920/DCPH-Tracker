/**
 * Case search: the crime-record half of the corpus.
 *
 * `dcw_cases` documents are keyed `case:<page_title>#<case_index>` and carry
 * the victim, suspects and cause of death that the tracker's own episode rows
 * do not. The pipeline is identical to `searchCatalog`'s — see
 * `search-catalog.ts` for why it lives there, why the fuzzy branch is part of
 * it, and why the source filter runs before the caller's `limit` — so this
 * module is only the filter that makes it a case search.
 */

import type { DocumentSource } from "@/lib/ai/retrieval/source"
import type { ScoredDoc } from "@/lib/ai/retrieval/candidates"
import { searchCorpus, type SearchToolOptions } from "@/lib/ai/tools/search-catalog"

export async function searchCases(
  query: string,
  source: DocumentSource,
  options: SearchToolOptions = {}
): Promise<ScoredDoc[]> {
  return searchCorpus(query, source, "dcw_cases", options)
}
