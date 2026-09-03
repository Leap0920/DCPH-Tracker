import {
  getLightweightCharacters,
  getLightweightRelationships,
  RELATIONSHIP_META,
} from "@/lib/characters-guide"
import CharactersExplorer from "@/components/characters/CharactersExplorer"

export const metadata = {
  title: "Characters & Red Strings · Detective Conan PH",
  description:
    "The red strings of fate between Detective Conan's cast — relationship types and details.",
}

export default function CharactersPage() {
  return (
    <div className="fixed inset-0 h-screen w-screen overflow-hidden bg-page z-0 pt-16 md:pt-0">
      <CharactersExplorer
        characters={getLightweightCharacters()}
        relationships={getLightweightRelationships()}
        relationshipMeta={RELATIONSHIP_META}
      />
    </div>
  )
}
