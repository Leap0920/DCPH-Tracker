import { describe, expect, it } from "vitest"
import fs from "fs"
import path from "path"
import sharp from "sharp"

/**
 * Checks that the static images shipped in `public/` decode and sit within
 * their width budgets.
 *
 * This is assertion-only. It used to write the re-encoded bytes back over the
 * source files, which made `npm test` mutate tracked assets: each encode is
 * lossy, the only guard was "the new file is smaller", and it therefore
 * re-encoded and re-compressed every image a little further on every run.
 * Re-encoding is a deliberate maintenance step, not something a test does.
 */
describe("Image delivery & payload optimization", () => {
  const publicDir = path.resolve(process.cwd(), "public")

  it("decodes high-weight static images and respects their width budget", async () => {
    const imagesToOptimize: { relPath: string; type: "png" | "jpg"; maxWidth?: number }[] = [
      { relPath: "img/logo_DCPH.png", type: "png", maxWidth: 512 },
      { relPath: "tab-icon.png", type: "png", maxWidth: 192 },
      { relPath: "Bs2026.jpg", type: "jpg", maxWidth: 1200 },
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

    for (const item of imagesToOptimize) {
      const fullPath = path.join(publicDir, item.relPath)
      if (!fs.existsSync(fullPath)) continue

      const initialBuffer = fs.readFileSync(fullPath)
      const pipeline = sharp(initialBuffer)
      const metadata = await pipeline.metadata()

      expect(metadata.format, `${item.relPath} must decode as an image`).toBeTruthy()
      expect(initialBuffer.length, `${item.relPath} must not be empty`).toBeGreaterThan(0)

      // Also generate WebP equivalent for static asset modern format delivery
      let webpPipeline = sharp(initialBuffer)
      if (item.maxWidth && metadata.width && metadata.width > item.maxWidth) {
        webpPipeline = webpPipeline.resize({ width: item.maxWidth, withoutEnlargement: true })
      }
      const webpBuffer = await webpPipeline.webp({ quality: 80 }).toBuffer()
      expect(webpBuffer.length, `${item.relPath} webp encode`).toBeGreaterThan(0)

      // Optimize original format
      let optPipeline = sharp(initialBuffer)
      if (item.maxWidth && metadata.width && metadata.width > item.maxWidth) {
        optPipeline = optPipeline.resize({ width: item.maxWidth, withoutEnlargement: true })
      }

      let optimizedBuffer: Buffer
      if (item.type === "png") {
        optimizedBuffer = await optPipeline
          .png({ compressionLevel: 9, quality: 85 })
          .toBuffer()
      } else {
        optimizedBuffer = await optPipeline
          .jpeg({ quality: 80, mozjpeg: true })
          .toBuffer()
      }

      expect(optimizedBuffer.length, `${item.relPath} optimized encode`).toBeGreaterThan(0)

      const optimizedMetadata = await sharp(optimizedBuffer).metadata()
      if (item.maxWidth) {
        expect(
          optimizedMetadata.width ?? 0,
          `${item.relPath} must fit within ${item.maxWidth}px`
        ).toBeLessThanOrEqual(item.maxWidth)
      }
    }
  }, 30000)
})
