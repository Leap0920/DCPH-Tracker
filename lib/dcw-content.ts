// lib/dcw-content.ts
// The wiki is the fastest-moving source for this franchise: its season page
// lists an episode the day it airs, and its TV Specials page carried the 9th
// special while AniList, Jikan and Kitsu still ended at the 8th.
//
// Each list page is a table of item templates, so one action=parse call yields
// a whole list:
//
//   TV Specials     {{SpecialItem|N|''[[Title]]''|Date|…}}
//   Regular movies  {{MovieItem|N|''[[Title]]''|Date|…}}
//   OVA             {{OVAItem|N|''[[Title]]''|Date|…}}
//   Season N        {{SeasonItem|EpNo|Span|[[Page|''Title'']]|Date|…}}
//
// Season pages are per calendar year ("The thirty-first season … consists of
// the episodes aired in the year 2026"), which is what makes a current-year
// pull a matter of scanning the last few season pages.

import { dcwQuery } from "@/lib/dcw"

export const DCW_SPECIALS_PAGE = "TV Specials"
export const DCW_MOVIES_PAGE = "Regular movies"
export const DCW_OVA_PAGE = "OVA"
export const DCW_EPISODES_PAGE = "Episodes"

/**
 * Season pages read for a current-year pull. The newest episodes live on the
 * highest-numbered season page; reading a couple more costs one request each
 * and covers a season page that was created late.
 */
const SEASONS_TO_SCAN = 3

export interface DcwListItem {
  /** 1-based number in the wiki's own list (episode or movie number). */
  number: number
  /** Canonical English title — the link label when the link is piped. */
  title: string
  /** ISO date (YYYY-MM-DD) of the first airing, or null when unrecognisable. */
  airDate: string | null
}

export interface DcwEpisodeListItem extends DcwListItem {
  /**
   * A rebroadcast of an older episode — the wiki marks these with an `R###`
   * code and "(Remastered)", and dates them by the *rebroadcast*. Their number
   * belongs to an episode that already exists, so they are never new content.
   */
  remastered: boolean
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
}

/** Drop refs, HTML and templates, then collapse whitespace. */
export function stripDcwMarkup(value: string): string {
  return value
    .replace(/<ref[^>]*\/>/gi, " ")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, " ")
    .replace(/\{\{[^{}]*\}\}/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/'{2,}/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** `''[[Target]]''` / `''[[Target|Label]]''` → display title. */
export function dcwLinkTitle(raw: string): string {
  const text = stripDcwMarkup(raw)
  const link = text.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/)
  if (link) return (link[2] ?? link[1]).trim()
  return text.replace(/\[\[|\]\]/g, "").trim()
}

/**
 * The wiki creates placeholder rows for content it has announced but not yet
 * titled ("Movie 30", "TBA"). Those are not entries the tracker should hold.
 */
export function isDcwPlaceholderTitle(title: string): boolean {
  const text = title.trim()
  return /^(movie|episode|special|ova)\s*\d+$/i.test(text) || /^tba$/i.test(text)
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

function monthNumber(name: string): number | null {
  const key = name.toLowerCase()
  if (MONTHS[key]) return MONTHS[key]
  // Accept 3-letter abbreviations ("Apr 10, 2004").
  const abbreviated = Object.keys(MONTHS).find((m) => m.startsWith(key) && key.length >= 3)
  return abbreviated ? MONTHS[abbreviated] : null
}

/**
 * First air date on the field → ISO. A field can carry several dates (cellphone
 * airing, TV airing, dubbed airing); the wiki lists the original first, which is
 * the one the tracker sorts on.
 */
export function parseDcwAirDate(raw: string): string | null {
  const text = stripDcwMarkup(raw)

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (iso) return iso[0]

  const monthFirst = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s*(\d{4})\b/)
  if (monthFirst) {
    const month = monthNumber(monthFirst[1])
    if (month) return `${monthFirst[3]}-${pad(month)}-${pad(Number(monthFirst[2]))}`
  }

  const dayFirst = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/)
  if (dayFirst) {
    const month = monthNumber(dayFirst[2])
    if (month) return `${dayFirst[3]}-${pad(month)}-${pad(Number(dayFirst[1]))}`
  }

  return null
}

