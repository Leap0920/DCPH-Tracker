/**
 * The wiki half of an answer, read through the cache.
 *
 * A model's recollection of a wiki is a hallucination with a citation; these
 * extracts are the ones the cache actually fetched. The cache itself is the
 * only source here (it fetches on a miss), which keeps this module I/O-free and
 * testable with a fake.
 */
import type { WikiEvidence } from "@/lib/ai/retrieval/ladder"
import type { WikiCache } from "@/lib/ai/wiki-cache"

/**
 * Below this an extract is a stub — a title restated, or a lead sentence with
 * the subject cut off. Quoting one reads as a citation while saying nothing,
 * which is worse than having no wiki evidence at all.
 */
const MIN_EXTRACT_CHARS = 40

/** How many extracts an answer will actually use. */
const DEFAULT_LIMIT = 3

/** Cached wiki extracts for a topic, tidiest first. Never throws. */
export async function wikiLookup(
  topic: string,
  cache: WikiCache,
  limit = DEFAULT_LIMIT
): Promise<WikiEvidence[]> {
  const query = topic.trim()
  const take = Math.max(0, Math.floor(limit))
  // The cache keys on the topic, so a blank one would only burn a fetch on the
  // empty key and store a row nothing can ever hit.
  if (query === "" || take === 0) return []

  let evidence: WikiEvidence[]
  try {
    evidence = await cache.lookup(query)
  } catch {
    // A broken store costs freshness, not availability: the corpus alone can
    // still answer the question.
    return []
  }

  const seen = new Set<string>()
  const kept: WikiEvidence[] = []

  for (const item of evidence) {
    if (item.extract.trim().length < MIN_EXTRACT_CHARS) continue
    // DCW and Wikipedia often describe the same subject; the first extract
    // wins so the answer does not repeat itself.
    if (seen.has(item.url)) continue
    seen.add(item.url)
    kept.push(item)
    if (kept.length >= take) break
  }

  return kept
}
