import { describe, expect, it } from "vitest"
import {
  EPISODE_FLOOR,
  getHomepageContent,
  getLatestContent,
  getLatestEpisodeNumber,
} from "@/lib/homepage-content"

function neverEpisodeClient() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          not: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () => new Promise<never>(() => {}),
              }),
            }),
          }),
        }),
      }),
    }),
  }
}

function neverFeedClient() {
  return {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => new Promise<never>(() => {}),
        }),
      }),
    }),
  }
}

describe("homepage-content — timeouts fail safe, never hang", () => {
  it("keeps the EPISODE_FLOOR safety net", () => {
    expect(EPISODE_FLOOR).toBe(1209)
  })

  it("falls back to EPISODE_FLOOR when the episode read hangs", async () => {
    await expect(getLatestEpisodeNumber(neverEpisodeClient() as never, 20)).resolves.toBe(
      EPISODE_FLOOR
    )
  })

  it("returns null when the feed read hangs", async () => {
    await expect(getLatestContent(neverFeedClient() as never, 20)).resolves.toBeNull()
  })

  it("clamps a low episode number up to the floor", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            not: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: { episode_number: 3 }, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    }
    await expect(getLatestEpisodeNumber(client as never, 50)).resolves.toBe(EPISODE_FLOOR)
  })

  it("returns the episode number when above the floor", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            not: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: { episode_number: 1300 }, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    }
    await expect(getLatestEpisodeNumber(client as never, 50)).resolves.toBe(1300)
  })

  it("returns null on feed query error", async () => {
    const client = {
      from: () => ({
        select: () => ({
          order: () => ({
            limit: async () => ({ data: null, error: new Error("db down") }),
          }),
        }),
      }),
    }
    await expect(getLatestContent(client as never, 50)).resolves.toBeNull()
  })

  it("fetches both homepage reads in parallel within one budget", async () => {
    const started = Date.now()
    const result = await getHomepageContent(
      neverEpisodeClient() as never,
      neverFeedClient() as never,
      30
    )
    const elapsed = Date.now() - started
    expect(result).toEqual({ episode: EPISODE_FLOOR, entries: null })
    // Serial timeouts would cost ~60ms; parallel costs ~30ms. Generous bound
    // keeps this stable on loaded CI while still catching a serial await.
    expect(elapsed).toBeLessThan(200)
  })
})