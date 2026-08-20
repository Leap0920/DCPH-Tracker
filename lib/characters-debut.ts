/**
 * Spoiler gating data for the Characters & Red Strings graph.
 *
 * Keyed by character id AND relationship id — both are gated, because a thread
 * can be a spoiler even when both of its endpoints are individually harmless
 * ("same person" between Ai Haibara and Shiho Miyano is the reveal).
 *
 * Gating reads ANIME progress only (`episode` / `movie`). `volume` is recorded
 * from the source table for reference and is never read by the gate.
 *
 * Source: "Detective Conan — Character & Relationship Map (Red String
 * Reference) v2", Section 22 (first appearance: manga vol / anime ep).
 *
 * Entries marked TODO(verify) are not in Section 22; the number comes from
 * general canon and should be confirmed before release.
 *
 * DEFAULTS ARE ASYMMETRIC AND DELIBERATE:
 *   - An id absent from this table is un-gated (always visible). Incomplete
 *     data must never erase the cast.
 *   - An entry with spoiler: "major" and no reachable gate stays HIDDEN. For
 *     major reveals, uncertainty resolves toward hiding.
 *
 * NOTE ON THE SIGNED-OUT BRANCH: a signed-out viewer is gated by `spoiler`
 * only — `debut` is not consulted. An entry with a `debut` but no `spoiler`
 * is therefore fully visible to signed-out visitors. Any character that must
 * be gated for a brand-new/signed-out viewer needs BOTH a `debut.episode`
 * (> 1) and a `spoiler` level of at least "reveal".
 */

import type { SpoilerMeta } from "@/lib/characters-spoiler"

