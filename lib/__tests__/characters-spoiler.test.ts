import { describe, expect, it } from "vitest"
import {
  characterVisibility,
  buildWatchProgress,
  EMPTY_PROGRESS,
} from "@/lib/characters-spoiler"

describe("characterVisibility — tracker-gated spoiler tiers", () => {
  it("shows the episode-1 cast to a signed-in viewer with zero progress (pilot is the entry point)", () => {
    const progress = buildWatchProgress({ isSignedIn: true, watchedEpisodes: [] })
    // Conan debuted in episode 1 and has no spoiler level.
    expect(characterVisibility({ debut: { episode: 1 } }, progress)).toBe("visible")
  })

  it("silhouettes late characters until the debut episode is reached", () => {
    const progress = buildWatchProgress({ isSignedIn: true, watchedEpisodes: [128] })
    const haibara = {
      debut: { episode: 129 },
      spoiler: "reveal" as const,
    }
    expect(characterVisibility(haibara, progress)).toBe("silhouette")

    const reached = buildWatchProgress({
      isSignedIn: true,
      watchedEpisodes: [129],
    })
    expect(characterVisibility(haibara, reached)).toBe("visible")
  })

  it("hides major spoilers entirely for a signed-in viewer who has not reached them", () => {
    const progress = buildWatchProgress({ isSignedIn: true, watchedEpisodes: [100] })
    const vermouth = {
      debut: { episode: 176 },
      spoiler: "major" as const,
    }
    expect(characterVisibility(vermouth, progress)).toBe("hidden")
  })

  it("keeps an un-gated character visible regardless of progress", () => {
    expect(characterVisibility(undefined, EMPTY_PROGRESS)).toBe("visible")
  })

  it("treats a signed-out viewer as progress-unknown, not progress-zero", () => {
    // Plain cast visible…
    expect(
      characterVisibility({ debut: { episode: 129 } }, EMPTY_PROGRESS)
    ).toBe("visible")
    // …reveals silhouetted…
    expect(
      characterVisibility(
        { debut: { episode: 129 }, spoiler: "reveal" },
        EMPTY_PROGRESS
      )
    ).toBe("silhouette")
    // …majors removed.
    expect(
      characterVisibility(
        { debut: { episode: 176 }, spoiler: "major" },
        EMPTY_PROGRESS
      )
    ).toBe("hidden")
  })

  it("showEverything bypasses every gate", () => {
    const progress = buildWatchProgress({ isSignedIn: false })
    expect(
      characterVisibility(
        { debut: { episode: 176 }, spoiler: "major" },
        progress,
        { showEverything: true }
      )
    ).toBe("visible")
  })
})