/** Split a template body on top-level pipes, ignoring pipes inside `{{…}}` and `[[…]]`. */
export function splitTemplateArgs(body: string): string[] {
  const args: string[] = []
  let curly = 0
  let square = 0
  let current = ""

  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2)
    if (two === "{{") {
      curly++
      current += two
      i++
      continue
    }
    if (two === "}}") {
      curly = Math.max(0, curly - 1)
      current += two
      i++
      continue
    }
    if (two === "[[") {
      square++
      current += two
      i++
      continue
    }
    if (two === "]]") {
      square = Math.max(0, square - 1)
      current += two
      i++
      continue
    }
    if (body[i] === "|" && curly === 0 && square === 0) {
      args.push(current)
      current = ""
      continue
    }
    current += body[i]
  }

  args.push(current)
  return args
}

/**
 * Arguments of every `{{name|…}}` call in `wikitext`. Nesting-aware, so a
 * template used inside a field ({{Inline icons|…}}) does not truncate the call.
 */
export function templateArgs(wikitext: string, name: string): string[][] {
  const out: string[][] = []
  const opener = new RegExp(`\\{\\{\\s*${name}\\s*\\|`, "g")

  for (const match of wikitext.matchAll(opener)) {
    const start = (match.index ?? 0) + match[0].length
    let depth = 1
    let i = start
    while (i < wikitext.length - 1) {
      const two = wikitext.slice(i, i + 2)
      if (two === "{{") {
        depth++
        i += 2
        continue
      }
      if (two === "}}") {
        depth--
        if (depth === 0) break
        i += 2
        continue
      }
      i++
    }
    out.push(splitTemplateArgs(wikitext.slice(start, i)))
  }

  return out
}

/** `{{SpecialItem|N|title|date|…}}` shape: number, title, date. */
function parseNumberedItems(wikitext: string, template: string): DcwListItem[] {
  const out: DcwListItem[] = []
  const seen = new Set<number>()

  for (const args of templateArgs(wikitext, template)) {
    // A number field can be empty or non-numeric on the OVA page (`Extra`, `-`);
    // only plain numbers identify tracker content here.
    const number = Number(stripDcwMarkup(args[0] ?? ""))
    const title = dcwLinkTitle(args[1] ?? "")
    if (!Number.isInteger(number) || number < 1 || seen.has(number) || !title) continue
    if (isDcwPlaceholderTitle(title)) continue
    seen.add(number)
    out.push({ number, title, airDate: parseDcwAirDate(args[2] ?? "") })
  }

  return out.sort((a, b) => a.number - b.number)
}

/** Parse the wiki's TV-specials table. */
export function parseDcwSpecialItems(wikitext: string): DcwListItem[] {
  return parseNumberedItems(wikitext, "SpecialItem")
}

/** Parse a movie table ("Regular movies", "3D movies", …). */
export function parseDcwMovieItems(wikitext: string): DcwListItem[] {
  return parseNumberedItems(wikitext, "MovieItem")
}

/** Parse the OVA page. */
export function parseDcwOvaItems(wikitext: string): DcwListItem[] {
  return parseNumberedItems(wikitext, "OVAItem")
}

/**
 * Parse one season page. Its `{{SeasonItem}}` rows carry the episode number,
 * the broadcast span, the title and the air date in that order — alongside
 * rebroadcasts of old episodes carrying an `R###` code and non-episode rows
 * (`P1` for a TV special, `-` for an unnumbered one).
 */
