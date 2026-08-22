// lib/dcw-episode.ts
// Server-only: fetch + parse a Detective Conan World episode/movie page into
// structured detail (description, cast, gadgets, staff metadata, plot sections).
//
// Why wikitext and not extracts: DCW does not have the TextExtracts extension,
// so `prop=extracts` is rejected with "Unrecognized value for parameter prop".
// `action=parse&prop=wikitext` is the supported path and also gives us the
// infobox + template data we actually want (cast, gadgets, staff).
//
// Never throws. Missing page, timeout, parse failure -> null / empty arrays.

import { DCW_API, DCW_USER_AGENT } from "@/lib/dcw";
import {
  dcwCategoriesForType,
  fetchDcwCategoryIndexes,
  isDcwOverviewTitle,
  isJunkDcwTitle,
  matchInIndex,
  normalizeContentType,
  normalizeMatchTitle,
  resolveNumberedOverviewTitle,
  searchDcwBestTitle,
  type DcwGetter,
} from "@/lib/dcw-match";

/* ------------------------------------------------------------------ types */

export type DcwCastMember = {
  /** Character name, plain text. */
  character: string;
  /** Japanese voice actor, when the page lists one. */
  actor?: string;
  /** True when the page marks the character as debuting in this episode. */
  introduced?: boolean;
};

export type DcwGadget = {
  name: string;
  /** True when listed under "Gadgets introduced". */
  introduced: boolean;
};

export type DcwMetaField = {
  label: string;
  value: string;
};

export type DcwPlotSection = {
  heading: string;
  text: string;
  /** Resolution-type sections that give away the culprit. */
  spoiler: boolean;
};

export type DcwEpisodeDetails = {
  /** Canonical DCW page title (after redirects). */
  title: string;
  url: string;
  pageId: number | null;
  /** Lead / plot intro, plain text. May be null. */
  description: string | null;
  cast: DcwCastMember[];
  gadgets: DcwGadget[];
  meta: DcwMetaField[];
  plot: DcwPlotSection[];
  fetchedAt: string;
};

/* -------------------------------------------------------------- constants */

const REVALIDATE_SECONDS = 60 * 60 * 24 * 7; // 7 days
const TIMEOUT_MS = 12_000;
const MIN_INTERVAL_MS = 200; // <= 5 req/s, matches lib/dcw.ts
const MAX_RETRIES = 3;
const MEMORY_TTL_MS = 1000 * 60 * 30;
const MEMORY_MAX_ENTRIES = 500;

const MAX_CAST = 40;
const MAX_GADGETS = 24;
const MAX_PLOT_SECTIONS = 6;
const MIN_DESCRIPTION_LENGTH = 40;

const WIKI_BASE = "https://www.detectiveconanworld.com/wiki";

const INFOBOX_META_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["airdate", "Original air date"],
  ["broadcast-rating", "Broadcast rating"],
  ["rating", "Broadcast rating"],
  ["case", "Manga source"],
  ["manga", "Manga source"],
  ["solved-by", "Case solved by"],
  ["next-conan-hint", "Next Conan's Hint"],
  ["director", "Director"],
  ["screenplay", "Screenplay"],
  ["storyboard", "Storyboard"],
  ["episode-director", "Episode director"],
  ["animation-director", "Animation director"],
  ["character-design", "Character design"],
  ["opening-song", "Opening song"],
  ["closing-song", "Closing song"],
];

 /** Templates whose visible label we keep when flattening wikitext. */
const LABEL_TEMPLATES = new Set([
  "char",
  "newchar",
  "gadget",
  "newgadget",
  "nihongo",
  "ja",
  "an",
  "m",
  "ep",
]);

/* ---------------------------------------------------------------- helpers */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PAGENAME_MAGIC_RE =
  /\{\{\s*(?:PAGENAME|PAGENAMEE|FULLPAGENAME|FULLPAGENAMEE|BASEPAGENAME|SUBPAGENAME|SUBJECTPAGENAME)\s*\}\}/gi

function expandPageNameMagicWords(wikitext: string, pageTitle?: string | null): string {
  const title = pageTitle?.trim()
  if (!title) return wikitext
  return wikitext.replace(PAGENAME_MAGIC_RE, title)
}

const LEADING_JUNK_RE = /^[\s,;:.!?·—–\-)\]}]+/u

export function sanitiseDcwDescription(text: string, pageTitle?: string | null): string {
  let out = text.replace(/\r\n/g, "\n")
  out = out.replace(/\(\s*[,;:]*\s*\)/g, "")
  out = out.replace(/[ \t]+([,;:.!?])/g, "$1")
  out = out.replace(/,\s*,+/g, ",")
  out = out.replace(/[ \t]{2,}/g, " ")
  out = out.trim()

  if (LEADING_JUNK_RE.test(out)) {
    const stripped = out.replace(LEADING_JUNK_RE, "").trim()
    if (!stripped) return ""
    const title = pageTitle?.trim()
    out = title ? `${title}, ${stripped}` : stripped.charAt(0).toUpperCase() + stripped.slice(1)
  }

  return out.trim()
}

export function normalizeDcwTitle(raw: string): string {
  return raw.replace(/_/g, " ").replace(/\s{2,}/g, " ").trim();
}

export function dcwPageUrl(title: string): string {
  const path = normalizeDcwTitle(title)
    .replace(/ /g, "_")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${WIKI_BASE}/${path}`;
}

/* --------------------------------------------------------------- throttle */

let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function takeSlot(): Promise<void> {
  const slot = queue.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  });
  queue = slot.catch(() => undefined);
  return slot;
}

/* ------------------------------------------------------------ http client */

type MaybeMaxlag = { error?: { code?: string; info?: string } };

async function dcwGet<T>(params: Record<string, string>): Promise<T | null> {
  const search = new URLSearchParams({
    format: "json",
    formatversion: "2",
    maxlag: "5",
    ...params,
  });
  const url = `${DCW_API}?${search.toString()}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    await takeSlot();
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": DCW_USER_AGENT,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        next: { revalidate: REVALIDATE_SECONDS },
      });

      if (response.status === 429 || response.status === 503) {
        if (attempt === MAX_RETRIES) return null;
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (!response.ok) return null;

      const json = (await response.json()) as T & MaybeMaxlag;
      if (json?.error?.code === "maxlag") {
        if (attempt === MAX_RETRIES) return null;
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (json?.error) return null;
      return json as T;
    } catch {
      if (attempt === MAX_RETRIES) return null;
      await sleep(300 * 2 ** attempt);
    }
  }
  return null;
}

