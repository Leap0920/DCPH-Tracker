import { getLatestContent, type LatestEntry } from "@/lib/homepage-content"
import { LatestContentGrid } from "./LatestContentGrid"

export async function LatestContent({ entries }: { entries?: LatestEntry[] | null }) {
  const resolved = entries ?? (await getLatestContent())

  if (!resolved || resolved.length === 0) return null

  return <LatestContentGrid entries={resolved} />
}