/**
 * Cleans and normalizes copy-pasted image link addresses (e.g. from Detective Conan Fandom Wiki,
 * MyAnimeList, Kitsu, Imgur, or direct web links) so they load cleanly as full-res cover posters.
 */
export function cleanImageUrl(url: string | null | undefined): string | null {
  if (!url) return null
  let cleaned = url.trim()
  if (!cleaned) return null

  // Fandom / Wikia CDN Links (e.g. static.wikia.nocookie.net/detectiveconan/images/...)
  if (cleaned.includes("wikia.nocookie.net") || cleaned.includes("fandom.com")) {
    cleaned = cleaned.replace(/\/scale-to-width-down\/\d+/g, "")
    cleaned = cleaned.replace(/\/smart\/width\/\d+\/height\/\d+/g, "")
    cleaned = cleaned.replace(/\/thumbnail-down\/\d+/g, "")
    cleaned = cleaned.split("?")[0]
  } else {
    // Clean trailing query strings from standard image file extensions if present
    cleaned = cleaned.replace(/(\.(?:jpg|jpeg|png|webp|gif|svg))\?.*$/i, "$1")
  }

  return cleaned
}

/**
 * Resolves Wiki File page URLs (e.g. https://www.detectiveconanworld.com/wiki/File:Movie_1.jpg)
 * into their underlying direct raw image file URL.
 */
export async function resolveAndCleanImageUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null
  let cleaned = url.trim()
  if (!cleaned) return null

  // If the user pasted a Wiki File page URL (e.g. detectiveconanworld.com/wiki/File:Movie_1.jpg)
  if (cleaned.includes("/wiki/File:")) {
    try {
      const parsedUrl = new URL(cleaned)
      const res = await fetch(cleaned, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        },
      })
      if (res.ok) {
        const html = await res.text()

        // 1. Check for class="fullMedia" href="..."
        const fullMediaMatch = html.match(/class="fullMedia"[\s\S]*?href="([^"]+)"/i)
        if (fullMediaMatch && fullMediaMatch[1]) {
          let resolved = fullMediaMatch[1]
          if (resolved.startsWith("//")) {
            resolved = `${parsedUrl.protocol}${resolved}`
          } else if (resolved.startsWith("/")) {
            resolved = `${parsedUrl.origin}${resolved}`
          }
          return cleanImageUrl(resolved)
        }

        // 2. Check for og:image meta tag
        const ogMatch =
          html.match(/property="og:image"\s+content="([^"]+)"/i) ||
          html.match(/content="([^"]+)"\s+property="og:image"/i)
        if (ogMatch && ogMatch[1]) {
          return cleanImageUrl(ogMatch[1])
        }

        // 3. Fallback: find direct /images/ link in page
        const imgMatch =
          html.match(/(https?:\/\/[^\s"']+\/images\/[^\s"']+)/i) ||
          html.match(/(\/wiki\/images\/[^\s"']+)/i)
        if (imgMatch && imgMatch[1]) {
          let resolved = imgMatch[1]
          if (resolved.startsWith("/")) resolved = `${parsedUrl.origin}${resolved}`
          return cleanImageUrl(resolved)
        }
      }
    } catch {
      // Fallback to standard clean if fetch fails
    }
  }

  return cleanImageUrl(cleaned)
}
