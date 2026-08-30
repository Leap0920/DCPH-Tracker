"use client"

export const CARD_WIDTH = 1080
export const CARD_HEIGHT = 1350

let fontEmbedCache: string | null = null

/**
 * html-to-image re-downloads and inlines every @font-face on each call, which
 * is the single biggest cost. Cache it for the session.
 */
async function getFontCss(node: HTMLElement): Promise<string> {
  const { getFontEmbedCSS } = await import("html-to-image")
  if (fontEmbedCache === null) {
    try {
      fontEmbedCache = await getFontEmbedCSS(node)
    } catch {
      fontEmbedCache = ""
    }
  }
  return fontEmbedCache
}

/**
 * Render a card DOM node to a 1080×1350 PNG data URL.
 *
 * Two warm-up passes before the real one — known html-to-image quirk: the
 * first pass often serialises before images decode (worst on Safari/iOS).
 */
export async function renderCardToPng(node: HTMLElement): Promise<string> {
  const { toPng } = await import("html-to-image")

  await document.fonts.ready

  const options = {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    canvasWidth: CARD_WIDTH,
    canvasHeight: CARD_HEIGHT,
    pixelRatio: 1,
    backgroundColor: "#050505",
    cacheBust: false,
    fontEmbedCSS: await getFontCss(node),
    // opt any node out of the export with data-export="skip"
    filter: (n: Node) =>
      !(n instanceof HTMLElement && n.dataset.export === "skip"),
  }

  await toPng(node, options)
  await toPng(node, options)
  return toPng(node, options)
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a")
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  // fetch(dataUrl) fails on large data URLs in some browsers. Use atob+blob instead.
  const [header, base64] = dataUrl.split(",")
  const mimeMatch = header.match(/:(.*?);/)
  const mime = mimeMatch?.[1] ?? "image/png"
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], filename, { type: mime })
}

/** Web Share API L2 — real native share sheet on mobile, no server needed. */
export function canShareFiles(): boolean {
  if (typeof navigator === "undefined" || !navigator.canShare) return false
  try {
    const probe = new File([new Blob()], "p.png", { type: "image/png" })
    return navigator.canShare({ files: [probe] })
  } catch {
    return false
  }
}

export async function shareFile(file: File, title: string): Promise<void> {
  await navigator.share({ files: [file], title })
}
