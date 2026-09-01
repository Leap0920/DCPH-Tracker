import {
  getLightweightCharacters,
  getLightweightRelationships,
  RELATIONSHIP_META,
} from "@/lib/characters-guide"
import { getWatchedProgress } from "@/lib/queries/watched-progress"
import CharactersExplorer from "@/components/characters/CharactersExplorer"

export const metadata = {
  title: "Characters & Red Strings · Detective Conan PH",
  description:
    "The red strings of fate between Detective Conan's cast — relationship types and details, revealed as you watch.",
}

// Per-user gating: never serve a cached copy of one viewer's unlocked graph to
// another viewer.
export const dynamic = "force-dynamic"

export default async function CharactersPage() {
  const progress = await getWatchedProgress()

  return (
    <div className="fixed inset-0 h-screen w-screen overflow-hidden bg-page z-0 pt-16 md:pt-0">
      <CharactersExplorer
        characters={getLightweightCharacters()}
        relationships={getLightweightRelationships()}
        relationshipMeta={RELATIONSHIP_META}
        isSignedIn={progress.isSignedIn}
        watchedEpisodes={progress.watchedEpisodes}
        watchedMovies={progress.watchedMovies}
        highestEpisode={progress.highestEpisode}
      />
    </div>
  )
}
