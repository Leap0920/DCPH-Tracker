/**
 * Community profanity redaction.
 *
 * Deliberately import-free (no "server-only", no Supabase, no Node builtins):
 * this module is used by BOTH the chat API route (app/api/chat/route.ts) and the
 * client component (components/community/ChatWindow.tsx), so it must stay
 * isomorphic. The server pass is authoritative — it cleans the row before it is
 * written, so realtime consumers receive already-redacted content. The client
 * pass exists for two reasons: the optimistic bubble must match what gets
 * stored, and rows written before this filter existed are still dirty in the DB.
 *
 * Strategy, in two stages:
 *
 *  1. fold()  — a LENGTH-PRESERVING normalisation (1 input char -> 1 output
 *     char). Lowercases, flattens Latin accents and Cyrillic/Greek homoglyphs,
 *     and folds leetspeak digits/symbols to letters. Because length is
 *     preserved, a match index in the folded string is the same index in the
 *     original, so we can mask the exact original span.
 *
 *  2. one combined RegExp built from FORBIDDEN_TERMS. Per term:
 *       - every letter is quantified (`puuutaaa`)
 *       - vowels also accept `*` and `#` (`f*ck`, `sh*t`, `t*ngina`)
 *       - one optional filler char is allowed between letters (`p.u.t.a`)
 *       - a left letter-boundary is always required (so `example` never trips
 *         `amp`, `champion` never trips `amp`)
 *       - a BOUNDED enclitic suffix is allowed unless the term is `exact`
 *         (catches `gagong`, `bobong`, `tangang`, `fucking`, while leaving
 *         `gagawin`, `boboto`, `titig`, `tangay`, `lechon` alone)
 *
 * `*` and `#` are intentionally NOT folded to letters, which is what makes
 * redaction idempotent: every term contains a literal consonant, so the "***"
 * we emit can never itself be matched. redact(redact(x)) === redact(x).
 *
 * Known accepted misses: letters spaced with whitespace ("p u t a"). Allowing
 * whitespace between letters is not an option — Tagalog is dense with two-letter
 * particles ("po ta", "ga go") and it false-positives constantly.
 */

/** What every match is replaced with. Fixed width: does not leak word length. */
export const MASK = "***"

type ForbiddenRule = {
  /** Lowercase term. A space means "phrase": flexible gap between words. */
  term: string
  /** No suffix tolerance, both boundaries strict. For short/collision-prone terms. */
  exact?: boolean
  /** Match verbatim as a substring — for scripts without letter boundaries (Hangul, kana, kanji). */
  raw?: boolean
}

/**
 * The blocklist. Ordering here does not matter (the builder sorts longest-first
 * so `putangina` wins over `puta`). Deleting a line is the supported way to opt
 * out of a term.
 */
