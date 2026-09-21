/*
  TEMPORARY comparison route — not part of the product.

  Renders the SVG graph implementation exactly as it shipped before the
  Case Board port, so the two can be measured on the same machine, browser and
  data in one sitting. It exists only to produce the numbers in the PR and is
  deleted with `components/characters/BaselineExplorer.tsx` once they are
  recorded.
*/

import {
  getLightweightCharacters,
  getLightweightRelationships,
  RELATIONSHIP_META,
} from "@/lib/characters-guide"
import BaselineExplorer from "@/components/characters/BaselineExplorer"

export const metadata = {
  title: "Characters baseline (measurement only)",
}

export default function CharactersBaselinePage() {
  return (
    <div className="fixed inset-0 h-screen w-screen overflow-hidden bg-page z-0 pt-16 md:pt-0">
      <BaselineExplorer
        characters={getLightweightCharacters()}
        relationships={getLightweightRelationships()}
        relationshipMeta={RELATIONSHIP_META}
      />
    </div>
  )
}
