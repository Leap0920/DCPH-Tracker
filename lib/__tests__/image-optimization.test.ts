import { describe, expect, it } from "vitest"
import fs from "fs"
import path from "path"
import sharp from "sharp"

/**
 * The static images under public/ must already ship in the shape this project's
 * optimizer produces.
 *
 * This test used to re-encode every file and WRITE the result back into
 * public/ whenever the re-encode came out smaller, then assert only that the
 * result was non-empty. Both halves of that were wrong:
 *
 *  - the write left up to 17 tracked images modified in the working tree on
 *    every `npm test` (that is why New-poster.jpg and img/logo_DCPH.png turn up
 *    dirty after a test run — and why two files were rewritten on every single
 *    run: re-encoding a PNG is not byte-stable);
 *  - `expect(size).toBeGreaterThan(0)` cannot fail for any input, so the test
 *    could never catch the thing it was named after.
 *
 * It now checks and never writes. A failure means an image was committed that
 * needs re-encoding, and the fix is to commit the optimized file rather than
 * have the suite mutate the tree behind the author's back.
 */

type Budget = { relPath: string; type: "png" | "jpg"; maxWidth: number }

const IMAGES: Budget[] = [
  { relPath: "img/logo_DCPH.png", type: "png", maxWidth: 512 },
  { relPath: "tab-icon.png", type: "png", maxWidth: 192 },
  { relPath: "Bs2026.jpg", type: "jpg", maxWidth: 1200 },
  { relPath: "New-poster.jpg", type: "jpg", maxWidth: 1600 },
  { relPath: "hero-image-darkM.jpg", type: "jpg", maxWidth: 1920 },
  { relPath: "hero-image.jpg", type: "jpg", maxWidth: 1920 },
  { relPath: "tracker-image.jpg", type: "jpg", maxWidth: 1600 },
  { relPath: "img/shinichi.jpg", type: "jpg", maxWidth: 800 },
  { relPath: "img/Jinpei.jpg", type: "jpg", maxWidth: 800 },
  { relPath: "img/Heiji.jpg", type: "jpg", maxWidth: 800 },
  { relPath: "img/h1.jpg", type: "jpg", maxWidth: 800 },
  { relPath: "img/h2.jpg", type: "jpg", maxWidth: 800 },
  { relPath: "img/h3.jpg", type: "jpg", maxWidth: 800 },
  { relPath: "img/h4.jpg", type: "jpg", maxWidth: 800 },
  { relPath: "img/h5.jpg", type: "jpg", maxWidth: 800 },
  { relPath: "img/h6.jpg", type: "jpg", maxWidth: 800 },
  { relPath: "img/h7.jpg", type: "jpg", maxWidth: 800 },
]

/**
 * A re-encode is not byte-stable for every format (a PNG comes back ~4% smaller
 * on a re-run with identical settings), so a committed file only counts as
 * unoptimized once it is meaningfully larger than a fresh re-encode.
 */
const REENCODE_TOLERANCE = 0.9

const publicDir = path.resolve(process.cwd(), "public")

const reencode = (buffer: Buffer, type: Budget["type"]): Promise<Buffer> =>
  type === "png"
    ? sharp(buffer).png({ compressionLevel: 9, quality: 85 }).toBuffer()
    : sharp(buffer).jpeg({ quality: 80, mozjpeg: true }).toBuffer()

describe("Image delivery & payload optimization", () => {
  it("keeps every listed image inside its width budget", async () => {
    for (const item of IMAGES) {
      const fullPath = path.join(publicDir, item.relPath)
      if (!fs.existsSync(fullPath)) continue

      const { width } = await sharp(fullPath).metadata()

      expect(width, `${item.relPath} has no readable width`).toBeGreaterThan(0)
      expect(
        width,
        `${item.relPath} is ${width}px wide, over its ${item.maxWidth}px budget — re-encode it before committing`
      ).toBeLessThanOrEqual(item.maxWidth)
    }
  }, 30000)

  it("commits images that are already as small as a fresh re-encode", async () => {
    for (const item of IMAGES) {
      const fullPath = path.join(publicDir, item.relPath)
      if (!fs.existsSync(fullPath)) continue

      const committed = fs.readFileSync(fullPath)
      const optimized = await reencode(committed, item.type)

      expect(
        optimized.length,
        `${item.relPath} is ${committed.length}B committed vs ${optimized.length}B re-encoded — commit the smaller file`
      ).toBeGreaterThanOrEqual(Math.floor(committed.length * REENCODE_TOLERANCE))
    }
  }, 30000)

  it("keeps each file's real format matching its extension", async () => {
    for (const item of IMAGES) {
      const fullPath = path.join(publicDir, item.relPath)
      if (!fs.existsSync(fullPath)) continue

      const { format } = await sharp(fullPath).metadata()

      expect(format, `${item.relPath} is really ${format}`).toBe(
        item.type === "png" ? "png" : "jpeg"
      )
    }
  }, 30000)
})