type ParseResponse = {
  parse?: {
    title?: string;
    pageid?: number;
    wikitext?: string | { "*"?: string };
  };
};

async function fetchWikitext(
  title: string,
): Promise<{ title: string; pageId: number | null; wikitext: string } | null> {
  const data = await dcwGet<ParseResponse>({
    action: "parse",
    page: normalizeDcwTitle(title),
    prop: "wikitext",
    redirects: "1",
  });

  const raw = data?.parse?.wikitext;
  const wikitext = typeof raw === "string" ? raw : raw?.["*"];
  if (!wikitext || wikitext.length < 50) return null;

  return {
    title: data?.parse?.title ?? normalizeDcwTitle(title),
    pageId: typeof data?.parse?.pageid === "number" ? data.parse.pageid : null,
    wikitext,
  };
}

/** Adapter so lib/dcw-match.ts can reuse this module's throttled client. */
const dcwGetter: DcwGetter = (params) => dcwGet(params as never);

/** Hard ceiling on network attempts per resolution, to bound latency. */
const MAX_CANDIDATE_ATTEMPTS = 14;
const MAX_VARIANT_ATTEMPTS = 4;
/** Strip variants get their own budget: they are the high-value guesses. */
const MAX_STRIP_ATTEMPTS = 5;
/** Search is the only unbounded-cost tier; keep the seed count small. */
const MAX_SEARCH_SEEDS = 4;
/** Bound on derived candidates so a pathological title cannot fan out. */
const MAX_STRIP_CANDIDATES = 12;

/**
 * Titles stored in content_entries that no amount of normalisation reaches,
 * mapped to their verified canonical DCW page. Keep this tiny and exact.
 */
const DCW_TITLE_ALIASES = new Map<string, string>([
  [
    "compilation movie (the story of haibara)",
    "The Story of Ai Haibara ~Black Iron Mystery Train~",
  ],
  [
    "compilation movie: the story of haibara",
    "The Story of Ai Haibara ~Black Iron Mystery Train~",
  ],
  ["the story of haibara", "The Story of Ai Haibara ~Black Iron Mystery Train~"],
  ["detective conan magic file: 01", "Magic File 1"],
  ["detective conan magic file: 1", "Magic File 1"],
]);

function aliasFor(raw: string): string | null {
  const key = normalizeDcwTitle(raw).toLowerCase();
  return DCW_TITLE_ALIASES.get(key) ?? null;
}

/**
 * Negative results live in their own short-TTL map. Misses are usually
 * transient (search lag on a fresh episode, maxlag backoff, page created after
 * our first lookup), so they expire far sooner than positive cache entries.
 * Positive caching still goes through cacheGet/cacheSet, unchanged.
 */
const NEGATIVE_TTL_MS = 5 * 60 * 1000;
const negativeCache = new Map<string, number>();

function isNegativeCached(key: string): boolean {
  const expiresAt = negativeCache.get(key);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    negativeCache.delete(key);
    return false;
  }
  return true;
}

function rememberMiss(key: string): void {
  negativeCache.set(key, Date.now() + NEGATIVE_TTL_MS);
}

function normalizeEpisodeNumber(value?: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 20000) return null;
  return Math.trunc(parsed);
}

/* ------------------------------------------------- derived numeric hints */

/**
 * Structured number patterns per content type. Only these feed the numbered
 * overview tables: a bare trailing number is far too loose (e.g. "Aoyama Short
 * Stories Part 1" must never be read as "OVA 1").
 */
const OVERVIEW_NUMBER_PATTERNS: Record<string, RegExp[]> = {
  movie: [/\bmovie\s*(?:no\.?\s*)?0*(\d{1,2})\b/i],
  special: [/\b(?:tv\s*)?special\s*(?:no\.?\s*)?0*(\d{1,2})\b/i],
  ova: [/\bova\s*(?:no\.?\s*)?0*(\d{1,2})\b/i],
  hanzawa: [/\bhanzawa\s*(?:episode\s*)?0*(\d{1,2})\b/i],
  zero_tea_time: [
    /\btime\.\s*0*(\d{1,2})\b/i,
    /\btea\s*time\s*(?:episode\s*)?0*(\d{1,2})\b/i,
  ],
};

function firstPatternNumber(values: string[], patterns: RegExp[]): number | null {
  for (const value of values) {
    if (!value) continue;
    for (const pattern of patterns) {
      const match = pattern.exec(value);
      if (!match) continue;
      const parsed = normalizeEpisodeNumber(match[1]);
      if (parsed !== null && parsed <= 999) return parsed;
    }
  }
  return null;
}

/** Number usable against a numbered overview table, or null. */
function deriveOverviewNumber(normalizedType: string, values: string[]): number | null {
  const patterns = OVERVIEW_NUMBER_PATTERNS[normalizedType];
  if (!patterns) return null;
  return firstPatternNumber(values, patterns);
}

/**
 * Loose trailing number ("A Witch Sheds No Tears 04"). Used only to decide that
 * a numeric hint exists — never to index into an overview table.
 */
function deriveLooseNumber(values: string[]): number | null {
  return firstPatternNumber(values, [
    /(?:^|\s)0*(\d{1,2})(?:\s*[-\u2013\u2014]\s*0*\d{1,3})?\s*$/,
  ]);
}

function numbersIn(value: string): Set<number> {
  const out = new Set<number>();
  const matches = value.match(/\d{1,3}/g) ?? [];
  for (const raw of matches) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) out.add(parsed);
  }
  return out;
}

