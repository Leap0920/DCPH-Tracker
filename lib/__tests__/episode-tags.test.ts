import { describe, expect, it } from "vitest"
import {
  CRIME_TAG_LABELS,
  STANDARD_EPISODE_RUNTIME,
  arcForEpisode,
  arcTag,
  buildEpisodeTags,
  canonTag,
  collectTagFacets,
  crimeTags,
  lengthTag,
  milestoneTag,
  sortTags,
  type TaggableEntry,
} from "../episode-tags"
import { CRIME_GROUPS } from "../dcw-cases"
import { STORY_ARCS } from "../arcs-guide"
import { CANON_TYPES, canonTypeForEpisode } from "../canon-guide"

function ep(n: number, partial: Partial<TaggableEntry> = {}): TaggableEntry {
  return {
    id: partial.id ?? `ep-${n}`,
    type: "episode",
    title: partial.title ?? `Episode ${n}`,
    episode_number: n,
    runtime_minutes: STANDARD_EPISODE_RUNTIME,
    ...partial,
  }
}

describe("episode-tags: crime label table", () => {
  /**
   * The labels are duplicated from lib/dcw-cases.ts so the client bundle does
   * not pull in the DCW API client. This is the guard that keeps the copy honest.
   */
  it("covers every slug in CRIME_GROUPS", () => {
    for (const group of CRIME_GROUPS) {
      expect(CRIME_TAG_LABELS[group.slug], `missing label for ${group.slug}`).toBeTruthy()
    }
  })

  it("does not invent slugs CRIME_GROUPS does not have", () => {
    const known = new Set(CRIME_GROUPS.map((g) => g.slug))
    for (const slug of Object.keys(CRIME_TAG_LABELS)) {
      expect(known.has(slug), `stale slug ${slug}`).toBe(true)
    }
  })
})

describe("episode-tags: arc resolution", () => {
  it("resolves an arc from the episode number when arc_id is null", () => {
    // The live catalog has arc_id null on every row — this is the regression.
    const arc = arcForEpisode(50, null, null)
    expect(arc).not.toBeNull()
    expect(arc?.slug).toBe("conan-arc")
  })

  it("matches the static STORY_ARCS ranges at every boundary", () => {
    for (const storyArc of STORY_ARCS) {
      const start = arcForEpisode(storyArc.episodeStart)
      expect(start?.slug, `start of ${storyArc.slug}`).toBe(storyArc.slug)
      if (storyArc.episodeEnd != null) {
        const end = arcForEpisode(storyArc.episodeEnd)
        expect(end?.slug, `end of ${storyArc.slug}`).toBe(storyArc.slug)
        // One past the end must belong to the NEXT arc, not this one.
        const next = arcForEpisode(storyArc.episodeEnd + 1)
        expect(next?.slug).not.toBe(storyArc.slug)
      }
    }
  })

  it("lets an explicit arc_id override the number range", () => {
    const arcMap = new Map([["abc", { slug: "kaitou-kid", title: "Kaitou Kid" }]])
    const arc = arcForEpisode(50, "abc", arcMap)
    expect(arc?.slug).toBe("kaitou-kid")
  })

  it("falls back to the range when arc_id points at a missing row", () => {
    const arc = arcForEpisode(50, "ghost-id", new Map())
    expect(arc?.slug).toBe("conan-arc")
  })

  it("returns null for a null episode number", () => {
    expect(arcForEpisode(null)).toBeNull()
    expect(arcTag(null)).toBeNull()
  })
})

describe("episode-tags: canon", () => {
  it("labels a known manga-canon episode", () => {
    expect(canonTypeForEpisode(1)).toBe(CANON_TYPES.MANGA)
    expect(canonTag(1)?.label).toBe("Canon")
  })

  it("labels a known filler episode", () => {
    expect(canonTypeForEpisode(6)).toBe(CANON_TYPES.FILLER)
    expect(canonTag(6)?.label).toBe("Non-canon")
  })

  it("labels the lone anime-canon episode", () => {
    expect(canonTag(1187)?.label).toBe("Anime Canon")
  })

  it("returns null past the classified range", () => {
    expect(canonTag(null)).toBeNull()
  })
})

describe("episode-tags: crime", () => {
  it("maps slugs to display labels", () => {
    expect(crimeTags(["murder"])[0].label).toBe("Murder")
    expect(crimeTags(["attempted-murder"])[0].label).toBe("Attempted Murder")
  })

  it("drops the meaningless 'other' bucket", () => {
    expect(crimeTags(["other"])).toEqual([])
  })

  it("dedupes repeated slugs", () => {
    const tags = crimeTags(["murder", "murder"])
    expect(tags).toHaveLength(1)
  })

  it("caps at two chips so the row stays scannable", () => {
    const tags = crimeTags(["murder", "kidnapping", "robbery", "fraud"])
    expect(tags).toHaveLength(2)
    expect(tags.map((t) => t.label)).toEqual(["Murder", "Kidnapping"])
  })

  it("ignores unknown slugs rather than rendering a raw slug", () => {
    expect(crimeTags(["not-a-real-crime"])).toEqual([])
  })

  it("drops Attempted Murder when the episode also has Murder", () => {
    // DCW files a case under every crime it touches, so a death plus an attempt
    // on someone else arrives as both. Two chips read as a contradiction.
    const tags = crimeTags(["murder", "attempted-murder"])
    expect(tags.map((t) => t.label)).toEqual(["Murder"])
  })

  it("keeps Attempted Murder when there is no murder", () => {
    const tags = crimeTags(["attempted-murder", "kidnapping"])
    expect(tags.map((t) => t.label)).toEqual(["Attempted Murder", "Kidnapping"])
  })

  it("returns nothing for an absent list", () => {
    expect(crimeTags(undefined)).toEqual([])
    expect(crimeTags([])).toEqual([])
  })
})

