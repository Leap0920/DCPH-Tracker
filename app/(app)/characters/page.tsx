import {
  CHARACTERS,
  RELATIONSHIPS,
  RELATIONSHIP_META,
} from "@/lib/characters-guide"
import CharactersExplorer from "@/components/characters/CharactersExplorer"

export const metadata = {
  title: "Characters & Red Strings · Detective Conan PH",
  description:
    "The red strings of fate between Detective Conan's cast — relationship types and details.",
}

export default async function CharactersPage() {
  return (
    <div className="fixed inset-0 h-screen w-screen overflow-hidden bg-page z-0">
      <CharactersExplorer
        characters={CHARACTERS}
        relationships={RELATIONSHIPS}
        relationshipMeta={RELATIONSHIP_META}
      />
    </div>
  )
}