/**
 * True when both titles carry numbers and share none. Kills search hits that
 * land on a neighbouring numbered entry (e.g. "... 10" -> "... 11" page).
 */
function numbersConflict(seed: string, candidate: string): boolean {
  const seedNumbers = numbersIn(seed);
  if (seedNumbers.size === 0) return false;
  const candidateNumbers = numbersIn(candidate);
  if (candidateNumbers.size === 0) return false;
  for (const n of seedNumbers) if (candidateNumbers.has(n)) return false;
  return true;
}

/**
 * Cheap orthographic variants of a DB title. Guesses only — tried after the
 * category index, and capped by MAX_VARIANT_ATTEMPTS.
 */
function titleVariants(raw: string): string[] {
  const base = normalizeDcwTitle(raw);
  if (!base) return [];

  const out: string[] = [];
  const push = (value: string) => {
    const normalized = normalizeDcwTitle(value);
    if (!normalized || normalized.length < 3) return;
    if (normalized === base || out.includes(normalized)) return;
    out.push(normalized);
  };

  push(base.replace(/[\u2018\u2019\u02bc]/g, "'"));
  push(base.replace(/'/g, "\u2019"));
  push(base.replace(/\s*&\s*/g, " and "));
  push(base.replace(/\s+and\s+/gi, " & "));
  push(base.replace(/\s*[:\u2013\u2014-]\s*Part\s*(\d+)\s*$/i, " Part $1"));
  push(base.replace(/\s*Part\s*(\d+)\s*$/i, ""));
  push(base.replace(/\s*\((?:TV\s*)?(?:Episode|Anime|Special|Movie)\)\s*$/i, ""));
  push(base.replace(/^The\s+/i, ""));
  push(`The ${base}`);

  return out;
}

/**
 * Structural strip variants of a DB title. Unlike titleVariants (spelling
 * guesses) these peel off the packaging the tracker DB adds around canonical
 * DCW names:
 *
 *   "[OVA] Shogakukan Illustrated Encyclopedia #01 - Crime Prevention Guide"
 *   "Detective Conan Magic File 2: Shinichi Kudo..."   -> "Magic File 2: ..."
 *   "Detective Conan Movie 01: The Timed Skyscraper"   -> "The Timed Skyscraper"
 *   "A Witch Sheds No Tears 04"                        -> "A Witch Sheds No Tears"
 *   "Detective Conan vs Wooo 01-02"                    -> "Detective Conan vs. Wooo"
 */
/**
 * DB titles that drop the apostrophe from a contraction ("Lets Try a Curious
 * Experiment!" vs the canonical "Let's Try a Curious Experiment!").
 * normalizeMatchTitle splits "let's" into "let s", which drags Jaccard to 0.5
 * and misses the 0.6 index threshold. Additive candidates only, whitelisted so
 * real plurals are never touched.
 */
const CONTRACTION_FIXES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bLets\b/g, "Let's"],
  [/\bDont\b/g, "Don't"],
  [/\bDidnt\b/g, "Didn't"],
  [/\bDoesnt\b/g, "Doesn't"],
  [/\bCant\b/g, "Can't"],
  [/\bWont\b/g, "Won't"],
  [/\bIsnt\b/g, "Isn't"],
  [/\bWasnt\b/g, "Wasn't"],
  [/\bThats\b/g, "That's"],
  [/\bWhats\b/g, "What's"],
];

function stripVariants(raw: string): string[] {
  const base = normalizeDcwTitle(raw);
  if (!base) return [];

  const cores: string[] = [];
  const addCore = (value: string | null | undefined) => {
    if (!value) return;
    const cleaned = normalizeDcwTitle(value);
    if (cleaned.length < 3) return;
    if (cores.length >= MAX_STRIP_CANDIDATES) return;
    if (cores.some((core) => core.toLowerCase() === cleaned.toLowerCase())) return;
    cores.push(cleaned);
  };

  addCore(base);

  // 1. Leading bracket tag: "[OVA] Foo" -> "Foo".
  const bracketless = base.replace(/^\s*\[[^\]]*\]\s*/, "");
  if (bracketless !== base) addCore(bracketless);

  // 2. Bare franchise prefix. Deliberately does NOT swallow a following
  //    "Magic File 2:" / "Secret File 3:" segment, because those ARE the
  //    canonical page names. Guarded so "Detective Conan vs Wooo" survives.
  const franchise = /^(?:detective conan|case closed|meitantei conan)\s+(.+)$/i.exec(
    bracketless,
  );
  const franchiseRest = franchise?.[1]?.trim() ?? null;
  if (franchiseRest && !/^vs\b|^vs\./i.test(franchiseRest)) addCore(franchiseRest);

  // 3. "#03 - Title" and generic " - Title" tails.
  for (const core of [...cores]) {
    const hash = /#\s*\d{1,3}\s*[-\u2013\u2014]\s*(.+)$/.exec(core);
    if (hash?.[1]) addCore(hash[1]);
    const dashParts = core.split(/\s[-\u2013\u2014]\s/);
    if (dashParts.length > 1) addCore(dashParts[dashParts.length - 1]);
  }

  // 4. Colon split, after then before.
  for (const core of [...cores]) {
    const colon = core.search(/[:\uff1a]/);
    if (colon <= 0) continue;
    const tail = core.slice(colon + 1).trim();
    if (tail.length >= 3) addCore(tail);
    const head = core.slice(0, colon).trim();
    if (head.length >= 4) addCore(head);
  }

  // 5. "vs" / "vs." punctuation swap.
  for (const core of [...cores]) {
    if (/\bvs\.\s/i.test(core)) addCore(core.replace(/\bvs\.\s/gi, "vs "));
    else if (/\bvs\s/i.test(core)) addCore(core.replace(/\bvs\s/gi, "vs. "));
  }

  // 5b. Missing apostrophe in a contraction: "Lets Try ..." -> "Let's Try ...".
  for (const core of [...cores]) {
    let fixed = core;
    for (const [pattern, replacement] of CONTRACTION_FIXES) {
      fixed = fixed.replace(pattern, replacement);
    }
    if (fixed !== core) addCore(fixed);
  }

  // 6. Trailing episode number or range, applied to everything above.
  for (const core of [...cores]) {
    const trimmed = core
      .replace(/\s+0*\d{1,2}(?:\s*[-\u2013\u2014]\s*0*\d{1,3})?\s*$/, "")
      .trim();
    if (trimmed !== core) addCore(trimmed);
  }

  const out: string[] = [];
  for (const core of cores) {
    const cleaned = normalizeDcwTitle(
      core.replace(/^[\s\-\u2013\u2014:\uff1a|,]+/, "").replace(/[\s\-\u2013\u2014:\uff1a|,]+$/, ""),
    );
    if (!cleaned || cleaned.length < 3) continue;
    if (!/[A-Za-z]/.test(cleaned)) continue;
    if (cleaned.toLowerCase() === base.toLowerCase()) continue;
    if (out.some((value) => value.toLowerCase() === cleaned.toLowerCase())) continue;
    out.push(cleaned);
  }
  return out;
}

