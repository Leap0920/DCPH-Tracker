import { describe, expect, it } from "vitest"
import fs from "fs"
import path from "path"
import sharp from "sharp"

describe("Image delivery & payload optimization", () => {
  const publicDir = path.resolve(process.cwd(), "public")

  it("optimizes high-weight static images in public directory", async () => {
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

      // Also generate WebP equivalent for static asset modern format delivery
      let webpPipeline = sharp(initialBuffer)
      if (item.maxWidth && metadata.width && metadata.width > item.maxWidth) {
        webpPipeline = webpPipeline.resize({ width: item.maxWidth, withoutEnlargement: true })
      }
      const webpBuffer = await webpPipeline.webp({ quality: 80 }).toBuffer()
      expect(webpBuffer.length).toBeGreaterThan(0)

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

      if (optimizedBuffer.length < initialBuffer.length) {
        fs.writeFileSync(fullPath, optimizedBuffer)
      }

      const finalStat = fs.statSync(fullPath)
      expect(finalStat.size).toBeGreaterThan(0)
    }
  }, 30000)
})
