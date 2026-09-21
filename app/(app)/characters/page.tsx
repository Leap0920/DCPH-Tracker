import { CHARACTERS, RELATIONSHIPS } from "@/lib/characters-guide"
import CharactersExplorer from "@/components/characters/CharactersExplorer"

export const metadata = {
  title: "Characters & Red Strings · Detective Conan PH",
  description:
    "The red strings of fate between Detective Conan's cast — relationship types and details.",
}

export default function CharactersPage() {
  return (
    <div className="fixed inset-0 h-screen w-screen overflow-hidden bg-page z-0 pt-16 md:pt-0">
      {/* Full records, not the lightweight ones. The board's case file renders
          each character's role, aliases and bio, and each thread's detail, so
          stripping them would empty the dossier — the part of this design that
          replaces the old detail sheet. Measured cost: 53.8KB of props instead
          of 28.2KB, uncompressed. Portraits still come from
          `getCharacterImage(id)`, so `image` is not needed here. */}
      <CharactersExplorer characters={CHARACTERS} relationships={RELATIONSHIPS} />
    </div>
  )
}