/* ------------------------------------------------- wikitext: tokenisation */

function readTemplateBody(text: string, start: number): string | null {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    if (text.startsWith("{{", i)) {
      depth += 1;
      i += 2;
      continue;
    }
    if (text.startsWith("}}", i)) {
      depth -= 1;
      if (depth === 0) return text.slice(start + 2, i);
      i += 2;
      continue;
    }
    i += 1;
  }
  return null;
}

function splitTemplateParams(body: string): string[] {
  const parts: string[] = [];
  let buffer = "";
  let templateDepth = 0;
  let linkDepth = 0;
  let tableDepth = 0;
  let i = 0;

  while (i < body.length) {
    if (body.startsWith("{{", i)) {
      templateDepth += 1;
      buffer += "{{";
      i += 2;
      continue;
    }
    if (body.startsWith("}}", i)) {
      templateDepth = Math.max(0, templateDepth - 1);
      buffer += "}}";
      i += 2;
      continue;
    }
    if (body.startsWith("{|", i)) {
      tableDepth += 1;
      buffer += "{|";
      i += 2;
      continue;
    }
    if (body.startsWith("|}", i) && tableDepth > 0) {
      tableDepth -= 1;
      buffer += "|}";
      i += 2;
      continue;
    }
    if (body.startsWith("[[", i)) {
      linkDepth += 1;
      buffer += "[[";
      i += 2;
      continue;
    }
    if (body.startsWith("]]", i)) {
      linkDepth = Math.max(0, linkDepth - 1);
      buffer += "]]";
      i += 2;
      continue;
    }
    if (
      body[i] === "|" &&
      templateDepth === 0 &&
      linkDepth === 0 &&
      tableDepth === 0
    ) {
      parts.push(buffer);
      buffer = "";
      i += 1;
      continue;
    }
    buffer += body[i];
    i += 1;
  }

  parts.push(buffer);
  return parts;
}

function topLevelEqualsIndex(part: string): number {
  let templateDepth = 0;
  let linkDepth = 0;
  let i = 0;
  while (i < part.length) {
    if (part.startsWith("{{", i)) {
      templateDepth += 1;
      i += 2;
      continue;
    }
    if (part.startsWith("}}", i)) {
      templateDepth = Math.max(0, templateDepth - 1);
      i += 2;
      continue;
    }
    if (part.startsWith("[[", i)) {
      linkDepth += 1;
      i += 2;
      continue;
    }
    if (part.startsWith("]]", i)) {
      linkDepth = Math.max(0, linkDepth - 1);
      i += 2;
      continue;
    }
    if (part[i] === "=" && templateDepth === 0 && linkDepth === 0) return i;
    i += 1;
  }
  return -1;
}

function templateName(body: string): string {
  const first = splitTemplateParams(body)[0] ?? "";
  return first.trim().replace(/[\s_]+/g, " ").toLowerCase();
}

function templateParams(body: string): Map<string, string> {
  const map = new Map<string, string>();
  const parts = splitTemplateParams(body).slice(1);
  let positional = 0;

  for (const part of parts) {
    const eq = topLevelEqualsIndex(part);
    if (eq === -1) {
      positional += 1;
      map.set(String(positional), part.trim());
    } else {
      const key = part.slice(0, eq).trim().toLowerCase();
      if (key) map.set(key, part.slice(eq + 1).trim());
    }
  }
  return map;
}

type RawTemplate = { name: string; body: string };

function topLevelTemplates(text: string): RawTemplate[] {
  const found: RawTemplate[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("{{", i)) {
      const body = readTemplateBody(text, i);
      if (body === null) {
        i += 2;
        continue;
      }
      found.push({ name: templateName(body), body });
      i += body.length + 4;
      continue;
    }
    i += 1;
  }
  return found;
}

/* ------------------------------------------------ wikitext: plain text-ify */

function templateToText(inner: string): string {
  const name = templateName(inner);
  if (!LABEL_TEMPLATES.has(name)) return "";
  const params = templateParams(inner);
  const label =
    params.get("name") ??
    params.get("1") ??
    params.get("char") ??
    params.get("gadget") ??
    "";
  return label;
}

function stripTemplates(text: string): string {
  let out = text;
  for (let pass = 0; pass < 10; pass += 1) {
    const next = out.replace(/\{\{([^{}]*)\}\}/g, (_match, inner: string) =>
      templateToText(inner),
    );
    if (next === out) break;
    out = next;
  }
  return out.replace(/\{\{|\}\}/g, "");
}

