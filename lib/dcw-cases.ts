/**
 * Detective Conan World crime data: discovery, fetching and parsing of
 * {{InfoBox Crime}} blocks.
 *
 * Everything here is pure except the two functions that take a DcwFetch, and
 * that fetch is injectable so the parser can be unit-tested with fixtures.
 *
 * Self-contained on purpose: the balanced-brace scanner below duplicates
 * ~50 lines of lib/dcw-episode.ts rather than exporting that module's private
 * helpers, so the episode sync can evolve without breaking this one.
 */

import { dcwQuery } from "@/lib/dcw"

export const CRIME_TEMPLATE = "Template:InfoBox Crime"
export const DCW_WIKI_BASE = "https://www.detectiveconanworld.com/wiki"

/** MediaWiki caps anonymous multi-title content requests at 50. */
export const TITLE_BATCH_SIZE = 50

export type DcwParams = Record<string, string | number>
export type DcwFetch = (params: DcwParams) => Promise<unknown>

/** Adapter over the project's throttled client — the single coupling point. */
const defaultFetch: DcwFetch = (params) =>
  dcwQuery(params as Parameters<typeof dcwQuery>[0])

export function dcwPageUrl(pageTitle: string): string {
  return `${DCW_WIKI_BASE}/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`
}

/** URL-safe key for filtering: "Attempted Murder" -> "attempted-murder". */
export function slugifyValue(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

/* ───────────────────────── Discovery ───────────────────────── */

interface EmbeddedInResponse {
  query?: { embeddedin?: { title?: string }[] }
  continue?: { eicontinue?: string }
}

/**
 * Every mainspace page embedding the crime template (~838 today).
 * Returns sorted, de-duplicated titles so cursor pagination is stable.
 */
export async function listCrimeCaseTitles(fetcher: DcwFetch = defaultFetch): Promise<string[]> {
  const titles = new Set<string>()
  let cont: string | undefined
  // Guard against a pagination bug looping forever: 40 * 500 = 20,000 pages.
  for (let page = 0; page < 40; page++) {
    const params: DcwParams = {
      action: "query",
      format: "json",
      formatversion: 2,
      list: "embeddedin",
      eititle: CRIME_TEMPLATE,
      eilimit: 500,
      einamespace: 0,
    }
    if (cont) params.eicontinue = cont
    const data = (await fetcher(params)) as EmbeddedInResponse
    for (const item of data.query?.embeddedin ?? []) {
      if (item.title) titles.add(item.title)
    }
    cont = data.continue?.eicontinue
    if (!cont) break
  }
  return [...titles].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/* ───────────────────────── Wikitext fetching ───────────────────────── */

interface RevisionsResponse {
  query?: {
    normalized?: { from?: string; to?: string }[]
    pages?: {
      title?: string
      missing?: boolean
      revisions?: { slots?: { main?: { content?: string } }; content?: string }[]
    }[]
  }
}

/**
 * Wikitext for up to TITLE_BATCH_SIZE pages in ONE request. Missing pages are
 * simply absent from the returned map.
 */
export async function fetchWikitextBatch(
  titles: string[],
  fetcher: DcwFetch = defaultFetch
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (titles.length === 0) return out

  const data = (await fetcher({
    action: "query",
    format: "json",
    formatversion: 2,
    prop: "revisions",
    rvprop: "content",
    rvslots: "main",
    titles: titles.join("|"),
  })) as RevisionsResponse

  // MediaWiki may normalise "A_b" -> "A b"; map results back to what we asked for.
  const requested = new Map<string, string>()
  for (const title of titles) requested.set(title, title)
  for (const norm of data.query?.normalized ?? []) {
    if (norm.from && norm.to) requested.set(norm.to, norm.from)
  }

  for (const page of data.query?.pages ?? []) {
    if (!page.title || page.missing) continue
    const revision = page.revisions?.[0]
    const content = revision?.slots?.main?.content ?? revision?.content
    if (typeof content !== "string") continue
    out.set(requested.get(page.title) ?? page.title, content)
  }
  return out
}

/* ───────────────────────── Wikitext scanning ───────────────────────── */

/** Reads from `{{` at `start` to its matching `}}`. Returns -1 if unbalanced. */
function matchingBraceEnd(text: string, start: number): number {
  let depth = 0
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === "{" && text[i + 1] === "{") {
      depth++
      i++
    } else if (text[i] === "}" && text[i + 1] === "}") {
      depth--
      i++
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/** Template name = text up to the first top-level `|` or the closing braces. */
function templateNameOf(body: string): string {
  const inner = body.slice(2, -2)
  const pipe = inner.indexOf("|")
  return (pipe === -1 ? inner : inner.slice(0, pipe)).replace(/_/g, " ").trim().toLowerCase()
}

/**
 * Splits a template body on pipes that are not inside a nested template,
 * wikilink, or table.
 */
function splitTopLevelParams(body: string): string[] {
  const inner = body.slice(2, -2)
  const parts: string[] = []
  let buffer = ""
  let curly = 0
  let square = 0

  for (let i = 0; i < inner.length; i++) {
    const two = inner.slice(i, i + 2)
    if (two === "{{" || two === "{|") {
      curly++
      buffer += two
      i++
      continue
    }
    if (two === "}}" || two === "|}") {
      curly = Math.max(0, curly - 1)
      buffer += two
      i++
      continue
    }
    if (two === "[[") {
      square++
      buffer += two
      i++
      continue
    }
    if (two === "]]") {
      square = Math.max(0, square - 1)
      buffer += two
      i++
      continue
    }
    if (inner[i] === "|" && curly === 0 && square === 0) {
      parts.push(buffer)
      buffer = ""
      continue
    }
    buffer += inner[i]
  }
  parts.push(buffer)
  return parts.slice(1) // drop the template name
}

/** Strips wiki markup down to plain text. */
function cleanValue(raw: string): string {
  let text = raw

  // Refs and comments carry no display value.
  text = text.replace(/<ref[^>]*\/>/gi, "")
  text = text.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
  text = text.replace(/<!--[\s\S]*?-->/g, "")

  // Line breaks and list bullets become separators before tags are stripped.
  text = text.replace(/<br\s*\/?>/gi, " · ")
  text = text.replace(/^\s*[*#]+\s*/gm, " · ")

  // Nested templates ({{Sc|Gin}}) -> their last plain argument.
  for (let pass = 0; pass < 4 && text.includes("{{"); pass++) {
    text = text.replace(/\{\{([^{}]*)\}\}/g, (_all, inner: string) => {
      const args = String(inner)
        .split("|")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.includes("="))
      return args.length > 1 ? args[args.length - 1] : args[0] ?? ""
    })
  }

  // [[Page|Label]] -> Label ; [[Page]] -> Page
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
  text = text.replace(/\[\[([^\]]+)\]\]/g, "$1")
  text = text.replace(/\[(?:https?:)?\/\/\S+\s+([^\]]+)\]/g, "$1")

  text = text.replace(/'{2,}/g, "") // bold / italic
  text = text.replace(/<[^>]+>/g, "") // any surviving HTML
  text = text.replace(/&nbsp;/gi, " ")

  text = text.replace(/\s*\n+\s*/g, " · ")
  text = text.replace(/\s+/g, " ")
  text = text.replace(/(?:\s*·\s*){2,}/g, " · ")
  return text.replace(/^[\s·]+|[\s·]+$/g, "").trim()
}

function nullIfBlank(value: string, maxLength = 600): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed
}

/* ───────────────────────── Canonical grouping ───────────────────────── */

/**
 * DCW's `crime` and `cause-death` fields are free text: ~250 distinct crime
 * values across ~2,000 cases, riddled with typos ("Attemped Murder", 26 rows),
 * qualifiers ("Murder (Past)"), uncertainty markers ("Suicide?"), combo strings
 * ("Bombing-Murder") and narrative junk ("Lost Cat"). Faceting on that raw text
 * is unusable, so every value is folded into one of these groups.
 *
 * The raw text is still stored and displayed on each case card — grouping only
 * drives the category cards and the URL filters.
 */
export interface ValueGroup {
  slug: string
  label: string
}

export const CRIME_GROUPS: readonly ValueGroup[] = [
  { slug: "murder", label: "Murder" },
  { slug: "attempted-murder", label: "Attempted Murder" },
  { slug: "kidnapping", label: "Kidnapping & Hostage" },
  { slug: "suicide", label: "Suicide" },
  { slug: "accident", label: "Accident & Natural Death" },
  { slug: "bombing", label: "Bombing & Arson" },
  { slug: "robbery", label: "Robbery & Theft" },
  { slug: "fraud", label: "Scam & Extortion" },
  { slug: "assault", label: "Assault & Violence" },
  { slug: "vandalism", label: "Vandalism & Mischief" },
  { slug: "missing-person", label: "Missing Person" },
  { slug: "other", label: "Other Cases" },
]

export const METHOD_GROUPS: readonly ValueGroup[] = [
  { slug: "blunt-force", label: "Blunt force" },
  { slug: "stabbing", label: "Stabbing" },
  { slug: "strangulation", label: "Strangulation" },
  { slug: "hanging", label: "Hanging" },
  { slug: "gunshot", label: "Gunshot" },
  { slug: "poisoning", label: "Poisoning" },
  { slug: "drowning", label: "Drowning" },
  { slug: "explosion", label: "Explosion" },
  { slug: "burning", label: "Burning" },
  { slug: "vehicle", label: "Vehicle & train" },
  { slug: "fall", label: "Fall" },
  { slug: "suffocation", label: "Suffocation" },
  { slug: "decapitation", label: "Decapitation" },
  { slug: "electrocution", label: "Electrocution" },
  { slug: "overdose", label: "Overdose" },
  { slug: "other-method", label: "Other method" },
  { slug: "unknown", label: "Unknown" },
]

const CRIME_GROUP_LABELS = new Map(CRIME_GROUPS.map((g) => [g.slug, g.label]))
const METHOD_GROUP_LABELS = new Map(METHOD_GROUPS.map((g) => [g.slug, g.label]))

/** Title-cased fallback, so a stale slug from a pre-reclassify sync still reads. */
function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export function crimeGroupLabel(slug: string): string {
  return CRIME_GROUP_LABELS.get(slug) ?? titleCaseSlug(slug)
}

export function methodGroupLabel(slug: string): string {
  return METHOD_GROUP_LABELS.get(slug) ?? titleCaseSlug(slug)
}

export function isCrimeGroupSlug(slug: string): boolean {
  return CRIME_GROUP_LABELS.has(slug)
}

export function isMethodGroupSlug(slug: string): boolean {
  return METHOD_GROUP_LABELS.has(slug)
}

/**
 * Lowercase, drop "(Past)"-style qualifiers and reduce all punctuation to
 * spaces — so every rule below can be written in plain words. "Hit-and-Run"
 * becomes "hit and run", "Self-Defense?" becomes "self defense".
 */
function normalizeValue(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\(\s*(?:past|pass|presumed|presumably|ongoing)\s*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Covers "attempted", "attemped" (26 rows) and "atttempted". */
const ATTEMPT_RE = /at{1,3}em?p{1,2}t?ed|attempt/
const MURDER_RE = /murder|homicide|manslaughter|assassinat|\bkill/

/**
 * ORDER IS SIGNIFICANT — first match wins, roughly by severity, so a combo
 * string resolves to its gravest element:
 *   "Robbery - Attempted Murder" -> attempted-murder
 *   "Bombing-Murder"             -> murder
 *   "Bombing and hostage situation" -> kidnapping
 */
const CRIME_RULES: readonly { slug: string; test: RegExp }[] = [
  { slug: "murder", test: MURDER_RE },
  { slug: "suicide", test: /suicide/ },
  {
    slug: "kidnapping",
    test: /kidnap|dognap|catnap|hostage|abduct|ransom|confinement|busjack|hijack|skyjack|traffick/,
  },
  { slug: "bombing", test: /bomb|explos|blast|detonat|arson|incendiar/ },
  {
    slug: "accident",
    test: /accident|hit and run|hit by|crash|derail|capsiz|natural death|natural disaster|illness|disease|drown|fell|falling|animal attack|mauled/,
  },
  {
    slug: "robbery",
    test: /robber|theft|thief|steal|stole|stolen|burglar|shoplift|pickpocket|snatch|mugg|carjack|smuggl|poach|looting|dine and dash/,
  },
  {
    slug: "fraud",
    test: /fraud|scam|swindl|blackmail|extort|embezzl|counterfeit|forger|briber|match fixing|cheating|gambl|money launder|impersonat/,
  },
  {
    slug: "assault",
    test: /assault|batter|attack|threat|harass|intimidat|shoot|stab|self defen|violence|abuse|torture|reckless|endanger|poison|rape|arrest/,
  },
  { slug: "vandalism", test: /vandal|graffiti|property damage|trespass|break in|prank|mischief|ding dong/ },
  { slug: "missing-person", test: /\bmissing\b/ },
]

/**
 * Canonical group for a raw `crime` value. Attempted murder is special-cased
 * ahead of everything: it needs BOTH an attempt marker and a murder token, so
 * "Attempted Suicide" and "Attempted robbery" don't land here.
 */
export function classifyCrimeType(raw: string | null | undefined): ValueGroup {
  const text = normalizeValue(raw ?? "")
  if (!text) return { slug: "other", label: crimeGroupLabel("other") }
  if (ATTEMPT_RE.test(text) && MURDER_RE.test(text)) {
    return { slug: "attempted-murder", label: crimeGroupLabel("attempted-murder") }
  }
  for (const rule of CRIME_RULES) {
    if (rule.test.test(text)) return { slug: rule.slug, label: crimeGroupLabel(rule.slug) }
  }
  return { slug: "other", label: crimeGroupLabel("other") }
}

/** Gunshot precedes burning so "fired" never reads as fire; poisoning precedes overdose. */
const METHOD_RULES: readonly { slug: string; test: RegExp }[] = [
  { slug: "gunshot", test: /gunshot|\bshot\b|shooting|\bgun\b|bullet|firearm|pistol|rifle/ },
  { slug: "stabbing", test: /stab|slit|slash|blade|knife|sword|scissor|impale|pierce|puncture|arrow|bolt|crossbow/ },
  { slug: "blunt-force", test: /blunt|bash|bludgeon|beaten|beating|struck|skull fracture|head trauma/ },
  { slug: "strangulation", test: /strangl|garrot|throttl/ },
  { slug: "hanging", test: /hang|noose/ },
  { slug: "decapitation", test: /decapitat|behead|dismember/ },
  { slug: "drowning", test: /drown|submerg/ },
  { slug: "poisoning", test: /poison|cyanide|arsenic|toxin|venom|carbon monoxide|toxic gas/ },
  { slug: "overdose", test: /overdose|\bdrug/ },
  { slug: "explosion", test: /explos|bomb|blast|detonat/ },
  { slug: "burning", test: /burn|\bfire\b|scald|incinerat|arson|flame/ },
  { slug: "vehicle", test: /\bcar\b|vehicle|vehicular|\btrain\b|truck|\bbus\b|run over|hit by|pushed in front|traffic|crash/ },
  { slug: "fall", test: /\bfall|\bfell\b|plunge|cliff|thrown from/ },
  { slug: "suffocation", test: /suffocat|asphyxi|chok|smother/ },
  { slug: "electrocution", test: /electrocut|electric/ },
  { slug: "unknown", test: /unknown|unspecified|undetermined|unclear/ },
]

/** Canonical group for a raw `cause-death` value. */
export function classifyCauseDeath(raw: string | null | undefined): ValueGroup {
  const text = normalizeValue(raw ?? "")
  if (!text) return { slug: "unknown", label: methodGroupLabel("unknown") }
  for (const rule of METHOD_RULES) {
    if (rule.test.test(text)) return { slug: rule.slug, label: methodGroupLabel(rule.slug) }
  }
  return { slug: "other-method", label: methodGroupLabel("other-method") }
}

/* ───────────────────────── Parsing ───────────────────────── */

export interface ParsedCrimeCase {
  caseIndex: number
  crimeType: string
  crimeSlug: string
  causeDeath: string | null
  causeSlug: string | null
  victim: string | null
  suspects: string | null
  people: string | null
  location: string | null
  description: string | null
  dateText: string | null
  timeText: string | null
  ageText: string | null
  victimLabel: string | null
  causeDeathLabel: string | null
  suspectsLabel: string | null
  imageName: string | null
}

/** The template's own fallback when `crime` is absent or empty. */
export const DEFAULT_CRIME_TYPE = "Murder"

/**
 * Every {{InfoBox Crime}} block on a page, in document order (case_index is
 * 1-based). Multi-case episodes yield several.
 */
export function parseCrimeBlocks(wikitext: string): ParsedCrimeCase[] {
  const text = wikitext.replace(/<!--[\s\S]*?-->/g, "")
  const cases: ParsedCrimeCase[] = []

  let i = 0
  while (i < text.length) {
    const open = text.indexOf("{{", i)
    if (open === -1) break
    const end = matchingBraceEnd(text, open)
    if (end === -1) break
    const body = text.slice(open, end)

    if (templateNameOf(body) === "infobox crime") {
      cases.push(buildCase(body, cases.length + 1))
      i = end
    } else {
      // Advance minimally so a crime block nested in another template is found.
      i = open + 2
    }
  }
  return cases
}

function buildCase(body: string, caseIndex: number): ParsedCrimeCase {
  const params = new Map<string, string>()
  for (const part of splitTopLevelParams(body)) {
    const eq = part.indexOf("=")
    if (eq === -1) continue // positional params are unused by this template
    const key = part.slice(0, eq).trim().toLowerCase().replace(/[\s_]+/g, "-")
    if (key) params.set(key, part.slice(eq + 1))
  }

  const field = (key: string, maxLength?: number): string | null => {
    const raw = params.get(key)
    return raw === undefined ? null : nullIfBlank(cleanValue(raw), maxLength)
  }

  const crimeType = field("crime") ?? DEFAULT_CRIME_TYPE
  const causeDeath = field("cause-death")

  return {
    caseIndex,
    crimeType,
    // The slug columns hold the CANONICAL GROUP, not a slug of the raw text.
    // crime_type / cause_death keep the wiki's exact wording for display.
    crimeSlug: classifyCrimeType(crimeType).slug,
    causeDeath,
    causeSlug: causeDeath ? classifyCauseDeath(causeDeath).slug : null,
    victim: field("victim"),
    suspects: field("suspects"),
    people: field("people"),
    location: field("location"),
    description: field("description", 4000),
    dateText: field("date", 200),
    timeText: field("time", 200),
    ageText: field("age", 120),
    victimLabel: field("victim-label", 80),
    causeDeathLabel: field("cause-death-label", 80),
    suspectsLabel: field("suspects-label", 80),
    // Filenames must not go through cleanValue's separator mangling.
    imageName: nullIfBlank((params.get("image") ?? "").replace(/\[\[|\]\]/g, ""), 300),
  }
}