describe("episode-tags: length", () => {
  it("does not tag the standard 25-minute slot", () => {
    expect(lengthTag(STANDARD_EPISODE_RUNTIME)).toBeNull()
  })

  it("tags a double episode", () => {
    expect(lengthTag(46)?.label).toBe("46m")
  })

  it("tags a film-length special in hours", () => {
    expect(lengthTag(115)?.label).toBe("115m")
    expect(lengthTag(120)?.label).toBe("2h")
  })

  it("does not round a 95-minute film up to 2h", () => {
    // Rounding here would overstate the runtime by 25 minutes.
    expect(lengthTag(95)?.label).toBe("95m")
  })

  it("ignores missing or nonsense runtimes", () => {
    expect(lengthTag(null)).toBeNull()
    expect(lengthTag(0)).toBeNull()
    expect(lengthTag(-5)).toBeNull()
  })
})

describe("episode-tags: milestones", () => {
  it("tags round hundreds", () => {
    expect(milestoneTag(100)?.label).toBe("100th")
    expect(milestoneTag(1000)?.label).toBe("1000th")
  })

  it("does not tag an arbitrary number", () => {
    expect(milestoneTag(101)).toBeNull()
    expect(milestoneTag(null)).toBeNull()
  })
})

describe("episode-tags: assembly", () => {
  it("orders canon before arc before crime", () => {
    const tags = buildEpisodeTags(ep(50), {
      crimeByContentId: new Map([["ep-50", ["murder"]]]),
    })
    expect(tags.map((t) => t.kind)).toEqual(["canon", "arc", "crime"])
  })

  it("respects the per-row limit", () => {
    const tags = buildEpisodeTags(ep(100), {
      crimeByContentId: new Map([["ep-100", ["murder", "kidnapping"]]]),
      limit: 2,
    })
    expect(tags).toHaveLength(2)
  })

  it("gives a non-episode only its length tag, never canon/filler", () => {
    const movie: TaggableEntry = {
      id: "mov-1",
      type: "movie",
      title: "The Time-Bombed Skyscraper",
      episode_number: null,
      runtime_minutes: 95,
    }
    const tags = buildEpisodeTags(movie)
    expect(tags.map((t) => t.kind)).toEqual(["length"])
  })

  it("never emits a tag without a tooltip", () => {
    const tags = buildEpisodeTags(ep(100), {
      crimeByContentId: new Map([["ep-100", ["murder"]]]),
    })
    for (const tag of tags) {
      expect(tag.title.length, `tag ${tag.key} has no title`).toBeGreaterThan(0)
    }
  })

  it("emits unique keys so React keys cannot collide", () => {
    const tags = buildEpisodeTags(ep(100), {
      crimeByContentId: new Map([["ep-100", ["murder", "kidnapping"]]]),
    })
    expect(new Set(tags.map((t) => t.key)).size).toBe(tags.length)
  })
})

describe("episode-tags: facets", () => {
  it("counts tags across the catalog", () => {
    const entries = [ep(1), ep(2), ep(3)]
    const facets = collectTagFacets(entries, { minCount: 1 })
    const canon = facets.find((f) => f.tag.key === "canon:manga_canon")
    expect(canon?.count).toBe(3)
  })

  it("drops the long tail below minCount", () => {
    const entries = [ep(1), ep(2)]
    const facets = collectTagFacets(entries, { minCount: 2 })
    // The arc tag appears twice, so it survives; a one-off would not.
    expect(facets.some((f) => f.tag.kind === "arc")).toBe(true)
    const single = collectTagFacets([ep(1)], { minCount: 2 })
    expect(single).toEqual([])
  })

  it("excludes length tags, which do not partition the catalog usefully", () => {
    // Every film shares a runtime, so "95m" would just mean "the movies".
    const entries = [
      { id: "m1", type: "movie", title: "A", episode_number: null, runtime_minutes: 95 },
      { id: "m2", type: "movie", title: "B", episode_number: null, runtime_minutes: 95 },
      { id: "m3", type: "movie", title: "C", episode_number: null, runtime_minutes: 95 },
    ]
    const facets = collectTagFacets(entries, { minCount: 1 })
    expect(facets.some((f) => f.tag.kind === "length")).toBe(false)
  })

  it("counts a tag that the per-row limit would have hidden", () => {
    // Episode 100 is canon + arc + crime + milestone. With limit 1 the row only
    // renders the canon chip, so the crime chip is never visible — the facet
    // must still count it, or the filter would silently lose options.
    const entries = [ep(100), ep(100, { id: "ep-100b" })]
    const facets = collectTagFacets(entries, {
      crimeByContentId: new Map([
        ["ep-100", ["murder"]],
        ["ep-100b", ["murder"]],
      ]),
      minCount: 1,
    })
    expect(facets.some((f) => f.tag.kind === "crime")).toBe(true)
  })
})

describe("episode-tags: sortTags", () => {
  it("is stable within a family", () => {
    const tags = sortTags([
      { key: "b", kind: "crime", label: "B", title: "b", rank: 1 },
      { key: "a", kind: "crime", label: "A", title: "a", rank: 0 },
    ])
    expect(tags.map((t) => t.key)).toEqual(["a", "b"])
  })
})