export function wikitextToPlain(raw: string): string {
  let text = raw;

  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<ref[^>]*\/>/gi, "");
  text = text.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
  text = text.replace(/<gallery[\s\S]*?<\/gallery>/gi, "");
  text = text.replace(/<table[\s\S]*?<\/table>/gi, "");
  text = text.replace(/\{\|[\s\S]*?\|\}/g, "");
  text = text.replace(
    /\[\[(?:File|Image|Media):[^[\]]*(?:\[\[[^[\]]*\]\][^[\]]*)*\]\]/gi,
    "",
  );

  text = stripTemplates(text);

  text = text.replace(/\[\[([^[\]|]+)\|([^[\]]*)\]\]/g, "$2");
  text = text.replace(/\[\[([^[\]]+)\]\]/g, "$1");
  text = text.replace(/\[(?:https?:)?\/\/\S+\s+([^\]]+)\]/g, "$1");
  text = text.replace(/\[(?:https?:)?\/\/\S+\]/g, "");

  text = text.replace(/<\/?(?:br|BR)\s*\/?>/g, "\n");
  text = text.replace(/<[^>]+>/g, "");

  text = text.replace(/'''''/g, "").replace(/'''/g, "").replace(/''/g, "");
  text = text.replace(/^[ \t]*[*#:;]+[ \t]*/gm, "");
  text = text.replace(/^[ \t]*-{4,}[ \t]*$/gm, "");
  text = text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

  text = text.replace(/[ \t]{2,}/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();

  return text;
}

/* ------------------------------------------------ wikitext: section model */

type Heading = {
  level: number;
  title: string;
  contentStart: number;
  headingStart: number;
};

function listHeadings(wikitext: string): Heading[] {
  const re = /^[ \t]*(={2,6})[ \t]*(.+?)[ \t]*\1[ \t]*$/gm;
  const headings: Heading[] = [];
  let match: RegExpExecArray | null = re.exec(wikitext);
  while (match !== null) {
    headings.push({
      level: (match[1] ?? "==").length,
      title: wikitextToPlain(match[2] ?? "").trim(),
      headingStart: match.index,
      contentStart: match.index + (match[0] ?? "").length,
    });
    match = re.exec(wikitext);
  }
  return headings;
}

function sectionBody(
  wikitext: string,
  headings: Heading[],
  index: number,
): string {
  const current = headings[index];
  if (!current) return "";
  for (let i = index + 1; i < headings.length; i += 1) {
    const next = headings[i];
    if (next && next.level <= current.level) {
      return wikitext.slice(current.contentStart, next.headingStart);
    }
  }
  return wikitext.slice(current.contentStart);
}

function findSection(
  wikitext: string,
  headings: Heading[],
  names: string[],
): { heading: Heading; body: string; index: number } | null {
  const wanted = names.map((n) => n.toLowerCase());
  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i];
    if (!heading) continue;
    if (wanted.includes(heading.title.toLowerCase())) {
      return { heading, body: sectionBody(wikitext, headings, i), index: i };
    }
  }
  return null;
}

function leadSection(wikitext: string, headings: Heading[]): string {
  const first = headings[0];
  return first ? wikitext.slice(0, first.headingStart) : wikitext;
}

/* ------------------------------------------------------ wikitext: infobox */

function findInfobox(wikitext: string): Map<string, string> | null {
  for (const template of topLevelTemplates(wikitext)) {
    if (/^infobox\b/i.test(template.name)) return templateParams(template.body);
  }
  return null;
}

/* --------------------------------------------------------- wikitext: cast */

function linkLabels(raw: string): string[] {
  const labels: string[] = [];
  const linkRe = /\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]/g;
  let match: RegExpExecArray | null = linkRe.exec(raw);
  while (match !== null) {
    const label = (match[2] ?? match[1] ?? "").trim();
    if (label && !/^(?:File|Image|Media|Category):/i.test(label)) {
      labels.push(label);
    }
    match = linkRe.exec(raw);
  }
  return labels;
}

function templateLabels(raw: string, names: string[]): string[] {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const labels: string[] = [];
  const stack: string[] = [raw];

  while (stack.length > 0) {
    const chunk = stack.pop();
    if (!chunk) continue;
    for (const template of topLevelTemplates(chunk)) {
      const params = templateParams(template.body);
      if (wanted.has(template.name)) {
        const value =
          params.get("name") ??
          params.get("1") ??
          params.get("char") ??
          params.get("gadget") ??
          "";
        const plain = wikitextToPlain(value).trim();
        if (plain) labels.push(plain);
      }
      for (const value of params.values()) {
        if (value.includes("{{")) stack.push(value);
      }
    }
  }
  return labels;
}

function parseVoiceCast(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = raw.split(/\n|<br\s*\/?>/i);

  for (const line of lines) {
    const plain = wikitextToPlain(line).trim();
    if (!plain) continue;
    const parts = plain.split(/\s+(?:-|–|—|as|:)\s+/i);
    if (parts.length < 2) continue;
    const actor = (parts[0] ?? "").trim();
    const character = (parts.slice(1).join(" ") ?? "").trim();
    if (!actor || !character) continue;
    map.set(character.toLowerCase(), actor);
  }
  return map;
}

function dedupeCast(members: DcwCastMember[]): DcwCastMember[] {
  const seen = new Map<string, DcwCastMember>();
  for (const member of members) {
    const key = member.character.toLowerCase();
    if (!key) continue;
    const existing = seen.get(key);
    if (existing) {
      if (member.actor && !existing.actor) existing.actor = member.actor;
      if (member.introduced) existing.introduced = true;
      continue;
    }
    seen.set(key, { ...member });
  }
  return Array.from(seen.values()).slice(0, MAX_CAST);
}

/* ------------------------------------------------------ wikitext: gadgets */

