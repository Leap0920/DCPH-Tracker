import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { getLightweightCharacters } from "@/lib/characters-guide"

/*
 * The portrait URL is served straight out of the /public/characters listing
 * via Next's static-file manifest, which matches EXACT case even when the
 * underlying filesystem does not (drvfs). So a map entry whose filename
 * differs only in case serves 404 in the browser while every local shell
 * check says the file is there — which is exactly how `yukiko-kudo` shipped
 * a broken portrait. Compare against the real directory listing, exact case.
 */
describe("character portraits", () => {
  it("every mapped portrait exists in public/characters with exact case", () => {
    const dir = path.join(process.cwd(), "public", "characters")
    const files = new Set(fs.readdirSync(dir))
    const missing: string[] = []
    for (const c of getLightweightCharacters()) {
      if (!c.image) continue
      const filename = decodeURIComponent(
        c.image.replace(/^\/characters\//, "")
      )
      if (!files.has(filename)) missing.push(`${c.id} -> ${filename}`)
    }
    expect(missing).toEqual([])
  })
})