export const SPOILER_DATA: Record<string, SpoilerMeta> = {
  // ——— Episode 1 core: never gated ————————————————————————————————————
  "conan-edogawa": { debut: { episode: 1, volume: 1 } },
  "ran-mouri": { debut: { episode: 1, volume: 1 } },
  "kogoro-mouri": { debut: { episode: 1, volume: 1 } },
  "hiroshi-agasa": { debut: { episode: 1, volume: 1 } },
  "professor-agasa": { debut: { episode: 1, volume: 1 } },
  "juzo-megure": { debut: { episode: 1, volume: 1 } },
  "inspector-megure": { debut: { episode: 1, volume: 1 } },

  // Gin and Vodka appear in episode 1, so their existence is not a spoiler.
  gin: { debut: { episode: 1, volume: 1 } },
  vodka: { debut: { episode: 1, volume: 1 } },

  // ——— Detective Boys ————————————————————————————————————————————————
  "ayumi-yoshida": { debut: { episode: 1, volume: 2 } },
  "mitsuhiko-tsuburaya": { debut: { episode: 1, volume: 2 } },
  "genta-kojima": { debut: { episode: 1, volume: 2 } },

  // ——— Early cast ————————————————————————————————————————————————————
  "sonoko-suzuki": { debut: { episode: 6, volume: 5 } },
  "sango-yokomizo": { debut: { episode: 9, volume: 6 } },
  "akemi-miyano": {
    debut: { episode: 13, volume: 2 },
    spoiler: "reveal",
    lockedHint: "Someone tied to the men in black appears early on.",
  },
  "kiyonaga-matsumoto": { debut: { episode: 18, volume: 8 } },
  "wataru-takagi": { debut: { episode: 21, volume: 18 } },
  "officer-takagi": { debut: { episode: 21, volume: 18 } },
  "eri-kisaki": { debut: { episode: 32, volume: 11 } },
  "yusaku-kudo": { debut: { episode: 43, volume: 6 } },
  "yukiko-kudo": { debut: { episode: 43, volume: 6 } },
  "heiji-hattori": { debut: { episode: 48, volume: 10 } },
  "heizo-hattori": { debut: { episode: 48, volume: 10 } },

  // ——— Kaito Kid side cast ————————————————————————————————————————————
  "kaitou-kid": { debut: { episode: 76, volume: 16 } },
  "kaito-kid": { debut: { episode: 76, volume: 16 } },
  "aoko-nakamori": { debut: { episode: 76, volume: 16 } },
  "ginzo-nakamori": { debut: { episode: 76, volume: 16 } },
  "saguru-hakuba": { debut: { episode: 219, volume: 30 } },

  // TODO(verify): Kid's butler. Episode number is canon-approximate.
  "jii-konosuke": {
    debut: { episode: 76, volume: 16 },
    spoiler: "reveal",
    lockedHint: "The thief in white does not work entirely alone.",
  },

  "toichi-kuroba": {
    debut: { episode: 76, volume: 16 },
    reveal: { episode: 219 },
    spoiler: "reveal",
    lockedHint: "A magician from a previous generation casts a long shadow.",
  },
  "chikage-kuroba": {
    debut: { episode: 219 },
    spoiler: "reveal",
  },

  "misao-yamamura": { debut: { episode: 96, volume: 14 } },
  // TODO(verify): confirm this is a distinct character and not a misspelling
  // of "misao-yamamura" above. If it is a duplicate, remove the id from
  // characters-guide.ts instead of gating it here.
  "misae-yamamura": {
    debut: { episode: 96 },
    spoiler: "reveal",
  },

  // ——— Osaka ——————————————————————————————————————————————————————————
  "kazuha-toyama": { debut: { episode: 118, volume: 19 } },
  "ginshiro-toyama": { debut: { episode: 118, volume: 19 } },
  otaki: { debut: { episode: 118, volume: 19 } },
  "shizuka-hattori": { debut: { episode: 220, volume: 28 } },

  // ——— Ai Haibara / Shiho Miyano ——————————————————————————————————————
  "ai-haibara": {
    debut: { episode: 129, volume: 18 },
    reveal: { episode: 129, volume: 18 },
    spoiler: "reveal",
    lockedHint: "A new face joins the Detective Boys later in the series.",
  },

  // ——— Tokyo MPD ————————————————————————————————————————————————————
  "miwako-sato": { debut: { episode: 130, volume: 19 } },
  "officer-sato": { debut: { episode: 130, volume: 19 } },
  "kazunobu-chiba": { debut: { episode: 138, volume: 27 } },
  "ninzaburo-shiratori": { debut: { episode: 146, movie: 1, volume: 21 } },
  "yumi-miyamoto": { debut: { episode: 146, volume: 21 } },
  "naeko-miike": { debut: { episode: 624, volume: 71 } },

  "jinpei-matsuda": {
    debut: { episode: 301, volume: 36 },
    spoiler: "reveal",
  },
  "hyoue-kuroda": { debut: { episode: 810, volume: 86 } },

  "makoto-kyogoku": { debut: { episode: 153, volume: 22 } },
  "yoko-okino": { debut: { episode: 6 } },

  // ——— Minor police / recurring investigators —————————————————————————
  // TODO(verify): all episode numbers below are canon-approximate. They exist
  // to keep these ids gated; correct them against Section 22 before release.
  "shintaro-chaki": {
    debut: { episode: 134 },
    spoiler: "reveal",
  },
  "detective-tamura": {
    debut: { episode: 358 },
    spoiler: "reveal",
  },
  "detective-kurumazaki": {
    debut: { episode: 694 },
    spoiler: "reveal",
  },
  "tsuyoshi-shikatsuno": {
    debut: { episode: 467 },
    spoiler: "reveal",
  },
  "shoji-terabayashi": {
    debut: { episode: 468 },
    spoiler: "reveal",
  },
  "yuzo-tomizawa": {
    debut: { episode: 18 },
    spoiler: "reveal",
  },

  // ——— Vermouth ————————————————————————————————————————————————————————
  "tomoaki-araide": { debut: { episode: 170, volume: 24 } },
  vermouth: {
    debut: { episode: 176, volume: 24 },
    reveal: { episode: 345 },
    spoiler: "major",
    lockedHint: "The organisation has a member who is more than one person.",
  },

  // ——— FBI / CIA ————————————————————————————————————————————————————
  "jodie-starling": {
    debut: { episode: 226, volume: 27 },
    reveal: { episode: 258 },
    spoiler: "reveal",
  },
  "james-black": { debut: { episode: 258, volume: 32 } },
  "andre-camel": { debut: { episode: 497, volume: 58 } },

  "shuichi-akai": {
    debut: { episode: 230, volume: 29 },
    spoiler: "reveal",
    lockedHint: "A figure the FBI and the organisation both know well.",
  },
  "subaru-okiya": {
    debut: { episode: 509, volume: 60 },
    reveal: { episode: 509, volume: 60 },
    spoiler: "major",
    lockedHint: "A lodger moves into an empty house.",
  },

  "rena-mizunashi": {
    debut: { episode: 425, volume: 48 },
    reveal: { episode: 504 },
    spoiler: "major",
  },
  kir: {
    debut: { episode: 425, volume: 48 },
    spoiler: "major",
  },

  // ——— Black Organization ————————————————————————————————————————————
  chianti: { debut: { episode: 425, volume: 48 }, spoiler: "reveal" },
  korn: { debut: { episode: 425, volume: 48 }, spoiler: "reveal" },
  irish: { debut: { movie: 13 }, spoiler: "reveal" },
  "kanenori-wakita": { debut: { episode: 894, volume: 92 }, spoiler: "reveal" },

  // TODO(verify): episode numbers canon-approximate.
  tequila: {
    debut: { episode: 54 },
    spoiler: "reveal",
    lockedHint: "Another codename surfaces early, and does not last long.",
  },
  calvados: {
    debut: { episode: 345 },
    spoiler: "reveal",
  },
  rum: {
    debut: { episode: 814 },
    spoiler: "major",
    lockedHint: "The boss is said to have a second-in-command.",
  },

  "renya-karasuma": {
    debut: { episode: 219, volume: 30 },
    reveal: { episode: 219, volume: 30 },
    spoiler: "major",
  },
  anokata: { spoiler: "major" },
  pinga: { spoiler: "major" },
  bore: { spoiler: "major" },

  // ——— PSB ————————————————————————————————————————————————————————————
  "tooru-amuro": {
    debut: { episode: 667, volume: 75 },
    reveal: { episode: 783 },
    spoiler: "reveal",
    lockedHint: "A new regular turns up working at the Poirot cafe.",
  },
  "rei-furuya": {
    debut: { episode: 667, volume: 75 },
    reveal: { episode: 783 },
    spoiler: "major",
  },
  bourbon: {
    debut: { episode: 667, volume: 75 },
    reveal: { episode: 783 },
    spoiler: "major",
  },

  "hiromitsu-morofushi": {
    debut: { episode: 558, volume: 65 },
    reveal: { episode: 836, volume: 88 },
    spoiler: "reveal",
  },
  scotch: {
    debut: { episode: 836, volume: 88 },
    reveal: { episode: 836, volume: 88 },
    spoiler: "major",
  },

  // ——— Regional police ————————————————————————————————————————————————
  "kansuke-yamato": { debut: { episode: 516, volume: 59 } },
  "yui-uehara": { debut: { episode: 516, volume: 59 } },
  "jugo-yokomizo": { debut: { episode: 284, volume: 34 } },
  "tamekichi-matsushiro": { debut: { episode: 516 } },
  "kyohei-nishimura": { debut: { episode: 284 } },

  // ——— Miyano family ————————————————————————————————————————————————
  "elena-miyano": {
    debut: { episode: 329, volume: 39 },
    spoiler: "reveal",
    lockedHint: "Two researchers appear in a much older story.",
  },
  "atsushi-miyano": {
    debut: { episode: 329, volume: 39 },
    spoiler: "reveal",
  },

  // ——— Suzuki family ————————————————————————————————————————————————
  "jirokichi-suzuki": { debut: { episode: 356, volume: 44 } },
  // TODO(verify): episode numbers canon-approximate.
  "shiro-suzuki": {
    debut: { episode: 39 },
    spoiler: "reveal",
  },
  "tomoko-suzuki": {
    debut: { episode: 68 },
    spoiler: "reveal",
  },
  "ayako-suzuki": {
    debut: { episode: 18 },
    spoiler: "reveal",
  },

  // ——— Sera / Akai / Haneda extension ————————————————————————————————
  "masumi-sera": { debut: { episode: 646, volume: 73 } },
  "shukichi-haneda": { debut: { episode: 731, volume: 80 } },
  "mary-sera": { debut: { episode: 756, volume: 83 }, spoiler: "reveal" },
  "kohji-haneda": {
    debut: { episode: 861, volume: 89 },
    spoiler: "major",
    lockedHint: "An unsolved case from years ago resurfaces.",
  },
  "tsutomu-akai": { debut: { episode: 882, volume: 92 }, spoiler: "reveal" },
  "rumi-wakasa": { debut: { episode: 889, volume: 91 }, spoiler: "reveal" },
  "fumimaro-ayanokoji": {
    debut: { episode: 694, volume: 94 },
    spoiler: "reveal",
  },
  "amanda-hughes": { debut: { episode: 927 }, spoiler: "reveal" },
  asaka: {
    debut: { episode: 927 },
    spoiler: "major",
  },
}

export function getSpoilerMeta(id: string): SpoilerMeta | undefined {
  return SPOILER_DATA[id]
}

/**
 * Dev-only integrity check: ids in SPOILER_DATA matching no character and no
 * relationship. Wrong id === silently un-gated spoiler, so run this.
 */
export function findOrphanSpoilerIds(knownIds: readonly string[]): string[] {
  const known = new Set(knownIds)
  return Object.keys(SPOILER_DATA).filter((id) => !known.has(id))
}

/** Dev-only: characters carrying no gate at all, for data-entry review. */
export function findUngatedIds(characterIds: readonly string[]): string[] {
  return characterIds.filter((id) => {
    const meta = SPOILER_DATA[id]
    return !meta || (meta.debut?.episode == null && meta.debut?.movie == null)
  })
}