function parseGadgets(wikitext: string, headings: Heading[]): DcwGadget[] {
  const section = findSection(wikitext, headings, [
    "gadgets",
    "gadget",
    "gadgets and vehicles",
  ]);
  if (!section) return [];

  const subHeadings = listHeadings(section.body);
  const introducedNames = new Set<string>();

  for (let i = 0; i < subHeadings.length; i += 1) {
    const sub = subHeadings[i];
    if (!sub) continue;
    if (!/introduc/i.test(sub.title)) continue;
    const body = sectionBody(section.body, subHeadings, i);
    for (const name of templateLabels(body, ["newgadget", "gadget"])) {
      introducedNames.add(name);
    }
    for (const name of linkLabels(body)) introducedNames.add(name);
  }

  const all = new Map<string, DcwGadget>();
  for (const name of templateLabels(section.body, ["gadget", "newgadget"])) {
    const key = name.toLowerCase();
    if (!key || all.has(key)) continue;
    all.set(key, { name, introduced: introducedNames.has(name) });
  }

  if (all.size === 0) {
    for (const name of linkLabels(section.body)) {
      const key = name.toLowerCase();
      if (!key || all.has(key)) continue;
      all.set(key, { name, introduced: introducedNames.has(name) });
    }
  }

  return Array.from(all.values())
    .sort((a, b) => Number(b.introduced) - Number(a.introduced))
    .slice(0, MAX_GADGETS);
}

/* --------------------------------------------------------- wikitext: plot */

function paragraphsOf(raw: string): string[] {
  return wikitextToPlain(raw)
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter((p) => p.length >= MIN_DESCRIPTION_LENGTH);
}

function parsePlot(
  wikitext: string,
  headings: Heading[],
): { description: string | null; plot: DcwPlotSection[] } {
  const sections: DcwPlotSection[] = [];
  const plotSection = findSection(wikitext, headings, ["plot", "synopsis"]);

  let description: string | null = null;

  const leadParagraphs = paragraphsOf(leadSection(wikitext, headings));
  if (leadParagraphs.length > 0) description = leadParagraphs.join("\n\n");

  if (plotSection) {
    const subHeadings = listHeadings(plotSection.body);
    const intro = subHeadings[0]
      ? plotSection.body.slice(0, subHeadings[0].headingStart)
      : plotSection.body;
    const introParagraphs = paragraphsOf(intro);
    if (introParagraphs.length > 0) {
      description = description
        ? `${description}\n\n${introParagraphs.join("\n\n")}`
        : introParagraphs.join("\n\n");
    }

    for (let i = 0; i < subHeadings.length; i += 1) {
      const sub = subHeadings[i];
      if (!sub) continue;
      if (!/situation|resolution|summary|explanation/i.test(sub.title)) continue;
      const body = sectionBody(plotSection.body, subHeadings, i);
      const text = paragraphsOf(body).join("\n\n");
      if (!text) continue;
      sections.push({
        heading: sub.title,
        text,
        spoiler: /resolution|explanation/i.test(sub.title),
      });
      if (sections.length >= MAX_PLOT_SECTIONS) break;
    }
  }

  if (!description) {
    const fallback = sections.find((section) => !section.spoiler);
    description = fallback ? fallback.text : null;
  }

  return { description, plot: sections };
}

/* --------------------------------------------------------------- assembly */

export function parseDcwEpisodeWikitext(
  wikitext: string,
  title: string,
  pageId: number | null = null,
): DcwEpisodeDetails {
  const rawWikitext = expandPageNameMagicWords(wikitext, title)
  const headings = listHeadings(rawWikitext);
  const infobox = findInfobox(rawWikitext);
  const { description: rawDescription, plot } = parsePlot(rawWikitext, headings);
  const description = rawDescription ? sanitiseDcwDescription(rawDescription, title) || null : null

  const voiceCast = parseVoiceCast(infobox?.get("voice-cast") ?? "");

  const castCandidates: DcwCastMember[] = [];

  const castSection = findSection(rawWikitext, headings, ["cast", "characters"]);
  if (castSection) {
    const subHeadings = listHeadings(castSection.body);
    const introducedNames = new Set<string>();
    for (let i = 0; i < subHeadings.length; i += 1) {
      const sub = subHeadings[i];
      if (!sub || !/introduc/i.test(sub.title)) continue;
      const body = sectionBody(castSection.body, subHeadings, i);
      for (const name of templateLabels(body, ["newchar", "char"])) {
        introducedNames.add(name);
      }
    }
    for (const name of templateLabels(castSection.body, ["char", "newchar"])) {
      castCandidates.push({
        character: name,
        actor: voiceCast.get(name.toLowerCase()),
        introduced: introducedNames.has(name) || undefined,
      });
    }
  }

  if (castCandidates.length === 0 && infobox) {
    const raw = infobox.get("cast") ?? "";
    const fromTemplates = templateLabels(raw, ["char", "newchar"]);
    const names = fromTemplates.length > 0 ? fromTemplates : linkLabels(raw);
    for (const name of names) {
      castCandidates.push({
        character: name,
        actor: voiceCast.get(name.toLowerCase()),
      });
    }
  }

  if (castCandidates.length === 0 && voiceCast.size > 0) {
    for (const [character, actor] of voiceCast.entries()) {
      castCandidates.push({ character, actor });
    }
  }

  const meta: DcwMetaField[] = [];
  const usedLabels = new Set<string>();
  if (infobox) {
    for (const [key, label] of INFOBOX_META_FIELDS) {
      if (usedLabels.has(label)) continue;
      const raw = infobox.get(key);
      if (!raw) continue;
      const value = wikitextToPlain(raw).replace(/\n+/g, ", ").trim();
      if (!value || value.length > 220) continue;
      meta.push({ label, value });
      usedLabels.add(label);
    }
  }

  return {
    title: normalizeDcwTitle(title),
    url: dcwPageUrl(title),
    pageId,
    description,
    cast: dedupeCast(castCandidates),
    gadgets: parseGadgets(rawWikitext, headings),
    meta,
    plot,
    fetchedAt: new Date().toISOString(),
  };
}

/* ----------------------------------------------------- in-process caching */

type CacheEntry = { value: DcwEpisodeDetails | null; expiresAt: number };
const memoryCache = new Map<string, CacheEntry>();

function cacheGet(key: string): CacheEntry | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return entry;
}