export function parseDcwSeasonItems(wikitext: string): DcwEpisodeListItem[] {
  const out: DcwEpisodeListItem[] = []
  const seen = new Set<number>()

  for (const args of templateArgs(wikitext, "SeasonItem")) {
    const numberField = args[0] ?? ""
    const title = dcwLinkTitle(args[2] ?? "")
    if (!title) continue

    const plainNumber = stripDcwMarkup(numberField)
    const remastered =
      /<br\s*\/?>/i.test(numberField) ||
      /\bR\d+\b/.test(plainNumber) ||
      /remastered|rebroadcast/i.test(title)

    // A rebroadcast carries its original episode number plus an `R###` code
    // ("1098<br>R162"), so read the number that starts the field — `P1` and `-`
    // are TV-special rows, not episodes, and have none.
    const leading = plainNumber.match(/^\d+/)
    const number = leading ? Number(leading[0]) : NaN
    if (!Number.isInteger(number) || number < 1 || seen.has(number)) continue
    seen.add(number)
    out.push({ number, title, airDate: parseDcwAirDate(args[3] ?? ""), remastered })
  }

  return out.sort((a, b) => a.number - b.number)
}

/** Season page titles linked from the Episodes index, in wiki order. */
export function parseDcwSeasonPages(wikitext: string): string[] {
  const out: string[] = []
  for (const match of wikitext.matchAll(/\{\{\s*main\s*\|\s*(Season\s+\d+)\s*[|}]/g)) {
    const page = match[1].trim()
    if (!out.includes(page)) out.push(page)
  }
  return out
}

/**
 * Keep only items the wiki dates inside `year`. An item with no date is not
 * evidence of a current-year entry, so undated rows (TBA) drop out here.
 */
export function filterDcwItemsByYear<T extends { airDate: string | null }>(
  items: T[],
  year: number
): T[] {
  const prefix = `${year}-`
  return items.filter((item) => item.airDate?.startsWith(prefix) ?? false)
}

async function fetchPageWikitext(page: string): Promise<string> {
  const json = await dcwQuery<{ parse?: { wikitext?: string } }>({
    action: "parse",
    prop: "wikitext",
    page,
    redirects: "1",
  })

  const wikitext = json.parse?.wikitext
  if (!wikitext) throw new Error(`DCW: no wikitext on "${page}"`)
  return wikitext
}

/** Fetch and parse the live TV-specials list. Throws when the page cannot be read. */
export async function fetchDcwSpecialItems(): Promise<DcwListItem[]> {
  return parseDcwSpecialItems(await fetchPageWikitext(DCW_SPECIALS_PAGE))
}

/** Fetch and parse the live theatrical-movie list. */
export async function fetchDcwMovieItems(): Promise<DcwListItem[]> {
  return parseDcwMovieItems(await fetchPageWikitext(DCW_MOVIES_PAGE))
}

/** Fetch and parse the live OVA list. */
export async function fetchDcwOvaItems(): Promise<DcwListItem[]> {
  return parseDcwOvaItems(await fetchPageWikitext(DCW_OVA_PAGE))
}

/**
 * Episodes from the last few season pages, merged and de-duplicated by episode
 * number. Seasons are per calendar year, so the caller's year filter is what
 * decides which of these count as new.
 */
export async function fetchDcwSeasonItems(): Promise<DcwEpisodeListItem[]> {
  const index = parseDcwSeasonPages(await fetchPageWikitext(DCW_EPISODES_PAGE))
  if (index.length === 0) {
    throw new Error(`DCW: no season pages linked from "${DCW_EPISODES_PAGE}"`)
  }

  const out: DcwEpisodeListItem[] = []
  const seen = new Set<number>()

  for (const page of index.slice(-SEASONS_TO_SCAN)) {
    const items = parseDcwSeasonItems(await fetchPageWikitext(page))
    for (const item of items) {
      if (seen.has(item.number)) continue
      seen.add(item.number)
      out.push(item)
    }
  }

  return out.sort((a, b) => a.number - b.number)
}