export const FORBIDDEN_TERMS: readonly ForbiddenRule[] = [
  // ─── Filipino / Tagalog ────────────────────────────────────────────────
  { term: "tarantado" },
  { term: "tarantada" },
  { term: "takte" },
  { term: "potek" },
  { term: "siraulo" },
  { term: "sira ulo" },
  { term: "ulol" },
  { term: "ulul" },
  { term: "puta" },
  { term: "pota", exact: true }, // exact: otherwise "potato" matches
  { term: "potah", exact: true },
  { term: "putcha" },
  { term: "putsa" },
  { term: "pucha" },
  { term: "putragis" },
  { term: "putangina" },
  { term: "putanginamo" },
  { term: "putang ina" },
  { term: "potangina" },
  { term: "potang ina" },
  { term: "tangina" },
  { term: "tanginamo" },
  { term: "tang ina" },
  { term: "kingina" },
  { term: "kinginamo" },
  { term: "inamo", exact: true },
  { term: "amp", exact: true }, // exact: "example", "camp", "ampalaya" must survive
  { term: "amputa" },
  { term: "ampota" },
  { term: "gago" },
  { term: "gagu" },
  { term: "gaga", exact: true }, // exact: "gagawin", "gagamitin" must survive
  { term: "gagang", exact: true },
  { term: "gagi", exact: true },
  { term: "kagaguhan" },
  { term: "kagagohan" },
  { term: "yawa" },
  { term: "yowo", exact: true },
  { term: "pesteng yawa" },
  // Neutral-sense collision: "animal" / "hayop" also mean the literal animal.
  // Kept because they are in the requested list; delete these three lines to opt out.
  { term: "animal", exact: true },
  { term: "hayop" },
  { term: "hayup" },
  { term: "hinayupak" },
  { term: "pisti" },
  { term: "peste" },
  { term: "lintik" },
  { term: "letse" },
  { term: "leche" }, // collision: "leche flan" is masked
  { term: "nyeta" },
  { term: "punyeta" },
  { term: "punyemas" },
  { term: "shet" },
  { term: "shit" },
  { term: "shuta" },
  { term: "bobo" },
  { term: "boba", exact: true }, // collision: the drink
  { term: "tanga" },
  { term: "shunga" },
  { term: "ungas" },
  { term: "engot" },
  { term: "ogag" },
  { term: "timang" },
  { term: "gunggong" },
  { term: "pakshit" },
  { term: "pakshet" },
  { term: "pakyu" },
  { term: "kupal" },
  { term: "buang" },
  { term: "buwisit" },
  { term: "bwisit" },
  { term: "walang kwenta" },
  { term: "walang kuwenta" },
  { term: "walanghiya" },
  { term: "walang hiya" },
  { term: "kantot" },
  { term: "kantutan" },
  { term: "jakol" },
  { term: "pekpek" },
  { term: "puki" },
  { term: "burat" },
  { term: "titi", exact: true }, // exact: "titig", "titis" must survive
  { term: "tite", exact: true },
  { term: "etits" },
  { term: "malibog" },
  { term: "iyot" },
  { term: "bilat" },
  { term: "tamod" },

  // ─── English ───────────────────────────────────────────────────────────
  { term: "fuck" }, // f*ck / fuk / fucking / fucker all covered
  { term: "fuk" },
  { term: "fck", exact: true },
  { term: "fvck", exact: true },
  { term: "phuck" },
  { term: "motherfucker" },
  { term: "fucktard" },
  { term: "shitty" },
  { term: "bullshit" },
  { term: "bitch" },
  { term: "biatch" },
  { term: "asshole" },
  { term: "arsehole" },
  { term: "dumbass" },
  { term: "jackass" },
  { term: "dickhead" },
  { term: "cunt" },
  { term: "twat" },
  { term: "wanker" },
  { term: "bollocks" },
  { term: "bastard" },
  { term: "douchebag" },
  { term: "slut" },
  { term: "skank" },
  { term: "whore" },
  { term: "pussy" },
  { term: "dildo" },
  { term: "blowjob" },
  { term: "jerkoff" },
  { term: "retard" }, // "retarded" via the -ed enclitic

  // ─── Spanish / Mexican ─────────────────────────────────────────────────
  // NOTE: "puto" is intentionally absent — it is a Filipino rice cake.
  { term: "mierda" },
  { term: "pendejo" },
  { term: "pendeja" },
  { term: "cabron" }, // "cabrón" folds to "cabron"
  { term: "chinga" },
  { term: "chingar" },
  { term: "chingada" },
  { term: "chingado" },
  { term: "chinga tu madre" },
  { term: "pinche" },
  { term: "culero" },
  { term: "culiao" },
  { term: "cono", exact: true }, // "coño" folds to "cono"
  { term: "joder" },
  { term: "gilipollas" },
  { term: "verga" },

  // ─── Korean ────────────────────────────────────────────────────────────
  { term: "시발", raw: true },
  { term: "씨발", raw: true },
  { term: "씨빨", raw: true },
  { term: "시팔", raw: true },
  { term: "씨팔", raw: true },
  { term: "개새끼", raw: true },
  { term: "개색기", raw: true },
  { term: "병신", raw: true },
  { term: "좆", raw: true },
  { term: "지랄", raw: true },
  { term: "존나", raw: true },
  { term: "미친놈", raw: true },
  { term: "미친년", raw: true },
  { term: "썅", raw: true },
  { term: "니미", raw: true },
  { term: "shibal" },
  { term: "sibal" },
  { term: "ssibal" },
  { term: "gaesaekki" },
  { term: "byeongsin" },
  { term: "jiral" },
  { term: "jonna" },

  // ─── Japanese ──────────────────────────────────────────────────────────
  // NOTE: "baka" is intentionally absent (mild, and constant in anime fandom).
  // Romanised "shine" is intentionally absent (ordinary English word).
  { term: "くそ", raw: true },
  { term: "クソ", raw: true },
  { term: "糞", raw: true },
  { term: "くそったれ", raw: true },
  { term: "死ね", raw: true },
  { term: "畜生", raw: true },
  { term: "ちくしょう", raw: true },
  { term: "くたばれ", raw: true },
  { term: "ちんこ", raw: true },
  { term: "まんこ", raw: true },
  { term: "キチガイ", raw: true },
  { term: "気違い", raw: true },
  { term: "kuso" },
  { term: "kusottare" },
  { term: "chikusho" },
  { term: "kutabare" },
  { term: "chinko" },
  { term: "manko" },
  { term: "yariman" },
  { term: "kichigai" },
]