function cacheSet(key: string, value: DcwEpisodeDetails | null): void {
  if (memoryCache.size >= MEMORY_MAX_ENTRIES) {
    const oldest = memoryCache.keys().next().value;
    if (typeof oldest === "string") memoryCache.delete(oldest);
  }
  memoryCache.set(key, { value, expiresAt: Date.now() + MEMORY_TTL_MS });
}

/* ------------------------------------------------------------ public API */

export type GetDcwEpisodeArgs = {
  /** Preferred: content_entries.dcw_title. */
  dcwTitle?: string | null;
  /** Fallback used for a direct hit and then a wiki search. */
  fallbackTitle?: string | null;
  /** Optional hint. Absent -> behavior identical to before. */
  episodeNumber?: number | string | null;
  /**
   * Optional hint: content_entries.type ("episode" | "movie" | "ova" |
   * "special" | "live_action" | "magic_kaito" | "hanzawa" | "zero_tea_time").
   */
  contentType?: string | null;
};

/**
 * Resolve and parse a DCW page.
 *
 * Tier 0   dcw_title, then the entry title, verbatim.
 * Tier 0b  explicit alias map.
 * Tier 1   numbered overview table (Movie N / TV Special N / OVA N /
 *          Hanzawa N / TIME.N) -> canonical page. The only reliable path for
 *          numbered spin-off content, whose DCW pages are named by title only.
 * Tier 1b  "Episode N" stub, TV episodes only (never for spin-offs, whose
 *          numbers collide with the TV episode numbering).
 * Tier 2   canonical category index, fed the raw + structurally stripped
 *          candidates; exact hits first, then Jaccard.
 * Tier 3   stripped candidates fetched directly.
 * Tier 4   cheap orthographic variants.
 * Tier 5   search, with hit[0] guessing disabled for spin-offs.
 * Tier 6   a trusted page that parsed thin.
 *
 * Returns null when nothing usable is found.
 */
