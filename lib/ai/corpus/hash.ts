import { createHash } from "node:crypto"
import type { CorpusDocument } from "@/lib/ai/corpus/types"

/**
 * JSON with object keys sorted, so a metadata object assembled in a different
 * insertion order hashes identically. Without this every ingestion run would
 * rewrite every row and `content_hash` would buy nothing.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null"
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`
}

const HASHED_FIELDS = ["title", "body", "url", "metadata", "episodeNumber", "movieNumber", "aliases"] as const

export function contentHash(doc: Pick<CorpusDocument, (typeof HASHED_FIELDS)[number]>): string {
  const material = stableStringify({
    title: doc.title,
    body: doc.body,
    url: doc.url,
    metadata: doc.metadata,
    episodeNumber: doc.episodeNumber ?? null,
    movieNumber: doc.movieNumber ?? null,
    aliases: [...(doc.aliases ?? [])].sort(),
  })
  return createHash("sha256").update(material).digest("hex")
}
