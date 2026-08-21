/**
 * Cleans and normalizes copy-pasted image link addresses from any website
 * (Detective Conan World, Fandom, MyAnimeList, Kitsu, AniList, TMDB, Imgur,
 * or any direct image link) so they load cleanly as full-res cover posters.
 */
export function cleanImageUrl(url: string | null | undefined): string | null {
  if (!url) return null
  let cleaned = url.trim()
  if (!cleaned) return null

  // Fandom / Wikia CDN (e.g. static.wikia.nocookie.net/.../scale-to-width-down/300)
  if (cleaned.includes("wikia.nocookie.net") || cleaned.includes("fandom.com")) {
    cleaned = cleaned.replace(/\/scale-to-width-down\/\d+/g, "")
    cleaned = cleaned.replace(/\/smart\/width\/\d+\/height\/\d+/g, "")
    cleaned = cleaned.replace(/\/thumbnail-down\/\d+/g, "")
    cleaned = cleaned.split("?")[0]
  }
  // TMDB poster URLs (…/w185/…, …/w500/… → use original or w780)
  else if (cleaned.includes("image.tmdb.org")) {
    cleaned = cleaned.replace(/\/w\d+\//, "/original/")
    cleaned = cleaned.split("?")[0]
  }
  // Kitsu / MAL / AniList CDN (keep as-is, just strip tracking params)
  else if (
    cleaned.includes("media.kitsu.app") ||
    cleaned.includes("cdn.myanimelist.net") ||
    cleaned.includes("s4.anilist.co")
  ) {
    // Strip only tracking query params, preserve the image path
    const qIdx = cleaned.indexOf("?")
    if (qIdx !== -1) cleaned = cleaned.slice(0, qIdx)
  } else {
    // Generic: clean trailing query strings from standard image extensions
    cleaned = cleaned.replace(/(\.(?:jpg|jpeg|png|webp|gif|svg))\?.*$/i, "$1")
  }

  return cleaned
}

/**
 * Resolves image page URLs into their direct image file URL.
 * Supports: Detective Conan World File pages, Wikipedia/Wikimedia File pages,
 * Fandom File pages. Direct image links from any other site are cleaned and
 * returned as-is (TMDB, Kitsu, AniList, MAL, Imgur, etc.).
 */
export async function resolveAndCleanImageUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null
  let cleaned = url.trim()
  if (!cleaned) return null

  // Detect File page URLs from any wiki (DCW, Wikipedia, Fandom, etc.)
  const isFilePage =
    cleaned.includes("/wiki/File:") ||
    cleaned.includes("/wiki/Special:FilePath/") ||
    /fandom\.com\/wiki\/File:/i.test(cleaned)

  if (isFilePage) {
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