export async function getDcwEpisodeDetails(
  args: GetDcwEpisodeArgs,
): Promise<DcwEpisodeDetails | null> {
  // --- Tier 0 candidates: unchanged, and always tried first, in this order.
  const primary: string[] = [];
  for (const raw of [args.dcwTitle, args.fallbackTitle]) {
    if (!raw) continue;
    const normalized = normalizeDcwTitle(raw);
    if (normalized && !primary.includes(normalized)) {
      primary.push(normalized);
    }
  }
  if (primary.length === 0) return null;

  const episodeNumber = normalizeEpisodeNumber(args.episodeNumber);
  const contentType =
    typeof args.contentType === "string" && args.contentType.trim()
      ? args.contentType.trim().toLowerCase()
      : null;

  // Hints change the resolution, so they must be part of the cache identity.
  const cacheKey = [primary.join("||"), episodeNumber ?? "", contentType ?? ""]
    .join("::")
    .toLowerCase();

  const cached = cacheGet(cacheKey);
  if (cached) return cached.value;
  if (isNegativeCached(cacheKey)) return null;

  const normalizedType = normalizeContentType(contentType);
  /** No type at all keeps the old TV-episode behavior (backfill scripts). */
  const isTvEpisodeType = normalizedType === "" || normalizedType === "episode";
  /**
   * Spin-off rows must never resolve to a franchise/overview index page: that
   * is the current wrong-page bug (Magic File entries, Hanzawa row 1).
   */
  const denyOverviewPages = !isTvEpisodeType;

  // content_entries.episode_number is null for every non-magic_kaito spin-off
  // row, so the number has to be derived from the stored titles.
  const overviewNumber =
    deriveOverviewNumber(normalizedType, primary) ??
    (isTvEpisodeType ? null : episodeNumber);

  const tried = new Set<string>();
  let attempts = 0;
  /** Page exists but parsed empty, from a trusted candidate only. */
  let weak: DcwEpisodeDetails | null = null;

  const succeed = (details: DcwEpisodeDetails): DcwEpisodeDetails => {
    negativeCache.delete(cacheKey);
    cacheSet(cacheKey, details);
    return details;
  };

  /**
   * Fetch + parse one candidate.
   * trusted=true means the candidate is deterministic (given title, alias,
   * overview row, Episode N, category-index match), so an empty parse may be
   * kept as a weak fallback. Fuzzy search hits are never trusted.
   */
  const attempt = async (
    candidate: string,
    trusted: boolean,
    /** Alias tier only: the target is hand-verified, so the overview-page
     *  guard is bypassed. Needed for "Magic File 1", which DCW redirects to
     *  the "Magic File" page that doubles as its content page. */
    allowOverviewPage = false,
  ): Promise<DcwEpisodeDetails | null> => {
    const normalized = normalizeDcwTitle(candidate);
    if (!normalized) return null;

    const key = normalized.toLowerCase();
    if (tried.has(key)) return null;

    if (isJunkDcwTitle(normalized)) return null;
    if (denyOverviewPages && !allowOverviewPage && isDcwOverviewTitle(normalized)) return null;

    // Budget is checked BEFORE marking the candidate as tried, so a candidate
    // skipped for cost is not permanently burned for later tiers.
    if (attempts >= MAX_CANDIDATE_ATTEMPTS) return null;

    tried.add(key);
    attempts += 1;

    let page: { title: string; pageId: number | null; wikitext: string } | null = null;
    try {
      page = await fetchWikitext(normalized);
    } catch {
      return null;
    }
    if (!page) return null;

    // Redirects can land on an overview page even from a specific candidate.
    if (denyOverviewPages && !allowOverviewPage && isDcwOverviewTitle(page.title)) return null;

    let details: DcwEpisodeDetails | null = null;
    try {
      details = parseDcwEpisodeWikitext(page.wikitext, page.title, page.pageId);
    } catch {
      return null;
    }
    if (details && hasContent(details)) return details;

    if (trusted && !weak && details) weak = details;
    return null;
  };

  // --- Tier 0: dcw_title, then fallback title. Identical to previous behavior.
  for (const candidate of primary) {
    const details = await attempt(candidate, true);
    if (details) return succeed(details);
  }

  // --- Tier 0b: explicit alias map for titles no rule can reach.
  for (const candidate of primary) {
    const alias = aliasFor(candidate);
    if (!alias) continue;
    const details = await attempt(alias, true, true);
    if (details) return succeed(details);
  }

  // --- Tier 1: numbered overview tables (deterministic number -> page).
  if (overviewNumber !== null) {
    let mapped: string | null = null;
    try {
      mapped = await resolveNumberedOverviewTitle(dcwGetter, normalizedType, overviewNumber);
    } catch {
      mapped = null;
    }
    if (mapped) {
      const details = await attempt(mapped, true);
      if (details) return succeed(details);
    }
    if (normalizedType === "zero_tea_time") {
      const details = await attempt(`TIME.${overviewNumber}`, true);
      if (details) return succeed(details);
    }
  }

  // --- Tier 1b: "Episode N" stub/redirect. TV episodes only: for spin-offs
  // this page exists but belongs to the wrong universe of content.
  if (episodeNumber !== null && isTvEpisodeType) {
    const details = await attempt(`Episode ${episodeNumber}`, true);
    if (details) return succeed(details);
  }

  // --- Structural strip candidates, shared by tiers 2, 3 and 5.
  const stripped: string[] = [];
  for (const candidate of primary) {
    for (const variant of stripVariants(candidate)) {
      const key = variant.toLowerCase();
      if (primary.some((value) => value.toLowerCase() === key)) continue;
      if (stripped.some((value) => value.toLowerCase() === key)) continue;
      stripped.push(variant);
    }
  }

  // --- Tier 2: canonical category index + Jaccard (cached per process),
  // fed every candidate. Exact normalized hits win over any fuzzy score.
  try {
    const index = await fetchDcwCategoryIndexes(
      dcwGetter,
      dcwCategoriesForType(normalizedType),
    );
    if (index.entries.length > 0) {
      const candidates = [...primary, ...stripped];

      for (const candidate of candidates) {
        const normalized = normalizeMatchTitle(candidate);
        if (!normalized) continue;
        const hit = index.exact.get(normalized);
        if (!hit) continue;
        const details = await attempt(hit, true);
        if (details) return succeed(details);
      }

      for (const candidate of candidates) {
        const matched = matchInIndex(index, candidate, 0.6);
        if (!matched) continue;
        const details = await attempt(matched, true);
        if (details) return succeed(details);
      }
    }
  } catch {
    // never throw: fall through to the remaining tiers
  }

  // --- Tier 3: stripped candidates fetched directly (own budget).
  let stripAttempts = 0;
  for (const variant of stripped) {
    if (stripAttempts >= MAX_STRIP_ATTEMPTS) break;
    if (tried.has(variant.toLowerCase())) continue;
    stripAttempts += 1;
    const details = await attempt(variant, true);
    if (details) return succeed(details);
  }

  // --- Tier 4: cheap orthographic variants (capped).
  let variantAttempts = 0;
  for (const candidate of primary) {
    for (const variant of titleVariants(candidate)) {
      if (variantAttempts >= MAX_VARIANT_ATTEMPTS) break;
      if (tried.has(variant.toLowerCase())) continue;
      variantAttempts += 1;
      const details = await attempt(variant, true);
      if (details) return succeed(details);
    }
    if (variantAttempts >= MAX_VARIANT_ATTEMPTS) break;
  }

  // --- Tier 5: smarter search (top 5, junk-filtered, best Jaccard).
  // Spin-off rows do not get the hit[0] guess: DCW search returns zero useful
  // hits for their stored titles, so hit[0] is reliably the wrong page.
  const searchSeeds: string[] = [];
  for (const seed of [primary[primary.length - 1], primary[0], ...stripped]) {
    if (!seed) continue;
    if (searchSeeds.includes(seed)) continue;
    searchSeeds.push(seed);
    if (searchSeeds.length >= MAX_SEARCH_SEEDS) break;
  }

  const allowFirstHitFallback = isTvEpisodeType;
  for (const seed of searchSeeds) {
    let found: string | null = null;
    try {
      found = await searchDcwBestTitle(dcwGetter, seed, { allowFirstHitFallback });
    } catch {
      found = null;
    }
    if (!found) continue;
    if (denyOverviewPages && isDcwOverviewTitle(found)) continue;
    if (numbersConflict(seed, found)) continue;
    const details = await attempt(found, false);
    if (details) return succeed(details);
  }

  // --- Tier 6: a real page was found but parsed thin. Better than nothing,
  // and only ever from a trusted candidate.
  if (weak) return succeed(weak);

  rememberMiss(cacheKey);
  return null;
}

function hasContent(details: DcwEpisodeDetails): boolean {
  return (
    Boolean(details.description) ||
    details.cast.length > 0 ||
    details.gadgets.length > 0 ||
    details.meta.length > 0
  );
}

/**
 * Lead-paragraph extract, replacing the dead `prop=extracts` path used by
 * lib/wiki.ts.
 */
export async function fetchDcwLeadExtract(
  title: string,
): Promise<{ title: string; extract: string; url: string } | null> {
  const page = await fetchWikitext(title);
  if (!page) return null;

  const rawWikitext = expandPageNameMagicWords(page.wikitext, page.title)
  const headings = listHeadings(rawWikitext);
  const paragraphs = paragraphsOf(leadSection(rawWikitext, headings));
  let extract = paragraphs.slice(0, 2).join(" ").trim();
  extract = sanitiseDcwDescription(extract, page.title)

  if (extract.length < MIN_DESCRIPTION_LENGTH) {
    const details = parseDcwEpisodeWikitext(
      rawWikitext,
      page.title,
      page.pageId,
    );
    extract = (details.description ?? "").split(/\n{2,}/).slice(0, 2).join(" ");
    extract = sanitiseDcwDescription(extract, page.title)
  }

  if (extract.length < MIN_DESCRIPTION_LENGTH) return null;

  return {
    title: page.title,
    extract,
    url: dcwPageUrl(page.title),
  };
}
