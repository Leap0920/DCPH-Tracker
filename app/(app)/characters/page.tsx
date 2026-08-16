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
    <div className="px-6 py-10">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <span className="case-number">FILE NO. 009 CHARACTERS</span>
          <span className="redacted-bar w-16" />
        </div>
        <h1 className="font-display text-3xl sm:text-4xl tracking-tight text-ink">
          Characters &amp; Red Strings
        </h1>
        <p className="mt-2 max-w-2xl text-ink-dim">
          The cast of Detective Conan and the red strings of fate that bind
          them — click any node to open a dossier and trace how each character
          is connected.
        </p>

        <CharactersExplorer
          characters={CHARACTERS}
          relationships={RELATIONSHIPS}
          relationshipMeta={RELATIONSHIP_META}
        />
      </div>
    </div>
  )
}