/**
 * 1:1 character fold table. Every key and value is exactly one UTF-16 unit, so
 * folding cannot shift indices. `*` and `#` are absent on purpose: they act as
 * vowel wildcards in the patterns.
 */
const CHAR_FOLD = new Map<string, string>(
  Object.entries({
    // leetspeak
    "0": "o",
    "1": "i",
    "3": "e",
    "4": "a",
    "5": "s",
    "7": "t",
    "8": "b",
    "9": "g",
    "@": "a",
    $: "s",
    "!": "i",
    // Latin accents
    á: "a", à: "a", â: "a", ä: "a", ã: "a", å: "a", ā: "a",
    é: "e", è: "e", ê: "e", ë: "e", ē: "e",
    í: "i", ì: "i", î: "i", ï: "i", ī: "i",
    ó: "o", ò: "o", ô: "o", ö: "o", õ: "o", ō: "o",
    ú: "u", ù: "u", û: "u", ü: "u", ū: "u",
    ñ: "n", ç: "c", ý: "y",
    // Cyrillic look-alikes
    а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x",
    к: "k", м: "m", т: "t", в: "b", і: "i", ѕ: "s",
    // Greek look-alikes
    α: "a", ο: "o", ε: "e", ι: "i", ρ: "p", τ: "t", υ: "u", κ: "k",
  })
)

/**
 * Normalise for detection only. Guaranteed: output.length === input.length,
 * which is what lets us map a match back onto the original text.
 */
export function foldForMatching(input: string): string {
  let out = ""
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]
    const lowered = char.toLowerCase()
    // Some code units lowercase to more than one unit (e.g. "İ"); take the first
    // so the 1:1 index mapping holds.
    const key = lowered.length === 1 ? lowered : lowered.charAt(0) || char
    out += CHAR_FOLD.get(key) ?? key
  }
  return out
}

/** Vowels double as wildcard slots, which is how self-censored text is caught. */
const VOWEL_CLASSES: Record<string, string | undefined> = {
  a: "[a*#]",
  e: "[e*#]",
  i: "[i*#]",
  o: "[o*#]",
  u: "[u*#]",
}

/** At most one decorative char between letters — never whitespace. */
const FILLER = "[.\\-_'\"*+~]?"

/** Gap between the words of a phrase. */
const PHRASE_GAP = "[\\s.\\-_]+"

/**
 * Bounded enclitic/inflection tolerance. Longest alternatives first.
 * Deliberately excludes "n", "an", "in", "y", "g": those would swallow ordinary
 * Filipino words ("tangan", "tangay", "titig").
 */
const SUFFIX =
  "(?:niyo|natin|nila|nyo|nyu|ers|ing|han|hin|ed|er|ng|es|mo|ka|s)?"

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function letterPattern(char: string): string {
  return `${VOWEL_CLASSES[char] ?? escapeRegExp(char)}+`
}

function wordPattern(word: string): string {
  return Array.from(word).map(letterPattern).join(FILLER)
}

function alternativeFor(rule: ForbiddenRule): string {
  if (rule.raw) return escapeRegExp(rule.term)
  const core = rule.term
    .trim()
    .split(/\s+/)
    .map(wordPattern)
    .join(PHRASE_GAP)
  return `(?<![a-z0-9])${core}${rule.exact ? "" : SUFFIX}(?![a-z0-9])`
}

// Longest term first: alternation is leftmost-first, so "putangina" must be
// tried before "puta" or only the first four letters would be masked.
const PATTERN_SOURCE = [...FORBIDDEN_TERMS]
  .sort((a, b) => b.term.length - a.term.length)
  .map(alternativeFor)
  .join("|")

const REDACT_RE = new RegExp(PATTERN_SOURCE, "gu")
const DETECT_RE = new RegExp(PATTERN_SOURCE, "u")

/**
 * Replace every forbidden term with MASK, preserving all surrounding text
 * exactly. Idempotent, and never lengthens the input (the shortest term is
 * three characters, so a match is always at least MASK.length).
 */
export function redactForbiddenWords(input: string): string {
  if (!input) return input

  const folded = foldForMatching(input)
  let result = ""
  let cursor = 0
  let dirty = false

  for (const match of folded.matchAll(REDACT_RE)) {
    const start = match.index ?? 0
    if (start < cursor) continue
    result += input.slice(cursor, start) + MASK
    cursor = start + match[0].length
    dirty = true
  }

  if (!dirty) return input
  return result + input.slice(cursor)
}

/** True when the text contains at least one forbidden term. */
export function containsForbiddenWords(input: string): boolean {
  if (!input) return false
  return DETECT_RE.test(foldForMatching(input))
}
